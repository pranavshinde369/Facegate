// Cosine similarity between two vectors — returns 0 to 1
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1, sim));
}

// L2 normalize a vector
export function l2Normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) return v;
  return v.map(x => x / norm);
}

// Average multiple embeddings then normalize
export function averageEmbeddings(embeddings: number[][]): number[] {
  const size = embeddings[0].length;
  const avg = new Array(size).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < size; i++) {
      avg[i] += emb[i];
    }
  }
  for (let i = 0; i < size; i++) {
    avg[i] /= embeddings.length;
  }
  return l2Normalize(avg);
}

// Euclidean distance between two points
export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) * (a[i] - b[i]);
  }
  return Math.sqrt(sum);
}

// Eye Aspect Ratio for blink detection
// eyeLandmarks: 6 points [x,y] — p1 to p6
export function eyeAspectRatio(eyeLandmarks: number[][]): number {
  const p1 = eyeLandmarks[0];
  const p2 = eyeLandmarks[1];
  const p3 = eyeLandmarks[2];
  const p4 = eyeLandmarks[3];
  const p5 = eyeLandmarks[4];
  const p6 = eyeLandmarks[5];

  const vertical1 = euclideanDistance(p2, p6);
  const vertical2 = euclideanDistance(p3, p5);
  const horizontal = euclideanDistance(p1, p4);

  return (vertical1 + vertical2) / (2.0 * horizontal);
}

// Get adaptive EAR threshold based on ambient brightness
export function getAdaptiveEARThreshold(brightness: number): number {
  if (brightness < 50) return 0.20;       // dark environment
  if (brightness < 150) return 0.25;      // normal lighting
  return 0.32;                             // bright sunlight
}

// Estimate head yaw from 3 landmark points
export function estimateHeadYaw(
  noseTip: number[],
  leftEye: number[],
  rightEye: number[]
): number {
  const eyeCenter = [
    (leftEye[0] + rightEye[0]) / 2,
    (leftEye[1] + rightEye[1]) / 2,
  ];
  const dx = noseTip[0] - eyeCenter[0];
  const eyeWidth = euclideanDistance(leftEye, rightEye);
  if (eyeWidth === 0) return 0;
  return (dx / eyeWidth) * 90; // degrees approximation
}

// Calculate average pixel brightness from image data
export function calculateBrightness(imageData: number[]): number {
  if (imageData.length === 0) return 128;
  const sum = imageData.reduce((acc, val) => acc + val, 0);
  return sum / imageData.length;
}