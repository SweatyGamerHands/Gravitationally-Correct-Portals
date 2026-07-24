export type SeedInput = string | number;

const UINT32_RANGE = 0x1_0000_0000;

/**
 * Hash a string or number to an unsigned 32-bit value using FNV-1a.
 * Type prefixes deliberately keep the seed `42` distinct from the seed `"42"`.
 */
export const hashSeed = (seed: SeedInput): number => {
  const input = typeof seed === 'number' ? `number:${String(seed)}` : `string:${seed}`;
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
};

export type SeededRandom = {
  /** The normalized seed from which this stream started. */
  readonly seed: number;
  /** Return an unsigned 32-bit integer and advance the stream once. */
  nextUint32: () => number;
  /** Return a floating-point value in the half-open interval [0, 1). */
  next: () => number;
  /** Return a floating-point value in the half-open interval [min, max). */
  range: (min: number, max: number) => number;
  /** Return an integer in the half-open interval [min, maxExclusive). */
  integer: (min: number, maxExclusive: number) => number;
  /** Pick an item, or return undefined when the input is empty. */
  pick: <T>(items: readonly T[]) => T | undefined;
};

/** Create a small, deterministic Mulberry32 random stream. */
export const createSeededRandom = (inputSeed: SeedInput): SeededRandom => {
  const seed = hashSeed(inputSeed);
  let state = seed;

  const nextUint32 = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };

  const next = () => nextUint32() / UINT32_RANGE;

  const range = (min: number, max: number) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      throw new RangeError('range requires finite bounds with max greater than min');
    }
    return min + next() * (max - min);
  };

  const integer = (min: number, maxExclusive: number) => {
    if (!Number.isInteger(min) || !Number.isInteger(maxExclusive) || maxExclusive <= min) {
      throw new RangeError('integer requires integer bounds with maxExclusive greater than min');
    }
    return min + Math.floor(next() * (maxExclusive - min));
  };

  const pick = <T>(items: readonly T[]): T | undefined => (
    items.length === 0 ? undefined : items[integer(0, items.length)]
  );

  return { seed, nextUint32, next, range, integer, pick };
};
