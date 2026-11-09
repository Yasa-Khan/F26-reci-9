import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mergeIntervals, type Interval } from '../src/intervals';

// Valid intervals by construction: a start and a non-negative length, so
// start <= end always. Small ranges make overlaps, touches and duplicates common.
const interval: fc.Arbitrary<Interval> = fc
  .tuple(fc.integer({ min: -20, max: 20 }), fc.integer({ min: 0, max: 8 }))
  .map(([s, len]): Interval => [s, s + len]);
const intervalList = fc.array(interval, { maxLength: 15 });

const covers = (xs: readonly Interval[], p: number) => xs.some(([a, b]) => a <= p && p <= b);

describe('mergeIntervals', () => {
  // Pattern: invariant. Every input interval lies inside some output interval.
  it('every input interval lies inside some output interval', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        const uncovered = xs.filter(([s, e]) => !out.some(([a, b]) => a <= s && e <= b));
        expect(uncovered).toEqual([]);
      }),
    );
  });

  // Pattern: invariant. Output is sorted, valid, and consecutive intervals have a strict gap.
  it('output is sorted with strict gaps and valid intervals', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        for (const [s, e] of out) expect(s).toBeLessThanOrEqual(e);
        for (let i = 0; i + 1 < out.length; i++) {
          expect(out[i][1]).toBeLessThan(out[i + 1][0]);
        }
      }),
    );
  });

  // Pattern: differential. Coverage of every half-integer point matches a naive check
  // (so no point is gained, and gaps between integers are not filled).
  it('covers exactly the same points as the input', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        for (let p = -50; p <= 50; p += 0.5) {
          expect(covers(out, p)).toBe(covers(xs, p));
        }
      }),
    );
  });

  // Pattern: algebraic. Merging is idempotent.
  it('is idempotent', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const once = mergeIntervals(xs);
        expect(mergeIntervals(once)).toEqual(once);
      }),
    );
  });

  // Pattern: metamorphic. Input order does not matter.
  it('is independent of input order', () => {
    fc.assert(
      fc.property(
        intervalList.chain(xs => fc.tuple(fc.constant(xs), fc.shuffledSubarray(xs, { minLength: xs.length }))),
        ([xs, shuffled]) => {
          expect(mergeIntervals(shuffled)).toEqual(mergeIntervals(xs));
        },
      ),
    );
  });

  // Pattern: metamorphic. Duplicating the input changes nothing.
  it('ignores duplicates', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        expect(mergeIntervals([...xs, ...xs])).toEqual(mergeIntervals(xs));
      }),
    );
  });

  // Pattern: metamorphic. Shifting every input shifts every output by the same amount.
  it('commutes with translation', () => {
    fc.assert(
      fc.property(intervalList, fc.integer({ min: -100, max: 100 }), (xs, k) => {
        const shifted = mergeIntervals(xs.map(([s, e]): Interval => [s + k, e + k]));
        expect(shifted).toEqual(mergeIntervals(xs).map(([s, e]) => [s + k, e + k]));
      }),
    );
  });

  // Pattern: algebraic. Merging two lists equals merging their separately merged results.
  it('merge of concatenation equals merge of merged parts', () => {
    fc.assert(
      fc.property(intervalList, intervalList, (xs, ys) => {
        expect(mergeIntervals([...xs, ...ys])).toEqual(
          mergeIntervals([...mergeIntervals(xs), ...mergeIntervals(ys)]),
        );
      }),
    );
  });

  // Pattern: conditional. If the input is already sorted with strict gaps, it is returned unchanged.
  it('leaves already-disjoint sorted input unchanged', () => {
    const disjoint = fc
      .tuple(fc.integer({ min: -20, max: 20 }), fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 1, max: 5 })), { maxLength: 10 }))
      .map(([start, steps]) => {
        const out: Interval[] = [];
        let cur = start;
        for (const [len, gap] of steps) {
          out.push([cur, cur + len]);
          cur = cur + len + gap;
        }
        return out;
      });
    fc.assert(
      fc.property(disjoint, xs => {
        expect(mergeIntervals(xs)).toEqual(xs);
      }),
    );
  });

  // Pattern: conditional. Touching intervals [a,b],[b,c] merge into one.
  it('merges touching intervals', () => {
    fc.assert(
      fc.property(fc.integer({ min: -20, max: 20 }), fc.nat(10), fc.nat(10), (a, l1, l2) => {
        expect(mergeIntervals([[a + l1, a + l1 + l2], [a, a + l1]])).toEqual([[a, a + l1 + l2]]);
      }),
    );
  });

  // Pattern: invariant. The input array and its intervals are not modified.
  it('does not mutate its input', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const copy = xs.map(([s, e]): Interval => [s, e]);
        mergeIntervals(xs);
        expect(xs).toEqual(copy);
      }),
    );
  });

  // Pattern: conditional. Invalid intervals throw a RangeError.
  it('throws RangeError on invalid intervals', () => {
    const bad = fc.oneof(
      fc.tuple(fc.integer({ min: -20, max: 20 }), fc.integer({ min: 1, max: 10 })).map(([s, d]): Interval => [s, s - d]),
      fc.tuple(fc.integer({ min: -20, max: 20 }), fc.integer({ min: 0, max: 5 })).map(([s, l]): Interval => [s + 0.5, s + l + 1]),
      fc.tuple(fc.integer({ min: -20, max: 20 }), fc.integer({ min: 0, max: 5 })).map(([s, l]): Interval => [s, s + l + 0.5]),
    );
    fc.assert(
      fc.property(intervalList, bad, fc.nat(15), (xs, b, i) => {
        const withBad = [...xs];
        withBad.splice(Math.min(i, xs.length), 0, b);
        expect(() => mergeIntervals(withBad)).toThrow(RangeError);
      }),
    );
  });
});
