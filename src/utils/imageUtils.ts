import {NativeModules} from 'react-native';
import RNFS from 'react-native-fs';

// Convert image URI to base64 then to pixel array
export async function uriToPixelArray(uri: string): Promise<{
  pixels: number[];
  width: number;
  height: number;
} | null> {
  try {
    // Read file as base64
    const cleanUri = uri.replace('file://', '');
    const base64 = await RNFS.readFile(cleanUri, 'base64');

    // Decode base64 to bytes
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // For JPEG, we need to parse image dimensions
    // Simple approach: use fixed size and normalize
    // Width/height estimation from JPEG header
    let width = 480;
    let height = 640;

    // Find JPEG SOF marker for dimensions
    for (let i = 0; i < bytes.length - 8; i++) {
      if (bytes[i] === 0xff &&
         (bytes[i+1] === 0xc0 || bytes[i+1] === 0xc2)) {
        height = (bytes[i+5] << 8) | bytes[i+6];
        width = (bytes[i+7] << 8) | bytes[i+8];
        break;
      }
    }

    // Convert bytes to pixel array (simplified RGB extraction)
    // In production use a proper JPEG decoder
    const pixels: number[] = [];
    const step = Math.max(1, Math.floor(bytes.length / (width * height * 3)));
    for (let i = 0; i < width * height * 4; i += 4) {
      const byteIdx = Math.min(i * step, bytes.length - 3);
      pixels.push(bytes[byteIdx]);       // R
      pixels.push(bytes[byteIdx + 1]);   // G
      pixels.push(bytes[byteIdx + 2]);   // B
      pixels.push(255);                   // A
    }

    return {pixels, width, height};
  } catch (error) {
    console.error('Image processing error:', error);
    return null;
  }
}

export function calculateBrightness(pixels: number[]): number {
  if (pixels.length === 0) return 128;
  let sum = 0;
  const samples = Math.min(pixels.length, 1000);
  for (let i = 0; i < samples; i++) {
    sum += pixels[i];
  }
  return sum / samples;
}