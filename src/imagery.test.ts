import { describe, expect, it } from 'vitest';
import { isWinter, parseCaptures, parseImageDate } from './imagery';

const month = (y: number, m: number) => new Date(y, m - 1, 1);

describe('parseCaptures', () => {
  it('reads pano IDs and finds the date whatever its property is called', () => {
    // Shaped like the undocumented `time` array: minified date key, unsorted.
    const data = {
      time: [
        { pano: 'b', bD: month(2014, 6) },
        { pano: 'a', xY: month(2011, 8) },
        { pano: 'c', q: 'not a date', zz: month(2026, 4) },
      ],
    };
    expect(parseCaptures(data)).toEqual([
      { pano: 'a', date: month(2011, 8) },
      { pano: 'b', date: month(2014, 6) },
      { pano: 'c', date: month(2026, 4) },
    ]);
  });

  it('keeps entries without a date and drops malformed or duplicate ones', () => {
    const data = { time: [{ pano: 'a' }, null, { nope: 1 }, { pano: 'a', d: month(2020, 1) }, 'x'] };
    expect(parseCaptures(data)).toEqual([{ pano: 'a', date: null }]);
  });

  it('returns nothing when the list is missing', () => {
    expect(parseCaptures({})).toEqual([]);
    expect(parseCaptures(null)).toEqual([]);
    expect(parseCaptures({ time: 'nope' })).toEqual([]);
  });
});

describe('parseImageDate', () => {
  it('parses the documented YYYY-MM format as local midnight on the 1st', () => {
    expect(parseImageDate('2011-08')).toEqual(month(2011, 8));
    expect(parseImageDate(undefined)).toBeNull();
    expect(parseImageDate('Aug 2011')).toBeNull();
  });
});

describe('isWinter', () => {
  it('uses Dec–Feb in the north and Jun–Aug in the south, none in the tropics', () => {
    expect(isWinter(month(2019, 1), 40)).toBe(true);
    expect(isWinter(month(2019, 12), 40)).toBe(true);
    expect(isWinter(month(2019, 3), 40)).toBe(false);
    expect(isWinter(month(2019, 7), -34)).toBe(true);
    expect(isWinter(month(2019, 1), -34)).toBe(false);
    expect(isWinter(month(2019, 1), 10)).toBe(false);
    expect(isWinter(null, 40)).toBe(false);
  });
});
