export interface Identity {
  id: string;
  name: string;
  employeeId: string;
  embedding: number[];
  enrolledAt: number;
  qualityScore: number;
  syncedToCloud: boolean;
}

export interface VerificationResult {
  matched: boolean;
  identity: Identity | null;
  confidence: number;
  livenessScore: number;
  livenessChallengePassed: boolean;
  inferenceTimeMs: number;
  totalTimeMs: number;
  timestamp: number;
  spoofDetected: boolean;
}

export type ChallengeType = 'BLINK' | 'TURN_LEFT' | 'TURN_RIGHT';

export interface LivenessChallenge {
  type: ChallengeType;
  completed: boolean;
  startedAt: number;
  timeoutMs: number;
}

export interface BenchmarkMetrics {
  detectorMs: number;
  recognizerMs: number;
  totalInferenceMs: number;
  fps: number;
  modelBundleMB: number;
  livenessMs: number;
  similarityScore: number;
  livenessScore: number;
}

export interface SyncQueueItem {
  id: string;
  eventType: 'ENROLLMENT' | 'VERIFICATION' | 'FAILED_ATTEMPT';
  payload: string;
  deviceTimestamp: number;
  enqueuedAt: number;
  retryCount: number;
}