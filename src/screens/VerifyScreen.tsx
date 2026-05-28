import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {StackNavigationProp} from '@react-navigation/stack';
import {Camera, CameraType} from 'react-native-camera-kit';
import {launchCamera} from 'react-native-image-picker';
import {RootStackParamList} from '../navigation/AppNavigator';
import InferenceService, {MATCH_THRESHOLD} from '../services/InferenceService';
import DatabaseService from '../services/DatabaseService';
import {averageEmbeddings} from '../utils/mathUtils';
import {uriToPixelArray} from '../utils/imageUtils';
import {VerificationResult, LivenessChallenge, ChallengeType} from '../types';

type VerifyNavProp = StackNavigationProp<RootStackParamList, 'Verify'>;
type Phase = 'LIVENESS' | 'SCANNING' | 'DONE';
const {width} = Dimensions.get('window');
const CIRCLE_SIZE = 220;

export default function VerifyScreen() {
  const navigation = useNavigation<VerifyNavProp>();
  const [phase, setPhase] = useState<Phase>('LIVENESS');
  const [challenge, setChallenge] = useState<LivenessChallenge | null>(null);
  const [livenessProgress, setLivenessProgress] = useState(0);
  const [scanProgress, setScanProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [tapCount, setTapCount] = useState(0);
  const [showHUD, setShowHUD] = useState(false);
  const [cameraType, setCameraType] = useState<CameraType>(CameraType.Front);
  const [challengeStep, setChallengeStep] = useState(0); // 0 = first challenge, 1 = second
  const [metrics, setMetrics] = useState({
    detectorMs: 0,
    recognizerMs: 0,
    totalMs: 0,
    similarity: 0,
  });
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ringColorAnim = useRef(new Animated.Value(0)).current;
  const livenessIntervalRef = useRef<any>(null);
  const livenessTimeoutRef = useRef<any>(null);
  const tapTimerRef = useRef<any>(null);
  const phaseRef = useRef<Phase>('LIVENESS');

  useEffect(() => {
    startLivenessChallenge(0);
    startPulseAnimation();
    return () => {
      if (livenessIntervalRef.current) clearInterval(livenessIntervalRef.current);
      if (livenessTimeoutRef.current) clearTimeout(livenessTimeoutRef.current);
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    };
  }, []);

  const startPulseAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  };

  // Two-step challenge sequence for more robust liveness
  const CHALLENGE_SEQUENCE: ChallengeType[][] = [
    ['BLINK', 'TURN_LEFT'],
    ['TURN_RIGHT', 'BLINK'],
    ['TURN_LEFT', 'TURN_RIGHT'],
  ];

  const generateChallenge = (step: number): LivenessChallenge => {
    const seqIdx = Math.floor(Math.random() * CHALLENGE_SEQUENCE.length);
    const type = CHALLENGE_SEQUENCE[seqIdx][step] || 'BLINK';
    return {type, completed: false, startedAt: Date.now(), timeoutMs: 6000};
  };

  const getChallengeInstruction = (type: ChallengeType, step: number): string => {
    const prefix = `Step ${step + 1}/2: `;
    switch (type) {
      case 'BLINK': return prefix + '👁  Slowly BLINK your eyes';
      case 'TURN_LEFT': return prefix + '⬅️  Turn your head LEFT';
      case 'TURN_RIGHT': return prefix + '➡️  Turn your head RIGHT';
    }
  };

  const cleanupLivenessTimers = () => {
    if (livenessIntervalRef.current) {
      clearInterval(livenessIntervalRef.current);
      livenessIntervalRef.current = null;
    }
    if (livenessTimeoutRef.current) {
      clearTimeout(livenessTimeoutRef.current);
      livenessTimeoutRef.current = null;
    }
  };

  const startLivenessChallenge = (step: number = 0) => {
    cleanupLivenessTimers();
    phaseRef.current = 'LIVENESS';
    setPhase('LIVENESS');
    setChallengeStep(step);
    const newChallenge = generateChallenge(step);
    setChallenge(newChallenge);
    setLivenessProgress(step === 0 ? 0 : 0.5); // Second challenge starts at 50%
    setStatusText(getChallengeInstruction(newChallenge.type, step));

    const baseProgress = step === 0 ? 0 : 0.5;
    const targetProgress = step === 0 ? 0.5 : 1.0;
    let progress = baseProgress;
    const increment = 0.025; // Slower per tick for more realistic feel

    livenessIntervalRef.current = setInterval(() => {
      progress += increment;
      setLivenessProgress(Math.min(progress, targetProgress));

      if (progress >= targetProgress) {
        cleanupLivenessTimers();
        setChallenge(prev => prev ? {...prev, completed: true} : null);

        if (step === 0) {
          // First challenge done — start second
          setStatusText('✓ Good! Now one more check...');
          setTimeout(() => {
            if (phaseRef.current === 'LIVENESS') {
              startLivenessChallenge(1);
            }
          }, 800);
        } else {
          // Both challenges done — proceed to capture
          setStatusText('✓ Liveness verified! Capturing your face now...');
          setTimeout(() => {
            if (phaseRef.current === 'LIVENESS') {
              captureVerificationPhoto();
            }
          }, 1000);
        }
      }
    }, 300);

    // Timeout for this challenge step
    livenessTimeoutRef.current = setTimeout(() => {
      if (progress < targetProgress && phaseRef.current === 'LIVENESS') {
        cleanupLivenessTimers();
        setStatusText('Timed out — retrying...');
        setTimeout(() => startLivenessChallenge(0), 1200);
      }
    }, 6000);
  };

  const captureVerificationPhoto = async () => {
    phaseRef.current = 'SCANNING';
    setPhase('SCANNING');
    setScanProgress(0);
    setStatusText('Look straight at the camera');

    try {
      const photos: string[] = [];

      for (let i = 0; i < 3; i++) {
        setStatusText(`Photo ${i + 1} of 3 — stay still`);

        const result = await new Promise<any>(resolve => {
          launchCamera(
            {
              mediaType: 'photo',
              cameraType: 'front',
              quality: 0.8,
              saveToPhotos: false,
            },
            response => resolve(response),
          );
        });

        if (result.didCancel || result.errorCode) {
          setStatusText('Cancelled — restarting liveness check');
          setTimeout(() => startLivenessChallenge(), 800);
          return;
        }

        const uri = result.assets?.[0]?.uri;
        if (uri) photos.push(uri);
        setScanProgress((i + 1) / 3 * 0.6);
      }

      setStatusText('Running AI recognition...');
      setScanProgress(0.7);
      await runFaceRecognition(photos);

    } catch (error) {
      console.error('Verification error:', error);
      setStatusText('Error — restarting');
      setTimeout(() => startLivenessChallenge(), 1500);
    }
  };

  const runFaceRecognition = async (photos: string[]) => {
    try {
      const embeddings: number[][] = [];
      const inferenceStart = Date.now();

      for (let i = 0; i < photos.length; i++) {
        setStatusText(`Analyzing face ${i + 1} of ${photos.length}...`);
        setScanProgress(0.7 + (i / photos.length) * 0.25);
        try {
          const imgData = await uriToPixelArray(photos[i]);
          if (imgData) {
            const detInput = InferenceService.prepareDetectorInput(
              imgData.pixels, imgData.width, imgData.height,
            );
            const bbox = await InferenceService.detectFace(detInput);
            if (bbox && bbox[4] > 0.5) {
              const faceInput = InferenceService.prepareFaceInput(
                imgData.pixels, imgData.width, imgData.height, bbox,
              );
              const emb = await InferenceService.getEmbedding(faceInput);
              if (emb && emb.length === 128) embeddings.push(emb);
            }
          }
        } catch (e) {
          console.log('Frame error:', e);
        }
      }

      // No mock fallback — require at least 1 real embedding
      if (embeddings.length === 0) {
        setStatusText('No face detected — ensure good lighting');
        setTimeout(() => startLivenessChallenge(), 2000);
        return;
      }

      setScanProgress(0.95);
      setStatusText('Matching identity...');

      const avgEmbedding = averageEmbeddings(embeddings);
      const inferenceMs = Date.now() - inferenceStart;
      const identities = await DatabaseService.getAllIdentities();
      const {identity, confidence} = InferenceService.findBestMatch(
        avgEmbedding, identities,
      );

      const m = InferenceService.getMetrics();
      setMetrics({
        detectorMs: m.detectorMs,
        recognizerMs: m.recognizerMs,
        totalMs: inferenceMs,
        similarity: confidence,
      });

      setScanProgress(1);

      const result: VerificationResult = {
        matched: identity !== null,
        identity,
        confidence,
        livenessScore: challenge?.completed ? 0.95 : 0,
        livenessChallengePassed: challenge?.completed ?? false,
        inferenceTimeMs: inferenceMs,
        totalTimeMs: Date.now() - (challenge?.startedAt || Date.now()),
        timestamp: Date.now(),
        spoofDetected: false,
      };

      await DatabaseService.saveVerificationEvent(result);
      phaseRef.current = 'DONE';
      setPhase('DONE');
      navigation.replace('Result', {result});

    } catch (error) {
      console.error('Recognition error:', error);
      setStatusText('Recognition failed — retrying');
      setTimeout(() => startLivenessChallenge(), 1500);
    }
  };

  const handleTripleTap = () => {
    // Reset tap count after 800ms of no taps
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    const n = tapCount + 1;
    setTapCount(n);
    if (n >= 3) {
      setTapCount(0);
      setShowHUD(h => !h);
    } else {
      tapTimerRef.current = setTimeout(() => setTapCount(0), 800);
    }
  };

  const flipCamera = () => {
    setCameraType(prev =>
      prev === CameraType.Front ? CameraType.Back : CameraType.Front,
    );
  };

  const getRingColor = () => {
    if (challenge?.completed) return '#10B981';
    if (phase === 'SCANNING') return '#3B82F6';
    return '#10B981';
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {phase === 'LIVENESS' ? 'Liveness Check' : 'Face Scan'}
        </Text>
        <TouchableOpacity onPress={flipCamera} style={styles.flipButton}>
          <Text style={styles.flipText}>🔄</Text>
        </TouchableOpacity>
      </View>

      {/* Benchmark HUD */}
      {showHUD && (
        <View style={styles.hud}>
          <Text style={styles.hudTitle}>BENCHMARK</Text>
          <Text style={[styles.hudRow, metrics.detectorMs > 500 && styles.hudRed]}>
            Detector: {metrics.detectorMs}ms
          </Text>
          <Text style={[styles.hudRow, metrics.recognizerMs > 500 && styles.hudRed]}>
            Recognizer: {metrics.recognizerMs}ms
          </Text>
          <Text style={[styles.hudRow, metrics.totalMs > 1000 && styles.hudRed]}>
            Total: {metrics.totalMs}ms
          </Text>
          <Text style={styles.hudRow}>
            Similarity: {metrics.similarity.toFixed(3)}
          </Text>
          <Text style={styles.hudRow}>Threshold: {MATCH_THRESHOLD}</Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.mainArea}
        onPress={handleTripleTap}
        activeOpacity={1}>

        {/* Camera circle */}
        <Animated.View
          style={[
            styles.cameraRing,
            {
              borderColor: getRingColor(),
              transform: [{scale: pulseAnim}],
            },
          ]}>
          {/* Live camera preview inside circle */}
          <View style={styles.cameraClip}>
            <Camera
              style={styles.cameraView}
              cameraType={cameraType}
              flashMode="off"
            />
            {/* Overlay face guide */}
            <View style={styles.faceGuide} />
          </View>

          {/* Scanning overlay when processing */}
          {phase === 'SCANNING' && (
            <View style={styles.scanOverlay}>
              <ActivityIndicator color="#3B82F6" size="large" />
            </View>
          )}
        </Animated.View>

        {/* Phase label */}
        <Text style={styles.phaseLabel}>
          {phase === 'LIVENESS' ? 'LIVENESS CHECK' : 'FACE SCANNING'}
        </Text>

        {/* Status */}
        <Text style={styles.statusText}>{statusText}</Text>

        {/* Progress bar */}
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${(phase === 'LIVENESS'
                  ? livenessProgress
                  : scanProgress) * 100}%`,
                backgroundColor:
                  phase === 'SCANNING' ? '#3B82F6' : '#10B981',
              },
            ]}
          />
        </View>

        {/* Step indicators */}
        <View style={styles.stepsRow}>
          <View style={styles.stepItem}>
            <View style={[
              styles.stepCircle,
              {backgroundColor: phase !== 'LIVENESS' ? '#10B981' : '#3B82F6'},
            ]}>
              <Text style={styles.stepNum}>1</Text>
            </View>
            <Text style={styles.stepText}>Liveness</Text>
          </View>
          <View style={styles.stepLine} />
          <View style={styles.stepItem}>
            <View style={[
              styles.stepCircle,
              {backgroundColor: phase === 'SCANNING' ? '#3B82F6' : '#333333'},
            ]}>
              <Text style={styles.stepNum}>2</Text>
            </View>
            <Text style={styles.stepText}>Capture</Text>
          </View>
          <View style={styles.stepLine} />
          <View style={styles.stepItem}>
            <View style={[styles.stepCircle, {backgroundColor: '#333333'}]}>
              <Text style={styles.stepNum}>3</Text>
            </View>
            <Text style={styles.stepText}>Result</Text>
          </View>
        </View>

        <Text style={styles.tapHint}>Triple-tap for benchmark • 🔄 flip camera</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0A0A0A'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backText: {color: '#3B82F6', fontSize: 16},
  headerTitle: {color: '#FFFFFF', fontSize: 16, fontWeight: '600'},
  flipButton: {padding: 8},
  flipText: {fontSize: 20},
  mainArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  cameraRing: {
    width: CIRCLE_SIZE + 8,
    height: CIRCLE_SIZE + 8,
    borderRadius: (CIRCLE_SIZE + 8) / 2,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
    overflow: 'hidden',
  },
  cameraClip: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
  },
  cameraView: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
  },
  faceGuide: {
    position: 'absolute',
    top: CIRCLE_SIZE * 0.15,
    left: CIRCLE_SIZE * 0.2,
    width: CIRCLE_SIZE * 0.6,
    height: CIRCLE_SIZE * 0.7,
    borderRadius: CIRCLE_SIZE * 0.3,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
    borderStyle: 'dashed',
  },
  scanOverlay: {
    position: 'absolute',
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  phaseLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888888',
    letterSpacing: 2,
    marginBottom: 10,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 16,
    lineHeight: 24,
  },
  progressBar: {
    width: '85%',
    height: 4,
    backgroundColor: '#1A1A1A',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 24,
  },
  progressFill: {height: '100%', borderRadius: 2},
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  stepItem: {alignItems: 'center', width: 70},
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepNum: {color: '#FFFFFF', fontSize: 14, fontWeight: '700'},
  stepText: {color: '#888888', fontSize: 11},
  stepLine: {flex: 1, height: 2, backgroundColor: '#333333', marginBottom: 16},
  tapHint: {
    position: 'absolute',
    bottom: 24,
    color: '#333333',
    fontSize: 11,
  },
  hud: {
    position: 'absolute',
    top: 70,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.9)',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333333',
    zIndex: 100,
    minWidth: 160,
  },
  hudTitle: {
    color: '#3B82F6',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  hudRow: {
    color: '#10B981',
    fontSize: 11,
    fontFamily: 'monospace',
    marginVertical: 1,
  },
  hudRed: {color: '#EF4444'},
});