// What's been made of the sky at each place been to, kept by for coming
// back: a step back along the street, or the same place another day. The
// sky doesn't have to be found again from nothing. It's there at once, and
// the looks made from then on change it wherever they're sure of something
// else.
//
// What's kept is what SkyEvidence.keep() gives: what each cell of the grid
// is held to be, 8 to 28 thousand characters for the places tried. It's
// kept under the panorama's ID (a different capture of the same spot is a
// different picture, and has its own) and the model's name (another model
// makes another sky map). It's held in memory for this visit to the page,
// and in the browser's local storage for the next. Nothing leaves the
// browser.

/** Each place is stored under this and its key; and the list of them, with when each was last wanted and how big it is, under INDEX. */
const PREFIX = 'horizon.sky.place.';
const INDEX = 'horizon.sky.places';
/**
 * How the sky map is made, as far as what's kept goes: part of every key,
 * so that what an earlier way of making it kept isn't taken for this one's.
 * To be raised whenever the rules change enough for old maps to be wrong.
 */
const MADE = 1;

/** Somewhere to keep text by name: the browser's local storage, or nothing. */
export type TextStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A place in the store: its key, when it was last wanted, and its size there in characters. */
type Listed = [key: string, at: number, size: number];

const toText = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
};
const toBytes = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export class Places {
  private readonly memory = new Map<string, Uint8Array>();

  /**
   * `store` is where places outlast the page (null: they don't). No more
   * than `budget` characters are kept there, the places longest unwanted
   * going first: a browser allows a site about five million in all.
   */
  constructor(
    private readonly store: TextStore | null,
    private readonly budget = 2_000_000,
  ) {}

  /** The key a place's sky is kept under: the panorama, and the model that looked at it. */
  static key(pano: string, model: string): string {
    return `${MADE}|${model}|${pano}`;
  }

  /**
   * What's in the store, oldest wanted first. Read from the store each time
   * it's needed, not held: another tab of the same site keeps places there
   * too, and a list held here would lose track of them.
   */
  private listed(): Listed[] {
    try {
      const list = JSON.parse(this.store?.getItem(INDEX) ?? '[]');
      if (Array.isArray(list)) return list.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number' && typeof e[2] === 'number');
    } catch {
      // (A list that doesn't read is no list.)
    }
    return [];
  }

  private list(index: Listed[]): void {
    try {
      this.store?.setItem(INDEX, JSON.stringify(index));
    } catch {
      // (Not listed, then: found again by its key if it's asked for.)
    }
  }

  /** How many places are kept (in the store, or failing one in memory). */
  get count(): number {
    return this.store ? this.listed().length : this.memory.size;
  }

  /** Drops the places longest unwanted from the store until `room` characters more would fit. */
  private makeRoom(index: Listed[], room: number): void {
    let used = 0;
    for (const entry of index) used += entry[2];
    while (index.length && used + room > this.budget) {
      const [key, , size] = index.shift()!;
      this.store?.removeItem(PREFIX + key);
      used -= size;
    }
  }

  /** What was kept of a place, or null. */
  recall(key: string): Uint8Array | null {
    let kept = this.memory.get(key) ?? null;
    if (!kept && this.store) {
      try {
        const text = this.store.getItem(PREFIX + key);
        if (text) kept = toBytes(text);
      } catch {
        kept = null;
      }
      if (kept) this.memory.set(key, kept);
    }
    if (kept && this.store) {
      // (Wanted just now: the last to go.)
      const index = this.listed();
      const at = index.findIndex((entry) => entry[0] === key);
      if (at >= 0) {
        const [entry] = index.splice(at, 1);
        entry[1] = Date.now();
        index.push(entry);
        this.list(index);
      }
    }
    return kept;
  }

  /** Keeps a place: in memory, and in the store if it will go. */
  keep(key: string, kept: Uint8Array): void {
    this.memory.set(key, kept);
    if (!this.store) return;
    const text = toText(kept);
    const index = this.listed();
    const at = index.findIndex((entry) => entry[0] === key);
    if (at >= 0) index.splice(at, 1);
    if (text.length > this.budget) {
      this.store.removeItem(PREFIX + key);
      this.list(index);
      return;
    }
    this.makeRoom(index, text.length);
    try {
      this.store.setItem(PREFIX + key, text);
    } catch {
      // (The browser's own limit, reached by whatever else the site keeps: half of what's here goes, and it's tried once more.)
      this.makeRoom(index, this.budget / 2 + text.length);
      try {
        this.store.setItem(PREFIX + key, text);
      } catch {
        this.store.removeItem(PREFIX + key);
        this.list(index);
        return;
      }
    }
    index.push([key, Date.now(), text.length]);
    this.list(index);
  }

  /** Forgets every place. */
  forget(): void {
    this.memory.clear();
    for (const [key] of this.listed()) this.store?.removeItem(PREFIX + key);
    this.store?.removeItem(INDEX);
  }
}
