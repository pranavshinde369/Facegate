import {NativeModules} from 'react-native';
import {l2Normalize, averageEmbeddings, cosineSimilarity} from '../utils/mathUtils';
import {Identity, BenchmarkMetrics} from '../types';

const {OnnxModule} = NativeModules;

export const MODELS = {
  DETECTOR: 'ultraface.onnx',
  RECOGNIZER: 'mobilefacenet_int8.onnx',
};

export const MATCH_THRESHOLD = 0.62;

class InferenceService {
  private modelsLoaded = false;
  private metrics: BenchmarkMetrics = {
    detectorMs: 0,
    recognizerMs: 0,
    totalInferenceMs: 0,
    fps: 0,
    modelBundleMB: 0,
    livenessMs: 0,
    similarityScore: 0,
    livenessScore: 0,
  };

  // Call once on app startup
  async loadAllModels(): Promise<void> {
    try {
      console.log('Loading AI models...');
      const start = Date.now();

      await Promise.all([
        OnnxModule.loadModel(MODELS.DETECTOR),
        OnnxModule.loadModel(MODELS.RECOGNIZER),
      ]);

      const totalMs = Date.now() - start;
      console.log(`Models loaded in ${totalMs}ms`);

      // Get bundle size
      const sizeMB = await OnnxModule.getModelBundleSizeMB();
      this.metrics.modelBundleMB = sizeMB;
      console.log(`Model bundle size: ${sizeMB.toFixed(2)} MB`);

      this.modelsLoaded = true;
    } catch (error) {
      console.error('Failed to load models:', error);
      throw error;
    }
  }

  isLoaded(): boolean {
    return this.modelsLoaded;
  }

  getMetrics(): BenchmarkMetrics {
    return {...this.metrics};
  }

  // Detect face in frame — input is flat float32 array [1,3,240,320]
  async detectFace(frameData: number[]): Promise<number[] | null> {
    try {
      const shape = [1, 3, 240, 320];
      const start = Date.now();

      const output: number[] = await OnnxModule.runInference(
        MODELS.DETECTOR,
        frameData,
        shape,
      );

      this.metrics.detectorMs = Date.now() - start;

      return this.parseBestDetection(output);
    } catch (error) {
      console.error('Detection error:', error);
      return null;
    }
  }

  // HIGH PERFORMANCE: Direct from URI
  async detectFaceFast(uri: string): Promise<number[] | null> {
    try {
      const start = Date.now();
      const output: number[] = await OnnxModule.detectFaceFromUri(
        MODELS.DETECTOR,
        uri,
      );
      this.metrics.detectorMs = Date.now() - start;

      // The native method appends originalWidth and originalHeight at the end
      const originalHeight = output.pop() as number;
      const originalWidth = output.pop() as number;

      return this.parseBestDetection(output);
    } catch (error) {
      console.error('Fast detection error:', error);
      return null;
    }
  }

  // Get 128-d face embedding — input is flat float32 array [1,3,112,112]
  async getEmbedding(faceData: number[]): Promise<number[]> {
    try {
      const shape = [1, 3, 112, 112];
      const start = Date.now();

      const output: number[] = await OnnxModule.runInference(
        MODELS.RECOGNIZER,
        faceData,
        shape,
      );

      this.metrics.recognizerMs = Date.now() - start;
      this.metrics.totalInferenceMs =
        this.metrics.detectorMs + this.metrics.recognizerMs;

      return l2Normalize(output);
    } catch (error) {
      console.error('Embedding error:', error);
      return [];
    }
  }

  // HIGH PERFORMANCE: Direct from URI with normalized bbox
  async getEmbeddingFast(uri: string, bbox: number[]): Promise<number[]> {
    try {
      const start = Date.now();
      const output: number[] = await OnnxModule.extractEmbeddingFromUri(
        MODELS.RECOGNIZER,
        uri,
        bbox[0],
        bbox[1],
        bbox[2],
        bbox[3]
      );

      this.metrics.recognizerMs = Date.now() - start;
      this.metrics.totalInferenceMs =
        this.metrics.detectorMs + this.metrics.recognizerMs;

      return l2Normalize(output);
    } catch (error) {
      console.error('Fast embedding error:', error);
      return [];
    }
  }

