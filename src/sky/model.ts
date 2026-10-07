// The model that finds the sky: PP-MobileSeg (base, trained on ADE20K),
// converted for LiteRT with its own last step and the app's reading of its
// scores inside the file. It takes one 512 × 512 image and hands back, for each point of a 128 × 128
// grid, how far sky's score is ahead of the buildings, trees and ground
// together, and which class is ahead.
//
// One file of it is served, from third_party/pp-mobileseg/ (which says
// whose work it is, and under what license). Another would be one more
// entry here, its file put beside this one's, and DEFAULT_MODEL changed:
// nothing else names either.

import x2fp16 from '../../third_party/pp-mobileseg/pp-mobileseg-base-ade-512-x2-fp16.tflite?url';

export interface SkyModel {
  /** Where its file is served from. */
  url: string;
  /** What it is, for a readout. */
  about: string;
}

export const MODELS = {
  /** Weights and biases 16 bits long: 12.9 MB. Its sky scores are within about 0.02 of the 32-bit file's. */
  'x2-fp16': { url: x2fp16, about: '16-bit weights, 12.9 MB' },
} satisfies Record<string, SkyModel>;
export type ModelId = keyof typeof MODELS;

/** The one the app uses. */
export const DEFAULT_MODEL: ModelId = 'x2-fp16';

/** Where a model's file is served from, in full. */
export const modelUrl = (id: ModelId): string => new URL(MODELS[id].url, document.baseURI).href;

/** The browser's cache the model's file is kept in, so that it's downloaded once and not at every visit. */
const CACHE = 'horizon-sky-model';

/**
 * The model's file: from this browser's own copy if it has one, and
 * otherwise downloaded and kept. (Kept under the file's address, which has
 * the model's name in it: another model is another entry, and this one's
 * coming in clears the rest out.) Where the browser has nowhere to keep it,
 * it's just downloaded. Fails if the file can't be had.
 */
export async function loadModel(id: ModelId): Promise<Uint8Array> {
  const url = modelUrl(id);
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const kept = await cache.match(url);
    if (kept) return new Uint8Array(await kept.arrayBuffer());
  } catch {
    // No cache to be had (a private window, or a page not served securely), or its copy can't be read: downloaded.
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`the sky map's model couldn't be downloaded (${response.status})`);
  // (The copy to keep is taken before the answer is read: it can be read only once.)
  const copy = response.clone();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (cache) {
    const into = cache;
    void (async () => {
      try {
        await into.put(url, copy);
        for (const other of await into.keys()) if (other.url !== url) await into.delete(other);
      } catch {
        // No room, or not allowed: it's downloaded again next time.
      }
    })();
  }
  return bytes;
}
