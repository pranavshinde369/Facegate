import {NativeModules} from 'react-native';

const {OnnxModule} = NativeModules;

/**
 * Convert an image URI to a decoded RGBA pixel array using native Android BitmapFactory.
 *
 * Previously this tried to "decode" JPEG bytes by reading raw compressed data as pixel
 * values — which produced garbage input for ONNX. Now delegates to Java side for proper
 * JPEG/PNG decoding via BitmapFactory.
 *
 * @param uri - file:// URI to the image
 * @param targetWidth - desired output width (default 480)
 * @param targetHeight - desired output height (default 640)
 * @returns Decoded RGBA pixel array with correct dimensions, or null on failure
 */
export async function uriToPixelArray(
  uri: string,
  targetWidth: number = 480,
  targetHeight: number = 640,
): Promise<{
  pixels: number[];
  width: number;
  height: number;
} | null> {
  try {
    // Use native Android BitmapFactory for proper JPEG/PNG decoding
    const pixelArray: number[] = await OnnxModule.decodeImageToPixels(
      uri,
      targetWidth,
      targetHeight,
    );

    if (!pixelArray || pixelArray.length === 0) {
      console.error('Native image decode returned empty array');
      return null;
    }

    return {
      pixels: pixelArray,
      width: targetWidth,
      height: targetHeight,
    };
  } catch (error) {
    console.error('Image processing error:', error);
    return null;
  }
}

/**
 * Calculate average brightness from RGBA pixel data.
 * Samples up to 1000 pixels for performance.
 * Uses luminance formula: 0.299*R + 0.587*G + 0.114*B
 */
export function calculateBrightness(pixels: number[]): number {
  if (pixels.length === 0) return 128;
  const maxSamples = Math.min(Math.floor(pixels.length / 4), 1000);
  let sum = 0;
  for (let i = 0; i < maxSamples; i++) {
    const idx = i * 4; // RGBA stride
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];
    // Standard luminance weighting
    sum += 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return sum / maxSamples;
}