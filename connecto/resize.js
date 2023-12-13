import {Frame} from 'react-native-vision-camera';

const CACHE_ID = '__cachedArrayForResizer';
function getArrayFromCache(size) {
  'worklet';
  if (global[CACHE_ID] == null || global[CACHE_ID].length != size) {
    global[CACHE_ID] = new Int8Array(size);
  }
  return global[CACHE_ID];
}

/**
 * Resizes the given Frame to the given target width and height.
 * For 1920x1080 BGRA -> 192x192 RGB Frames, this takes roughly 5ms on an iPhone 11 Pro.
 */
export function resize(frame, width, height) {
  'worklet';
  return frame;
  const inputBytesPerRow = frame.bytesPerRow;
  const inputWidth = frame.width;
  const inputHeight = frame.height;
  const inputPixelSize = Math.floor(inputBytesPerRow / inputWidth); // 4 for BGRA
  const padding = inputBytesPerRow - inputWidth * inputPixelSize; // on some frames there's additional padding

  const targetWidth = width;
  const targetHeight = height;
  const targetPixelSize = 3; // 3 for RGB

  const arrayData = frame.toArrayBuffer();
  const outputFrame = getArrayFromCache(
    targetWidth * targetHeight * targetPixelSize,
  );

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.floor((x / targetWidth) * (inputWidth + padding));
      const srcY = Math.floor((y / targetHeight) * inputHeight);

      const srcIndex = (srcY * (inputWidth + padding) + srcX) * inputPixelSize;
      const destIndex = (y * targetWidth + x) * targetPixelSize;

      // Convert from BGRA to RGB
      outputFrame[destIndex] = arrayData[srcIndex + 2]; // R
      outputFrame[destIndex + 1] = arrayData[srcIndex + 1]; // G
      outputFrame[destIndex + 2] = arrayData[srcIndex]; // B
    }
  }

  return outputFrame;
}
