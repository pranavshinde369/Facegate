import React, {useEffect, useState, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {StackNavigationProp} from '@react-navigation/stack';
import {RootStackParamList} from '../navigation/AppNavigator';
import InferenceService from '../services/InferenceService';
import DatabaseService from '../services/DatabaseService';
import SyncService from '../services/SyncService';
import NetInfo from '@react-native-community/netinfo';

type HomeNavProp = StackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavProp>();
  const [loading, setLoading] = useState(true);
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [isOnline, setIsOnline] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);
  const [modelSizeMB, setModelSizeMB] = useState(0);
  const [tapCount, setTapCount] = useState(0);
  const tapTimerRef = useRef<any>(null);

  useEffect(() => {
    initApp();
    SyncService.startListening();

    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(!!state.isConnected);
    });

    return () => {
      unsubscribe();
      SyncService.stopListening();
    };
  }, []);

  const initApp = async () => {
    try {
      await DatabaseService.initialize();
      await InferenceService.loadAllModels();

      const stats = await DatabaseService.getStats();
      setEnrolledCount(stats.totalEnrolled);
      setPendingSync(stats.pendingSync);

      const metrics = InferenceService.getMetrics();
      setModelSizeMB(metrics.modelBundleMB);
    } catch (error) {
      console.error('Init error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTripleTap = () => {
    // Reset tap count after 800ms of no taps
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    const newCount = tapCount + 1;
    setTapCount(newCount);
    if (newCount >= 3) {
      setTapCount(0);
      // Navigate to debug — add DebugScreen later
      console.log('Debug mode activated');
    } else {
      tapTimerRef.current = setTimeout(() => setTapCount(0), 800);
    }
  };

  const getSyncStatus = () => {
    if (!isOnline) return {label: 'Offline', color: '#888888'};
    if (pendingSync > 0) return {label: `${pendingSync} Pending`, color: '#F59E0B'};
    return {label: 'Synced', color: '#10B981'};
  };

  const syncStatus = getSyncStatus();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading AI Models...</Text>
        <Text style={styles.loadingSubtext}>Preparing offline inference engine</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* Header */}
      <TouchableOpacity
        style={styles.header}
        onPress={handleTripleTap}
        activeOpacity={1}>
        <Text style={styles.appTitle}>FaceGate</Text>
        <Text style={styles.appSubtitle}>Offline Face Authentication</Text>

        {/* Model size badge */}
        <View style={styles.modelBadge}>
          <Text style={styles.modelBadgeText}>
            Model: {modelSizeMB.toFixed(1)} MB • Offline Ready
          </Text>
        </View>
      </TouchableOpacity>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{enrolledCount}</Text>
          <Text style={styles.statLabel}>Enrolled</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCard}>
          <View style={[styles.syncDot, {backgroundColor: syncStatus.color}]} />
          <Text style={[styles.statLabel, {color: syncStatus.color}]}>
            {syncStatus.label}
          </Text>
        </View>
      </View>

      {/* Main buttons */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('Verify')}>
          <Text style={styles.primaryButtonIcon}>🔍</Text>
          <Text style={styles.primaryButtonText}>Verify Identity</Text>
          <Text style={styles.primaryButtonSub}>
            Scan face to authenticate
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('Enroll')}>
          <Text style={styles.secondaryButtonIcon}>➕</Text>
          <Text style={styles.secondaryButtonText}>Enroll New Agent</Text>
          <Text style={styles.secondaryButtonSub}>
            Register a new field personnel
          </Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          100% Offline • No data leaves your device
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0A0A0A'},
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
  },
  loadingSubtext: {color: '#888888', fontSize: 13, marginTop: 8},
  header: {alignItems: 'center', paddingTop: 48, paddingBottom: 24},
  appTitle: {
    fontSize: 42,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  appSubtitle: {fontSize: 14, color: '#888888', marginTop: 4},
  modelBadge: {
    marginTop: 12,
    backgroundColor: '#1A1A2E',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  modelBadgeText: {fontSize: 11, color: '#3B82F6', fontWeight: '600'},
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 24,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 32,
  },
  statCard: {flex: 1, alignItems: 'center'},
  statNumber: {fontSize: 32, fontWeight: '800', color: '#FFFFFF'},
  statLabel: {fontSize: 12, color: '#888888', marginTop: 4},
  statDivider: {width: 1, height: 40, backgroundColor: '#333333'},
  syncDot: {width: 10, height: 10, borderRadius: 5, marginBottom: 4},
  buttonContainer: {paddingHorizontal: 24, gap: 16},
  primaryButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  primaryButtonIcon: {fontSize: 32, marginBottom: 8},
  primaryButtonText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  primaryButtonSub: {fontSize: 13, color: '#BFDBFE', marginTop: 4},
  secondaryButton: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333333',
  },
  secondaryButtonIcon: {fontSize: 32, marginBottom: 8},
  secondaryButtonText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  secondaryButtonSub: {fontSize: 13, color: '#888888', marginTop: 4},
  footer: {position: 'absolute', bottom: 24, left: 0, right: 0, alignItems: 'center'},
  footerText: {fontSize: 12, color: '#444444'},
});