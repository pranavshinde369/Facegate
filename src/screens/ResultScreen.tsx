import React, {useEffect, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Animated,
} from 'react-native';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import {StackNavigationProp} from '@react-navigation/stack';
import {RootStackParamList} from '../navigation/AppNavigator';

type ResultRouteProp = RouteProp<RootStackParamList, 'Result'>;
type ResultNavProp = StackNavigationProp<RootStackParamList, 'Result'>;

export default function ResultScreen() {
  const navigation = useNavigation<ResultNavProp>();
  const route = useRoute<ResultRouteProp>();
  const {result} = route.params;

  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const confidencePercent = (result.confidence * 100).toFixed(1);
  const isMatch = result.matched;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={isMatch ? '#052e16' : '#2d0a0a'}
      />

      <Animated.View
        style={[
          styles.content,
          {opacity: opacityAnim},
        ]}>

        {/* Result circle */}
        <Animated.View
          style={[
            styles.resultCircle,
            isMatch ? styles.successCircle : styles.failCircle,
            {transform: [{scale: scaleAnim}]},
          ]}>
          <Text style={styles.resultIcon}>
            {isMatch ? '✓' : '✗'}
          </Text>
        </Animated.View>

        {/* Spoof warning */}
        {result.spoofDetected && (
          <View style={styles.spoofBanner}>
            <Text style={styles.spoofText}>
              ⚠️ SPOOF ATTEMPT DETECTED
            </Text>
          </View>
        )}

        {/* Result title */}
        <Text style={[
          styles.resultTitle,
          isMatch ? styles.successText : styles.failText,
        ]}>
          {isMatch ? 'Identity Verified' : 'Not Recognized'}
        </Text>

        {/* Identity details */}
        {isMatch && result.identity && (
          <View style={styles.identityCard}>
            <Text style={styles.identityName}>
              {result.identity.name}
            </Text>
            <Text style={styles.identityId}>
              {result.identity.employeeId}
            </Text>
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedBadgeText}>
                ✓ Liveness Verified
              </Text>
            </View>
          </View>
        )}

        {/* Stats */}
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{confidencePercent}%</Text>
            <Text style={styles.statLabel}>Confidence</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[
              styles.statValue,
              result.inferenceTimeMs < 1000 ? styles.goodValue : styles.badValue,
            ]}>
              {result.inferenceTimeMs}ms
            </Text>
            <Text style={styles.statLabel}>Inference</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>
              {(result.livenessScore * 100).toFixed(0)}%
            </Text>
            <Text style={styles.statLabel}>Liveness</Text>
          </View>
        </View>

        {/* Timestamp */}
        <View style={styles.timestampRow}>
          <Text style={styles.timestamp}>
            {formatDate(result.timestamp)} • {formatTime(result.timestamp)}
          </Text>
        </View>

        {/* Offline badge */}
        <View style={styles.offlineBadge}>
          <Text style={styles.offlineBadgeText}>
            🔒 Processed 100% Offline
          </Text>
        </View>

        {/* Action buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.verifyAgainButton}
            onPress={() => navigation.replace('Verify')}>
            <Text style={styles.verifyAgainText}>Verify Again</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.homeButton}
            onPress={() => navigation.navigate('Home')}>
            <Text style={styles.homeButtonText}>Home</Text>
          </TouchableOpacity>
        </View>

      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0A0A0A'},
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  resultCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successCircle: {backgroundColor: '#052e16', borderWidth: 3, borderColor: '#10B981'},
  failCircle: {backgroundColor: '#2d0a0a', borderWidth: 3, borderColor: '#EF4444'},
  resultIcon: {fontSize: 64, fontWeight: '900'},
  spoofBanner: {
    backgroundColor: '#7F1D1D',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 16,
  },
  spoofText: {color: '#FCA5A5', fontWeight: '700', fontSize: 13},
  resultTitle: {fontSize: 28, fontWeight: '900', marginBottom: 24},
  successText: {color: '#10B981'},
  failText: {color: '#EF4444'},
  identityCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    width: '100%',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  identityName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  identityId: {fontSize: 14, color: '#888888', marginBottom: 12},
  verifiedBadge: {
    backgroundColor: '#052e16',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  verifiedBadgeText: {color: '#10B981', fontSize: 12, fontWeight: '600'},
  statsGrid: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 16,
  },
  statItem: {flex: 1, alignItems: 'center'},
  statValue: {fontSize: 20, fontWeight: '800', color: '#FFFFFF'},
  statLabel: {fontSize: 11, color: '#888888', marginTop: 4},
  statDivider: {width: 1, backgroundColor: '#333333'},
  goodValue: {color: '#10B981'},
  badValue: {color: '#EF4444'},
  timestampRow: {marginBottom: 12},
  timestamp: {color: '#555555', fontSize: 12},
  offlineBadge: {
    backgroundColor: '#1A1A2E',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  offlineBadgeText: {color: '#3B82F6', fontSize: 12, fontWeight: '600'},
  buttonRow: {flexDirection: 'row', gap: 12, width: '100%'},
  verifyAgainButton: {
    flex: 1,
    backgroundColor: '#3B82F6',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  verifyAgainText: {color: '#FFFFFF', fontWeight: '700', fontSize: 15},
  homeButton: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333333',
  },
  homeButtonText: {color: '#FFFFFF', fontWeight: '700', fontSize: 15},
});