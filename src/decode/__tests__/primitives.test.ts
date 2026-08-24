import { describe, expect, it } from 'vitest';
import {
  applySign,
  decimalsForScale,
  joinWords,
  splitInt32,
  toInt16,
  toInt32,
  toUint32,
  wordsForKind,
} from '../primitives';

describe('sign extension', () => {
  it('reads a negative s16', () => {
    // -5 degC, the reading that used to show as 65531.
    expect(toInt16(0xfffb)).toBe(-5);
  });

  it('leaves a positive s16 alone', () => {
    expect(toInt16(0x0032)).toBe(50);
  });

  it('handles both s16 extremes', () => {
    expect(toInt16(0x8000)).toBe(-32768);
    expect(toInt16(0x7fff)).toBe(32767);
  });

  it('reads a negative s32', () => {
    expect(toInt32(0xfffff448 | 0)).toBe(-3000);
  });

  it('normalises a u32 that arrived negative', () => {
    // `(hi << 16) + lo` yields a signed Int32, so a u32 above 2^31 arrives
    // negative. This is the battery-power bug in one line.
    expect(applySign('u32', -1)).toBe(4294967295);
    expect(toUint32(-1)).toBe(4294967295);
  });

  it('leaves an undescribed register unsigned', () => {
    expect(applySign(null, 0xfffb)).toBe(0xfffb);
    expect(applySign('u16', 0xfffb)).toBe(0xfffb);
  });
});

describe('decimalsForScale', () => {
  it('gives the resolution the device reports', () => {
    expect(decimalsForScale(1)).toBe(0);
    expect(decimalsForScale(10)).toBe(0);
    expect(decimalsForScale(0.1)).toBe(1);
    expect(decimalsForScale(0.01)).toBe(2);
    expect(decimalsForScale(0.001)).toBe(3);
  });

  /*
   * THE DIVERGENCE THIS PACKAGE SETTLES.
   *
   * SolisConnect used `Math.ceil`, the extension used `Math.round`. They agree
   * on every power of ten and disagree everywhere else. `ceil` wins: `round`
   * discards a digit the device actually reported.
   */
  it('keeps the digit on a non-power-of-ten scale', () => {
    expect(decimalsForScale(0.5)).toBe(1); // round would say 0
    expect(decimalsForScale(0.05)).toBe(2); // round would say 1
    expect(decimalsForScale(0.005)).toBe(3); // round would say 2
  });

  it('treats a zero or broken scale as no decimals rather than throwing', () => {
    expect(decimalsForScale(0)).toBe(0);
    expect(decimalsForScale(-1)).toBe(0);
    expect(decimalsForScale(Number.NaN)).toBe(0);
  });
});

describe('word order', () => {
  it('joins big-endian, high word first in address order', () => {
    expect(joinWords(0x0001, 0x86a0, 'be')).toBe(100000);
  });

  it('joins little-endian, low word first in address order', () => {
    // The same pair on an EPM, which is little-endian. Getting this wrong is
    // the "wrong by a factor of 65536" bug.
    expect(joinWords(0x86a0, 0x0001, 'le')).toBe(100000);
  });

  it('does not sign the join — that is applySign\'s job', () => {
    expect(joinWords(0xffff, 0xffff, 'be')).toBe(4294967295);
  });
});

describe('splitInt32 for FC16 writes', () => {
  it('round-trips through joinWords', () => {
    const [hi, lo] = splitInt32(100000);
    expect(joinWords(hi, lo, 'be')).toBe(100000);
  });

  it('clamps rather than wrapping', () => {
    // 3 000 000 000 W must not go out as a negative power.
    const [hi, lo] = splitInt32(3_000_000_000);
    expect(toInt32(joinWords(hi, lo, 'be'))).toBe(0x7fffffff);
  });

  it('encodes a negative value two\'s complement', () => {
    const [hi, lo] = splitInt32(-3000);
    expect(toInt32(joinWords(hi, lo, 'be'))).toBe(-3000);
  });

  it('honours little-endian word order', () => {
    const [first, second] = splitInt32(100000, 'le');
    expect(joinWords(first, second, 'le')).toBe(100000);
  });
});

describe('wordsForKind', () => {
  it('says 2 for the wide kinds and 1 for everything else', () => {
    expect(wordsForKind('u32')).toBe(2);
    expect(wordsForKind('s32')).toBe(2);
    expect(wordsForKind('u16')).toBe(1);
    expect(wordsForKind('s16')).toBe(1);
    expect(wordsForKind(null)).toBe(1);
  });
});
