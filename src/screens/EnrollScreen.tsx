import React, {useState} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {launchCamera} from 'react-native-image-picker';
import DatabaseService from '../services/DatabaseService';
import InferenceService from '../services/InferenceService';
import {averageEmbeddings} from '../utils/mathUtils';
import {uriToPixelArray} from '../utils/imageUtils';
import {Identity} from '../types';

export default function EnrollScreen() {
  const navigation = useNavigation();
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [capturedEmbeddings, setCapturedEmbeddings] = useState<number[][]>([]);
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
  const [frameQualities, setFrameQualities] = useState<number[]>([]);
  const [status, setStatus] = useState('Enter details then capture face photos');

  const REQUIRED_FRAMES = 1;

  const generateId = () =>
    `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const captureFrame = async () => {
    if (!name.trim() || !employeeId.trim()) {
      Alert.alert('Missing Info', 'Please enter name and employee ID first');
      return;
    }

    setCapturing(true);
    const embeddings: number[][] = [];
    const photos: string[] = [];
    const qualities: number[] = [];

    try {
      for (let i = 0; i < REQUIRED_FRAMES; i++) {
        setStatus(`Capture photo ${i + 1} of ${REQUIRED_FRAMES} — look at camera`);

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
          setStatus('Capture cancelled — tap button to try again');
          setCapturing(false);
          return;
        }

        const uri = result.assets?.[0]?.uri;
        if (uri) photos.push(uri);

        // Run real ONNX inference — no mock fallback
        let embedding: number[] | null = null;
        let quality = 0;

        try {
          if (!InferenceService.isLoaded()) {
            setStatus(`⚠ Photo ${i + 1} — AI models not loaded`);
          } else if (!uri) {
            setStatus(`⚠ Photo ${i + 1} — no image captured`);
          } else {
            setStatus(`Processing photo ${i + 1} through AI...`);

            // HIGH PERFORMANCE PATH: No pixel data sent over bridge
            const bbox = await InferenceService.detectFaceFast(uri);

            if (!bbox || bbox[4] <= 0.5) {
              setStatus(`⚠ Photo ${i + 1} — no face detected, try better lighting`);
            } else {
              quality = bbox[4];
              const realEmbedding = await InferenceService.getEmbeddingFast(uri, bbox);
              
              if (realEmbedding && realEmbedding.length === 128) {
                embedding = realEmbedding;
                setStatus(`✓ Photo ${i + 1} — face detected (${(quality * 100).toFixed(0)}% confidence)`);
              } else {
                setStatus(`⚠ Photo ${i + 1} — embedding extraction failed`);
              }
            }
          }
        } catch (inferenceError) {
          console.warn(`Inference error on photo ${i + 1}:`, inferenceError);
          setStatus(`⚠ Photo ${i + 1} — processing error, retake recommended`);
        }

        // Only push successful detections
        if (embedding) {
          embeddings.push(embedding);
          qualities.push(quality);
        }
      }

      // Require at least 1 successful face detections out of 1 attempts
      const MIN_SUCCESSFUL = 1;
      if (embeddings.length < MIN_SUCCESSFUL) {
        Alert.alert(
          'Face Detection Failed',
          `Only ${embeddings.length} of ${REQUIRED_FRAMES} photos had a detectable face.\n` +
          `Need at least ${MIN_SUCCESSFUL}. Ensure good lighting and face the camera directly.`,
        );
        setCapturing(false);
        return;
      }

      setCapturedEmbeddings(embeddings);
      setCapturedPhotos(photos);
      setFrameQualities(qualities);
      setStatus(`✓ ${embeddings.length} faces detected! Tap Save Identity.`);
    } catch (error) {
      setStatus('Capture failed — try again');
      console.error('Capture error:', error);
    } finally {
      setCapturing(false);
    }
  };

  const saveIdentity = async () => {
    const MIN_SUCCESSFUL = 1;
    if (capturedEmbeddings.length < MIN_SUCCESSFUL) {
      Alert.alert('Not Ready', `Need at least ${MIN_SUCCESSFUL} successful face captures first`);
      return;
    }

    setSaving(true);
    setStatus('Saving identity...');

    try {
      const avgEmbedding = averageEmbeddings(capturedEmbeddings);
      const avgQuality =
        frameQualities.reduce((a, b) => a + b, 0) / frameQualities.length;

      const identity: Identity = {
        id: generateId(),
        name: name.trim(),
        employeeId: employeeId.trim(),
        embedding: avgEmbedding,
        enrolledAt: Date.now(),
        qualityScore: avgQuality,
        syncedToCloud: false,
      };

      await DatabaseService.saveIdentity(identity);
      setStatus('✓ Identity saved successfully!');

      Alert.alert(
        'Enrolled!',
        `${name} has been enrolled successfully.\nQuality score: ${(avgQuality * 100).toFixed(0)}%`,
        [{text: 'OK', onPress: () => navigation.goBack()}],
      );
    } catch (error) {
      setStatus('Save failed — try again');
      console.error('Save error:', error);
    } finally {
      setSaving(false);
    }
  };

  const resetCapture = () => {
    setCapturedEmbeddings([]);
    setCapturedPhotos([]);
    setFrameQualities([]);
    setStatus('Enter details then capture face photos');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Photo preview grid */}
        <View style={styles.photoGrid}>
          {Array.from({length: REQUIRED_FRAMES}).map((_, i) => (
            <View key={i} style={styles.photoSlot}>
              {capturedPhotos[i] ? (
                <>
                  <Image
                    source={{uri: capturedPhotos[i]}}
                    style={styles.photoThumb}
                  />
                  <View
                    style={[
                      styles.qualityDot,
                      {
                        backgroundColor:
                          (frameQualities[i] ?? 0) > 0.9
                            ? '#10B981'
                            : '#F59E0B',
                      },
                    ]}
                  />
                </>
              ) : (
                <View style={styles.photoEmpty}>
                  <Text style={styles.photoEmptyNum}>{i + 1}</Text>
                  <Text style={styles.photoEmptyIcon}>📷</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Status */}
        <Text style={styles.status}>{status}</Text>

        {/* Inputs */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Rajesh Kumar"
            placeholderTextColor="#555555"
            autoCapitalize="words"
          />
          <Text style={styles.label}>Employee ID</Text>
          <TextInput
            style={styles.input}
            value={employeeId}
            onChangeText={setEmployeeId}
            placeholder="e.g. EMP-2024-001"
            placeholderTextColor="#555555"
            autoCapitalize="characters"
          />
        </View>

        {/* Capture button */}
        <TouchableOpacity
          style={[styles.captureButton, capturing && styles.buttonDisabled]}
          onPress={captureFrame}
          disabled={capturing || saving}>
          {capturing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.captureButtonText}>
              📷{' '}
              {capturedEmbeddings.length > 0
                ? 'Retake Photos'
                : 'Capture Face Photos'}
            </Text>
          )}
        </TouchableOpacity>

        {/* Save button — show when we have 1+ successful face detections */}
        {capturedEmbeddings.length >= 1 && (
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.buttonDisabled]}
            onPress={saveIdentity}
            disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>✓ Save Identity</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Reset button */}
        {capturedEmbeddings.length > 0 && (
          <TouchableOpacity style={styles.resetButton} onPress={resetCapture}>
            <Text style={styles.resetButtonText}>Reset</Text>
          </TouchableOpacity>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0A0A0A'},
  scroll: {padding: 24},
  photoGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  photoSlot: {position: 'relative', width: 60, height: 60},
  photoThumb: {width: 60, height: 60, borderRadius: 12},
  photoEmpty: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333333',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoEmptyNum: {color: '#555555', fontSize: 10},
  photoEmptyIcon: {fontSize: 18},
  qualityDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#0A0A0A',
  },
  status: {
    color: '#3B82F6',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  inputContainer: {marginBottom: 24},
  label: {
    color: '#888888',
    fontSize: 12,
    marginBottom: 6,
    marginTop: 16,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 14,
    color: '#FFFFFF',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333333',
  },
  captureButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    marginBottom: 12,
  },
  captureButtonText: {color: '#FFFFFF', fontSize: 16, fontWeight: '700'},
  saveButton: {
    backgroundColor: '#10B981',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    marginBottom: 12,
  },
  saveButtonText: {color: '#FFFFFF', fontSize: 16, fontWeight: '700'},
  resetButton: {padding: 12, alignItems: 'center'},
  resetButtonText: {color: '#888888', fontSize: 14},
  buttonDisabled: {opacity: 0.6},
});