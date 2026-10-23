import { Platform } from 'react-native';

/** Step C2a: the menu-scan source screen's file limits — mirrors backend/ai/views.py's own caps so
 * a bad file is caught here instead of round-tripping to the server first. */
export const MAX_PHOTOS = 6;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_LONG_SIDE = 1600;
const JPEG_QUALITY = 0.8;
const MIN_JPEG_QUALITY = 0.4;

export type MenuFileErrorCode = 'wrong_type' | 'too_big';

export function validateImageType(file: File): MenuFileErrorCode | null {
  return ALLOWED_IMAGE_TYPES.includes(file.type) ? null : 'wrong_type';
}

export function validatePdfFile(file: File): MenuFileErrorCode | null {
  if (file.type !== 'application/pdf') return 'wrong_type';
  if (file.size > MAX_PDF_BYTES) return 'too_big';
  return null;
}

function scaledSize(width: number, height: number, maxLongSide: number) {
  const longSide = Math.max(width, height);
  if (longSide <= maxLongSide) return { width, height };
  const scale = maxLongSide / longSide;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality));
}

/** Resizes to ~1600px on the long side and re-encodes as JPEG ~0.8 quality, stepping quality down
 * further if it's still over MAX_IMAGE_BYTES — web only (canvas/createImageBitmap), per this step's
 * spec. Native platforms, or any failure along the way, just get the original file back; the
 * backend's own MAX_IMAGE_BYTES check is the real backstop either way. */
export async function resizeImageForUpload(file: File): Promise<File> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = scaledSize(bitmap.width, bitmap.height, MAX_LONG_SIDE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    let quality = JPEG_QUALITY;
    let blob = await canvasToBlob(canvas, quality);
    while (blob && blob.size > MAX_IMAGE_BYTES && quality > MIN_JPEG_QUALITY) {
      quality -= 0.1;
      blob = await canvasToBlob(canvas, quality);
    }
    if (!blob) return file;

    const name = `${file.name.replace(/\.\w+$/, '')}.jpg`;
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