  // Find best matching identity from stored list
  findBestMatch(
    queryEmbedding: number[],
    identities: Identity[],
  ): {identity: Identity | null; confidence: number} {
    let bestMatch: Identity | null = null;
    let bestScore = 0;

    for (const identity of identities) {
      const score = cosineSimilarity(queryEmbedding, identity.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = identity;
      }
    }

    this.metrics.similarityScore = bestScore;

    if (bestScore >= MATCH_THRESHOLD) {
      return {identity: bestMatch, confidence: bestScore};
    }
    return {identity: null, confidence: bestScore};
  }

  // Parse UltraFace output to get best face bounding box
  private parseBestDetection(raw: number[]): number[] | null {
    const numAnchors = 4420;

    // UltraFace output: scores [1,4420,2] + boxes [1,4420,4]
    const scoresFlat = raw.slice(0, numAnchors * 2);
    const boxesFlat = raw.slice(numAnchors * 2);

    let bestScore = 0.7; // minimum confidence
    let bestBox: number[] | null = null;

    for (let i = 0; i < numAnchors; i++) {
      const score = scoresFlat[i * 2 + 1]; // face class score
      if (score > bestScore) {
        bestScore = score;
        const b = i * 4;
        bestBox = [
          boxesFlat[b],      // x1 normalized 0-1
          boxesFlat[b + 1],  // y1
          boxesFlat[b + 2],  // x2
          boxesFlat[b + 3],  // y2
          score,
        ];
      }
    }
    return bestBox;
  }

  // Prepare pixel data for detector input [1,3,240,320]
  prepareDetectorInput(
    pixels: number[],
    width: number,
    height: number,
  ): number[] {
    const targetW = 320;
    const targetH = 240;
    const result = new Array(1 * 3 * targetH * targetW).fill(0);

    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const srcX = Math.floor((x / targetW) * width);
        const srcY = Math.floor((y / targetH) * height);
        const srcIdx = (srcY * width + srcX) * 4; // RGBA

        const r = pixels[srcIdx] / 255.0;
        const g = pixels[srcIdx + 1] / 255.0;
        const b = pixels[srcIdx + 2] / 255.0;

        // CHW format
        result[0 * targetH * targetW + y * targetW + x] = r;
        result[1 * targetH * targetW + y * targetW + x] = g;
        result[2 * targetH * targetW + y * targetW + x] = b;
      }
    }
    return result;
  }

  // Prepare face crop for recognizer input [1,3,112,112]
  prepareFaceInput(
    pixels: number[],
    width: number,
    height: number,
    bbox: number[],
  ): number[] {
    const targetSize = 112;
    const result = new Array(1 * 3 * targetSize * targetSize).fill(0);

    const x1 = Math.floor(bbox[0] * width);
    const y1 = Math.floor(bbox[1] * height);
    const x2 = Math.floor(bbox[2] * width);
    const y2 = Math.floor(bbox[3] * height);
    const bboxW = Math.max(1, x2 - x1);
    const bboxH = Math.max(1, y2 - y1);

    for (let y = 0; y < targetSize; y++) {
      for (let x = 0; x < targetSize; x++) {
        const srcX = x1 + Math.floor((x / targetSize) * bboxW);
        const srcY = y1 + Math.floor((y / targetSize) * bboxH);
        const clampedX = Math.min(srcX, width - 1);
        const clampedY = Math.min(srcY, height - 1);
        const srcIdx = (clampedY * width + clampedX) * 4;

        // Normalize: (pixel/255 - 0.5) / 0.5
        const r = (pixels[srcIdx] / 255.0 - 0.5) / 0.5;
        const g = (pixels[srcIdx + 1] / 255.0 - 0.5) / 0.5;
        const b = (pixels[srcIdx + 2] / 255.0 - 0.5) / 0.5;

        result[0 * targetSize * targetSize + y * targetSize + x] = r;
        result[1 * targetSize * targetSize + y * targetSize + x] = g;
        result[2 * targetSize * targetSize + y * targetSize + x] = b;
      }
    }
    return result;
  }
}

export default new InferenceService();