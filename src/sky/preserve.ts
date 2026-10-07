// Street View draws with WebGL, whose canvas is normally wiped once each
// frame has been shown, so a copy taken at any other moment comes out blank.
// Asking for the drawing to be kept makes the canvas readable whenever. The
// request has to be in place before Street View creates its canvas, so this
// module is imported first, at startup, and acts only when the sky map is
// on: switching it on or off reloads the page.

const KEY = 'horizon.sky';

/** Whether this browser can run the sky map's model on the graphics card (WebGPU). On the processor each look holds the page up, so the sky map isn't on there. */
export const skyOffered = 'gpu' in navigator;

/**
 * Whether the sky map is on: it is wherever the browser can run it, unless
 * the visitor has switched it off (kept in this browser: it's about the
 * visitor's device, not the view being shared).
 */
export function skyEnabled(): boolean {
  if (!skyOffered) return false;
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

/** Switches the sky map on or off for the next time the page loads. */
export function setSkyEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

/** Whether canvases created from now on keep their drawing. */
export let preserving = false;

const original = HTMLCanvasElement.prototype.getContext;

/**
 * A canvas's context as the browser would give it, whatever is switched on
 * here: for a canvas of the app's own (the chart's), which has no use for
 * its drawing being kept and would only pay for it.
 */
export function plainContext(canvas: HTMLCanvasElement, type: string, attributes?: object): RenderingContext | null {
  return (original as (this: HTMLCanvasElement, type: string, attributes?: object) => RenderingContext | null).call(canvas, type, attributes);
}

if (skyEnabled()) {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, attributes?: object) {
    const keep = type === 'webgl' || type === 'webgl2' ? { ...attributes, preserveDrawingBuffer: true } : attributes;
    return (original as (this: HTMLCanvasElement, type: string, attributes?: object) => RenderingContext | null).call(
      this,
      type,
      keep,
    );
  } as typeof HTMLCanvasElement.prototype.getContext;
  preserving = true;
}
