// The sky map: finding the sky in the Street View frame on screen, and
// keeping what's found over the whole sky as the view is turned. See
// index.ts for how the pieces fit together.

/**
 * A model's raw map of a frame: how sky-like each part of it is, 0 (not sky)
 * to 1 (sky), on a grid of its own laid over the whole frame, top row first,
 * each value covering a cell. And what the model itself calls each point:
 * the class whose score is highest there, by its place in `names`.
 */
export interface RawMap {
  width: number;
  height: number;
  sky: Float32Array;
  labels: { classes: Uint8Array; names: readonly string[] };
}

/**
 * Something that finds the sky in a frame. Everything after this step sees
 * only the raw map, so another model or runtime can stand in here.
 */
export interface SkyDetector {
  /** How it's running, for a readout: the runtime, and whether on the graphics card. */
  readonly description: string;
  /** The width it shrinks a frame to: no point handing it one any wider. */
  readonly inputSize: number;
  detect(frame: ImageData): Promise<RawMap>;
  /** Frees the model. */
  dispose(): void;
}

/** A frame's brightness (0–255), laid over the frame like an image, top row first. */
export interface Picture {
  width: number;
  height: number;
  brightness: Uint8Array | Uint8ClampedArray | Float32Array;
}

/** ADE20K's 150 kinds of thing, in the order a model trained on it scores them (counted from 0). */
// prettier-ignore
export const ADE_NAMES = [
  'wall', 'building', 'sky', 'floor', 'tree', 'ceiling', 'road', 'bed', 'windowpane', 'grass', 'cabinet', 'sidewalk', 'person', 'earth', 'door',
  'table', 'mountain', 'plant', 'curtain', 'chair', 'car', 'water', 'painting', 'sofa', 'shelf', 'house', 'sea', 'mirror', 'rug', 'field', 'armchair',
  'seat', 'fence', 'desk', 'rock', 'wardrobe', 'lamp', 'bathtub', 'railing', 'cushion', 'base', 'box', 'column', 'signboard', 'chest of drawers',
  'counter', 'sand', 'sink', 'skyscraper', 'fireplace', 'refrigerator', 'grandstand', 'path', 'stairs', 'runway', 'case', 'pool table', 'pillow',
  'screen door', 'stairway', 'river', 'bridge', 'bookcase', 'blind', 'coffee table', 'toilet', 'flower', 'book', 'hill', 'bench', 'countertop', 'stove',
  'palm', 'kitchen island', 'computer', 'swivel chair', 'boat', 'bar', 'arcade machine', 'hovel', 'bus', 'towel', 'light', 'truck', 'tower',
  'chandelier', 'awning', 'streetlight', 'booth', 'television receiver', 'airplane', 'dirt track', 'apparel', 'pole', 'land', 'bannister', 'escalator',
  'ottoman', 'bottle', 'buffet', 'poster', 'stage', 'van', 'ship', 'fountain', 'conveyer belt', 'canopy', 'washer', 'plaything', 'swimming pool',
  'stool', 'barrel', 'basket', 'waterfall', 'tent', 'bag', 'minibike', 'cradle', 'oven', 'ball', 'food', 'step', 'tank', 'trade name', 'microwave',
  'pot', 'animal', 'bicycle', 'lake', 'dishwasher', 'screen', 'blanket', 'sculpture', 'hood', 'sconce', 'vase', 'traffic light', 'tray', 'ashcan',
  'fan', 'pier', 'crt screen', 'plate', 'monitor', 'bulletin board', 'shower', 'radiator', 'glass', 'clock', 'flag',
] as const;

/**
 * The few kinds of thing a model's many classes are sorted into: a name, a
 * colour for showing them (red, green, blue), and the classes that count as
 * it, by the names the models' lists have them under. Whatever isn't listed
 * is the last, "other". The rules that go by a model's labels (doubt.ts,
 * look.ts) go by these kinds.
 */
export const KINDS: { name: string; colour: [number, number, number]; classes: readonly string[] }[] = [
  { name: 'sky', colour: [70, 160, 255], classes: ['sky'] },
  {
    name: 'building',
    colour: [235, 105, 55],
    // prettier-ignore
    classes: ['wall', 'building', 'windowpane', 'house', 'skyscraper', 'tower', 'hovel', 'grandstand', 'bridge', 'pier', 'ceiling', 'door', 'column',
      'fence', 'railing', 'awning', 'canopy', 'stairs', 'stairway', 'booth', 'bannister'],
  },
  { name: 'tree or plant', colour: [50, 175, 70], classes: ['tree', 'plant', 'palm', 'flower', 'vegetation'] },
  {
    name: 'ground',
    colour: [150, 115, 80],
    // prettier-ignore
    classes: ['floor', 'road', 'grass', 'sidewalk', 'earth', 'mountain', 'field', 'rock', 'sand', 'path', 'runway', 'hill', 'dirt track', 'land', 'terrain'],
  },
  { name: 'water', colour: [25, 55, 200], classes: ['water', 'sea', 'river', 'lake', 'swimming pool', 'waterfall', 'fountain'] },
  {
    name: 'pole, light or sign',
    colour: [255, 220, 30],
    // prettier-ignore
    classes: ['pole', 'streetlight', 'traffic light', 'traffic sign', 'signboard', 'light', 'lamp', 'flag', 'poster', 'trade name', 'bulletin board', 'sconce'],
  },
  {
    name: 'person or vehicle',
    colour: [225, 55, 200],
    // prettier-ignore
    classes: ['person', 'rider', 'car', 'bus', 'truck', 'van', 'train', 'bicycle', 'minibike', 'motorcycle', 'boat', 'ship', 'airplane', 'animal'],
  },
  { name: 'other', colour: [150, 150, 150], classes: [] },
];

/** Which of KINDS each of a model's classes is, given the names of its classes in order. */
export function kindsOf(names: readonly string[]): Uint8Array {
  return Uint8Array.from(names, (name) => {
    const kind = KINDS.findIndex((k) => k.classes.includes(name));
    return kind < 0 ? KINDS.length - 1 : kind;
  });
}
