import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DatabaseService from './DatabaseService';

const AWS_LAMBDA_URL = 'https://your-lambda-endpoint.amazonaws.com/sync';
const DEVICE_ID_STORAGE_KEY = 'facegate_device_id';

class SyncService {
  private isSyncing = false;
  private unsubscribe: (() => void) | null = null;
  private lastSyncTime = 0;
  private cachedDeviceId: string | null = null;

  /**
   * Bug #6 fix: Generate device ID once and persist it.
   * Previously generated a new ID on every call using Date.now().
   */
  async getDeviceId(): Promise<string> {
    // Return cached value if available
    if (this.cachedDeviceId) return this.cachedDeviceId;

    try {
      // Try to read from persistent storage
      const stored = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (stored) {
        this.cachedDeviceId = stored;
        return stored;
      }
    } catch (e) {
      // AsyncStorage not available — fall through to generate
    }

    // Generate new persistent device ID
    const newId = `device_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;

    try {
      await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, newId);
    } catch (e) {
      console.warn('Could not persist device ID:', e);
    }

    this.cachedDeviceId = newId;
    return newId;
  }

  startListening(): void {
    console.log('SyncService: starting network listener');
    this.unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable) {
        console.log('Network restored — attempting sync');
        this.attemptSync();
      }
    });
  }

  stopListening(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  async attemptSync(): Promise<{synced: number; failed: number}> {
    if (this.isSyncing) {
      console.log('Sync already in progress');
      return {synced: 0, failed: 0};
    }

    this.isSyncing = true;
    let synced = 0;
    let failed = 0;

    try {
      const pendingItems = await DatabaseService.getPendingSyncItems();

      if (pendingItems.length === 0) {
        console.log('Nothing to sync');
        return {synced: 0, failed: 0};
      }

      console.log(`Syncing ${pendingItems.length} items to AWS...`);

      const deviceId = await this.getDeviceId();
      const response = await axios.post(
        AWS_LAMBDA_URL,
        {
          deviceId,
          items: pendingItems,
          syncedAt: Date.now(),
        },
        {
          timeout: 10000,
          headers: {'Content-Type': 'application/json'},
        },
      );

      if (response.status === 200) {
        const confirmedIds = pendingItems.map(item => item.id);
        await DatabaseService.markSynced(confirmedIds);
        synced = confirmedIds.length;
        this.lastSyncTime = Date.now();
        console.log(`Sync complete: ${synced} items synced and purged`);
      }
    } catch (error) {
      console.log('Sync failed (offline or server error):', error);
      failed = 1;
    } finally {
      this.isSyncing = false;
    }

    return {synced, failed};
  }

  async forceSync(): Promise<{synced: number; failed: number}> {
    this.isSyncing = false; // reset lock
    return this.attemptSync();
  }

  getLastSyncTime(): number {
    return this.lastSyncTime;
  }

  isSyncInProgress(): boolean {
    return this.isSyncing;
  }
}

export default new SyncService();