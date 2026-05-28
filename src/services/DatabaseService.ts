import {open} from '@op-engineering/op-sqlite';
import {Identity, VerificationResult, SyncQueueItem} from '../types';

class DatabaseService {
  private db: any = null;

  async initialize(): Promise<void> {
    try {
      this.db = open({name: 'facegate.db'});
      await this.createTables();
      console.log('Database initialized');
    } catch (error) {
      console.error('Database init error:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS identities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        embedding TEXT NOT NULL,
        enrolled_at INTEGER NOT NULL,
        quality_score REAL DEFAULT 0,
        synced INTEGER DEFAULT 0
      );
    `);
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS verification_events (
        id TEXT PRIMARY KEY,
        identity_id TEXT,
        matched INTEGER NOT NULL,
        confidence REAL NOT NULL,
        liveness_passed INTEGER NOT NULL,
        spoof_detected INTEGER NOT NULL,
        inference_ms INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        synced INTEGER DEFAULT 0
      );
    `);
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        device_timestamp INTEGER NOT NULL,
        enqueued_at INTEGER NOT NULL,
        retry_count INTEGER DEFAULT 0
      );
    `);
  }

  async saveIdentity(identity: Identity): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO identities
       (id, name, employee_id, embedding, enrolled_at, quality_score, synced)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [
        identity.id,
        identity.name,
        identity.employeeId,
        JSON.stringify(identity.embedding),
        identity.enrolledAt,
        identity.qualityScore,
      ],
    );
    await this.addToSyncQueue('ENROLLMENT', {
      identityId: identity.id,
      name: identity.name,
      employeeId: identity.employeeId,
      enrolledAt: identity.enrolledAt,
    });
  }

  async getAllIdentities(): Promise<Identity[]> {
    const result = await this.db.execute(
      'SELECT * FROM identities ORDER BY enrolled_at DESC',
    );
    const identities: Identity[] = [];
    const rows = result.rows ?? [];
    for (const row of rows) {
      identities.push({
        id: row.id,
        name: row.name,
        employeeId: row.employee_id,
        embedding: JSON.parse(row.embedding),
        enrolledAt: row.enrolled_at,
        qualityScore: row.quality_score,
        syncedToCloud: row.synced === 1,
      });
    }
    return identities;
  }

  async getIdentityCount(): Promise<number> {
    const result = await this.db.execute(
      'SELECT COUNT(*) as count FROM identities',
    );
    const rows = result.rows ?? [];
    return rows[0]?.count ?? 0;
  }

  async deleteIdentity(id: string): Promise<void> {
    await this.db.execute('DELETE FROM identities WHERE id = ?', [id]);
  }

  async saveVerificationEvent(result: VerificationResult): Promise<void> {
    const id = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await this.db.execute(
      `INSERT INTO verification_events
       (id, identity_id, matched, confidence, liveness_passed,
        spoof_detected, inference_ms, timestamp, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        id,
        result.identity?.id ?? null,
        result.matched ? 1 : 0,
        result.confidence,
        result.livenessChallengePassed ? 1 : 0,
        result.spoofDetected ? 1 : 0,
        result.inferenceTimeMs,
        result.timestamp,
      ],
    );
    await this.addToSyncQueue('VERIFICATION', {
      eventId: id,
      matched: result.matched,
      confidence: result.confidence,
      timestamp: result.timestamp,
      spoofDetected: result.spoofDetected,
    });
  }

  async getStats(): Promise<{
    totalEnrolled: number;
    totalVerifications: number;
    successRate: number;
    pendingSync: number;
  }> {
    const r1 = await this.db.execute('SELECT COUNT(*) as count FROM identities');
    const r2 = await this.db.execute('SELECT COUNT(*) as count FROM verification_events');
    const r3 = await this.db.execute('SELECT COUNT(*) as count FROM verification_events WHERE matched = 1');
    const r4 = await this.db.execute('SELECT COUNT(*) as count FROM sync_queue');

    const totalV = r2.rows?.[0]?.count ?? 0;
    const successV = r3.rows?.[0]?.count ?? 0;

    return {
      totalEnrolled: r1.rows?.[0]?.count ?? 0,
      totalVerifications: totalV,
      successRate: totalV > 0 ? (successV / totalV) * 100 : 0,
      pendingSync: r4.rows?.[0]?.count ?? 0,
    };
  }

  async getPendingSyncItems(): Promise<SyncQueueItem[]> {
    const result = await this.db.execute(
      'SELECT * FROM sync_queue ORDER BY enqueued_at ASC LIMIT 50',
    );
    const items: SyncQueueItem[] = [];
    const rows = result.rows ?? [];
    for (const row of rows) {
      items.push({
        id: row.id,
        eventType: row.event_type,
        payload: row.payload,
        deviceTimestamp: row.device_timestamp,
        enqueuedAt: row.enqueued_at,
        retryCount: row.retry_count,
      });
    }
    return items;
  }

  async markSynced(ids: string[]): Promise<void> {
    const placeholders = ids.map(() => '?').join(',');
    await this.db.execute(
      `DELETE FROM sync_queue WHERE id IN (${placeholders})`,
      ids,
    );
  }

  async clearAllIdentities(): Promise<void> {
    await this.db.execute('DELETE FROM identities');
    await this.db.execute('DELETE FROM sync_queue');
  }

  private async addToSyncQueue(
    eventType: string,
    payload: object,
  ): Promise<void> {
    const id = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();
    await this.db.execute(
      `INSERT INTO sync_queue
       (id, event_type, payload, device_timestamp, enqueued_at, retry_count)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [id, eventType, JSON.stringify(payload), now, now],
    );
  }
}

export default new DatabaseService();