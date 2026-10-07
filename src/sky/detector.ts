import { isWebGPUSupported, loadAndCompile, loadLiteRt, Tensor, type CompiledModel } from '@litertjs/core';
import { loadModel, type ModelId } from './model';
import { ADE_NAMES, type RawMap, type SkyDetector } from './types';

// Runs the model (see model.ts) under LiteRT.js. The runtime runs the model
// and nothing more: the frame is resized and normalised for it here, and its
// answer made into a raw map here.
//
// It runs on the graphics card (WebGPU) where it can, and on the processor
// (WebAssembly) where it can't. "Can't" shows up at three points, each
// handled: the browser has no WebGPU; the model won't compile for the
// graphics card, or only partly; or a frame fails there, or comes back as
// nonsense, once running. The last switches to the processor for good and
// redoes that frame.
//
// (On the processor the model runs on the page's own thread, and each look
// holds the page up for as long as it takes.)

/** ImageNet's usual mean and spread for each colour: what the model wants taken off and divided by. */
const MEAN = [0.485, 0.456, 0.406];
const SPREAD = [0.229, 0.224, 0.225];

/** The runtime's own files: as the package has them on the dev server, and copied beside the page in a build (vite.config.ts). */
const RUNTIME_DIR = import.meta.env.DEV ? '/node_modules/@litertjs/core/wasm/' : new URL('litert/', document.baseURI).href;

type Accelerator = 'webgpu' | 'wasm';

/** The runtime, loaded once. */
let runtime: Promise<unknown> | undefined;

/** The model compiled for the graphics card, or null if it can't run there in full. */
async function compileForGraphicsCard(file: Uint8Array): Promise<CompiledModel | null> {
  if (!isWebGPUSupported()) return null;
  try {
    const model = await loadAndCompile(file, { accelerator: 'webgpu' });
    if (model.isFullyAccelerated) return model;
    // Sharing a model between graphics card and processor is slower than
    // the processor alone, and isn't possible in every browser.
    model.delete();
  } catch (err) {
    console.warn('[sky] the graphics card could not take the model:', err);
  }
  return null;
}

/** Whether an answer looks like a model's: all numbers, and not the same everywhere. */
function plausible(values: ArrayLike<number>): boolean {
  let low = Infinity;
  let high = -Infinity;
  const step = Math.max(1, Math.floor(values.length / 4096));
  for (let i = 0; i < values.length; i += step) {
    if (!Number.isFinite(values[i])) return false;
    low = Math.min(low, values[i]);
    high = Math.max(high, values[i]);
  }
  return high > low;
}

/**
 * Makes the model ready to run. Fails if its file or the runtime's can't be
 * had, or (with `graphicsCardOnly`) if the graphics card can't take the
 * model whole: on the processor each look holds the page up, which is no
 * way to start for a visitor who hasn't asked for any of this.
 */
export async function createDetector(id: ModelId, graphicsCardOnly = false): Promise<SkyDetector> {
  runtime ??= loadLiteRt(RUNTIME_DIR);
  // (The file is fetched while the runtime starts; it's this browser's own copy after the first time.)
  const [file] = await Promise.all([loadModel(id), runtime]);
  let accelerator: Accelerator = 'webgpu';
  let compiled = await compileForGraphicsCard(file);
  if (!compiled) {
    if (graphicsCardOnly) throw new Error("the graphics card can't run the sky map's model");
    accelerator = 'wasm';
    compiled = await loadAndCompile(file, { accelerator });
  }
  // The model's input: one image, [1, height, width, 3].
  const [, inHeight, inWidth] = compiled.getInputDetails()[0].shape;
  const resize = new OffscreenCanvas(inWidth, inHeight);
  const ctx = resize.getContext('2d', { willReadFrequently: true })!;
  const source = new OffscreenCanvas(1, 1);

  /** Runs the model on a prepared frame: two numbers for each point, [1, height, width, 2]. */
  async function run(data: Float32Array<ArrayBuffer>): Promise<{ values: ArrayLike<number>; dims: number[] }> {
    const tensor = new Tensor(data, [1, inHeight, inWidth, 3]);
    const input = accelerator === 'webgpu' ? await tensor.moveTo('webgpu') : tensor;
    try {
      const outputs = await compiled!.run(input);
      const output = accelerator === 'webgpu' ? await outputs[0].moveTo('wasm') : outputs[0];
      // (A copy: the tensor's own memory goes when it's deleted.)
      const values = output.toTypedArray().slice();
      const dims = Array.from(output.type.layout.dimensions);
      for (const t of [...outputs, output]) if (!t.deleted) t.delete();
      return { values, dims };
    } finally {
      if (!input.deleted) input.delete();
    }
  }

  return {
    get description() {
      return `LiteRT.js (${accelerator === 'webgpu' ? 'graphics card' : 'processor'})`;
    },
    inputSize: inWidth,
    dispose() {
      if (compiled && !compiled.deleted) compiled.delete();
    },
    async detect(frame: ImageData): Promise<RawMap> {
      // Squash the frame to the model's size; the map is stretched back over
      // the frame afterwards, so the distortion cancels out.
      source.width = frame.width;
      source.height = frame.height;
      source.getContext('2d')!.putImageData(frame, 0, 0);
      ctx.drawImage(source, 0, 0, inWidth, inHeight);
      const rgba = ctx.getImageData(0, 0, inWidth, inHeight).data;
      const data = new Float32Array(inWidth * inHeight * 3);
      for (let i = 0, o = 0; i < rgba.length; i += 4) {
        data[o++] = (rgba[i] / 255 - MEAN[0]) / SPREAD[0];
        data[o++] = (rgba[i + 1] / 255 - MEAN[1]) / SPREAD[1];
        data[o++] = (rgba[i + 2] / 255 - MEAN[2]) / SPREAD[2];
      }

      let result = await run(data).catch((err) => {
        if (accelerator === 'wasm') throw err;
        console.warn('[sky] the graphics card failed on a frame:', err);
        return null;
      });
      if (accelerator === 'webgpu' && (!result || !plausible(result.values))) {
        // The graphics card let us down: the processor from here on.
        compiled!.delete();
        accelerator = 'wasm';
        compiled = await loadAndCompile(file, { accelerator });
        result = await run(data);
      }
      const { values, dims } = result!;

      // For each point: sky's lead over the solid kinds as log-odds, to be squashed to 0–1 (half is a tie); and the class ahead.
      const [, height, width] = dims;
      const cells = width * height;
      const sky = new Float32Array(cells);
      const classes = new Uint8Array(cells);
      for (let i = 0; i < cells; i++) {
        sky[i] = 1 / (1 + Math.exp(-values[i * 2]));
        classes[i] = Math.round(values[i * 2 + 1]);
      }
      return { width, height, sky, labels: { classes, names: ADE_NAMES } };
    },
  };
}
