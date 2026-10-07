import { describe, expect, it } from 'vitest';
import { Places, type TextStore } from './places';

/** Somewhere to keep text, as the browser's local storage does: with a limit on how much, if given one. */
function store(limit = Infinity): TextStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  const used = () => [...items.values()].reduce((sum, text) => sum + text.length, 0);
  return {
    items,
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, text) => {
      if (used() - (items.get(name)?.length ?? 0) + text.length > limit) throw new Error('full');
      items.set(name, text);
    },
    removeItem: (name) => void items.delete(name),
  };
}

/** So many bytes, all different from the next place's. */
const bytes = (count: number, seed: number) => Uint8Array.from({ length: count }, (_, i) => (i * 31 + seed * 7) & 255);

describe('Places', () => {
  it('keeps a place by its panorama and the model, and gives it back', () => {
    const places = new Places(store());
    const here = Places.key('pano-a', 'model-1');
    expect(places.recall(here)).toBeNull();
    places.keep(here, bytes(5000, 1));
    expect(Array.from(places.recall(here)!)).toEqual(Array.from(bytes(5000, 1)));
    expect(places.recall(Places.key('pano-a', 'model-2'))).toBeNull();
    expect(places.recall(Places.key('pano-b', 'model-1'))).toBeNull();
    // Kept again, it's the later that's given back.
    places.keep(here, bytes(300, 2));
    expect(Array.from(places.recall(here)!)).toEqual(Array.from(bytes(300, 2)));
    expect(places.count).toBe(1);
  });

  it('has them still when the page is loaded again', () => {
    const kept = store();
    new Places(kept).keep('a', bytes(2000, 3));
    const later = new Places(kept);
    expect(later.count).toBe(1);
    expect(Array.from(later.recall('a')!)).toEqual(Array.from(bytes(2000, 3)));
  });

  it('lets the places longest unwanted go when there are too many to keep', () => {
    // Room for three of these (each is 4,000 characters as it's stored).
    const kept = store();
    const places = new Places(kept, 13_000);
    for (const name of ['a', 'b', 'c']) places.keep(name, bytes(3000, name.charCodeAt(0)));
    expect(places.count).toBe(3);
    // The first is wanted again, so it's the second that goes for a fourth.
    places.recall('a');
    places.keep('d', bytes(3000, 9));
    expect(places.count).toBe(3);
    const again = new Places(kept, 13_000);
    expect(again.recall('b')).toBeNull();
    for (const name of ['a', 'c', 'd']) expect(again.recall(name)).not.toBeNull();
  });

  it('makes do with memory where nothing can be stored, or no more will go', () => {
    const none = new Places(null);
    none.keep('a', bytes(100, 1));
    expect(Array.from(none.recall('a')!)).toEqual(Array.from(bytes(100, 1)));
    expect(none.count).toBe(1);
    // A store that's full of something else: the place is had for this visit, and nothing breaks.
    const full = store(1000);
    const places = new Places(full);
    places.keep('a', bytes(3000, 1));
    expect(Array.from(places.recall('a')!)).toEqual(Array.from(bytes(3000, 1)));
    expect(new Places(full).recall('a')).toBeNull();
  });

  it('keeps track of what another tab keeps in the same store', () => {
    // Two tabs of the site, each with its own Places over the one store.
    const kept = store();
    const one = new Places(kept, 13_000);
    const other = new Places(kept, 13_000);
    one.keep('a', bytes(3000, 1));
    other.keep('b', bytes(3000, 2));
    one.keep('c', bytes(3000, 3));
    expect(one.count).toBe(3);
    expect(other.count).toBe(3);
    expect(Array.from(one.recall('b')!)).toEqual(Array.from(bytes(3000, 2)));
    // And what one lets go for want of room is the oldest of them all, whoever kept it.
    other.keep('d', bytes(3000, 4));
    expect(new Places(kept, 13_000).recall('a')).toBeNull();
    expect(other.count).toBe(3);
  });

  it('forgets them all', () => {
    const kept = store();
    const places = new Places(kept);
    places.keep('a', bytes(100, 1));
    places.keep('b', bytes(100, 2));
    places.forget();
    expect(places.count).toBe(0);
    expect(places.recall('a')).toBeNull();
    expect(kept.items.size).toBe(0);
  });
});
