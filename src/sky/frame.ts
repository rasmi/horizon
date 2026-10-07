import type { Picture } from './types';

// Reading what Street View is showing: a copy of the viewer's canvas for
// the model, and a very small one for telling when a place's picture has
// arrived. (The canvas is only readable with preserve.ts in place.)

/** The viewer's own canvas: the biggest one in its pane. Null until it has one. */
function viewerCanvas(pano: HTMLElement): HTMLCanvasElement | null {
  let source: HTMLCanvasElement | null = null;
  for (const c of pano.querySelectorAll('canvas')) {
    if (!source || c.width * c.height > source.width * source.height) source = c;
  }
  return source?.width ? source : null;
}

const grab = document.createElement('canvas');
const grabCtx = grab.getContext('2d', { willReadFrequently: true })!;

/** A copy of what Street View is showing, shrunk to `width` (if it's bigger); null if it can't be read. */
export function captureFrame(pano: HTMLElement, width: number): ImageData | null {
  const source = viewerCanvas(pano);
  if (!source) return null;
  grab.width = Math.min(width, source.width);
  grab.height = Math.round((grab.width * source.height) / source.width);
  grabCtx.drawImage(source, 0, 0, grab.width, grab.height);
  return grabCtx.getImageData(0, 0, grab.width, grab.height);
}

/**
 * Whether a frame shows nothing yet: one flat colour, as the viewer's canvas
 * is until a place's imagery starts to arrive. (A model makes something of
 * that all the same: sky everywhere, or none.) Real imagery is never exactly
 * flat, however empty the sky.
 */
export function showsNothing(frame: ImageData): boolean {
  const { data } = frame;
  const stride = Math.max(1, Math.floor(data.length / 4 / 2000)) * 4;
  for (let p = stride; p < data.length; p += stride) {
    if (Math.abs(data[p] - data[0]) + Math.abs(data[p + 1] - data[1]) + Math.abs(data[p + 2] - data[2]) > 2) return false;
  }
  return true;
}

/** A frame's brightness: for telling what the model is in doubt about by how it looks (doubt.ts). */
export function brightnessOf(frame: ImageData): Picture {
  const brightness = new Uint8Array(frame.width * frame.height);
  for (let i = 0, p = 0; i < brightness.length; i++, p += 4) {
    brightness[i] = 0.299 * frame.data[p] + 0.587 * frame.data[p + 1] + 0.114 * frame.data[p + 2];
  }
  return { width: frame.width, height: frame.height, brightness };
}

const small = document.createElement('canvas');
small.width = small.height = 32;
const smallCtx = small.getContext('2d', { willReadFrequently: true })!;

/** What the viewer is showing, very small: for telling when a place's picture has arrived. Null if it can't be read. */
export function glimpse(pano: HTMLElement): Uint8ClampedArray | null {
  const source = viewerCanvas(pano);
  if (!source) return null;
  smallCtx.clearRect(0, 0, 32, 32);
  smallCtx.drawImage(source, 0, 0, 32, 32);
  return smallCtx.getImageData(0, 0, 32, 32).data;
}
