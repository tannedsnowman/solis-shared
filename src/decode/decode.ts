/**
 * The one decoder. Raw words in, presentable value out.
 *
 * Pure. It does not know whether the words arrived over a serial port, the
 * signed cloud API, or a scraped SolisCloud hex string — which is exactly what
 * lets all three paths share it.
 *
 * THE RULE ORDER, AND WHY IT IS THIS ORDER
 * ----------------------------------------
 *   1. join      two words become one value, using the register's word order
 *   2. sentinel  a "no reading" word suppresses BEFORE scale can make it look
 *                like a real measurement
 *   3. sign      s16 -> Int16, s32 -> Int32, u32 normalised back up
 *   4. enum      a `valueMap` hit on the RAW value wins outright
 *   5. bits      `bitFlags` lists set bits; none -> "None"
 *   6. scale     value = signed * scale
 *   7. decimals  0.1 -> 1dp, 0.01 -> 2dp, 1 -> 0dp
 *
 * Enum beats bitfield beats numeric. An UNDOCUMENTED enum code falls through
 * to the number rather than rendering "Unknown (7)" — a code the map has not
 * caught up with is still real information, and a field engineer can look it
 * up. Hiding it behind a placeholder cannot be undone by the reader.
 *
 * Sentinel must precede scale. A generator port with no generator reports
 * 0x80000000; scaled, that is a plausible-looking -2.1 GW, and this codebase
 * has shipped that bug twice (once as "4294937 kW" on an empty Smart port).
 *
 * Enum and bits look at the RAW value, before scale. A status word of 3 means
 * state 3, not state 0.3.
 */
import {
  NO_READING,
  S32_NO_READING,
  applySign,
  formatNumber,
  joinWords,
  wordsForKind,
} from './primitives';
import type { Decoded, RegisterSpec } from './types';

/** A word that was never read. */
type Word = number | null | undefined;

const absent = (spec: RegisterSpec): Decoded => ({
  raw: 0,
  value: null,
  text: NO_READING,
  label: null,
  bits: [],
  units: spec.units ?? '',
  missing: true,
});

/**
 * List the labels of the set bits in a raw value.
 *
 * "Reserve"/"Reserved" entries are skipped: they are padding in the document,
 * not a condition, and listing them buries the real flags.
 */
export function activeBits(raw: number, bitFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < bitFlags.length; i += 1) {
    if ((raw & (1 << i)) === 0) continue;
    const label = bitFlags[i];
    if (label === undefined || label === '') continue;
    if (/^reserved?$/i.test(label)) continue;
    out.push(label);
  }
  return out;
}

/**
 * Decode a register from its raw words.
 *
 * `words` are in ADDRESS order and may be shorter than the register needs —
 * that is how "not read yet" is expressed, and it returns `missing` rather
 * than guessing at zero. A wide register with only its low word available is
 * missing, not half-known: reporting the low word alone is how a value ends up
 * wrong by a factor of 65 536.
 */
export function decodeWords(spec: RegisterSpec, words: Word[]): Decoded {
  const need = wordsForKind(spec.kind);
  const got = words.slice(0, need);

  if (got.length < need) return absent(spec);
  for (const w of got) {
    if (w === null || w === undefined || !Number.isFinite(w)) {
      return absent(spec);
    }
  }
  const w = got as number[];

  const raw =
    need === 1
      ? (w[0] as number) & 0xffff
      : joinWords(w[0] as number, w[1] as number, spec.wordOrder ?? 'be');

  return decodeRaw(spec, raw);
}

/**
 * Decode a register from an already-joined raw value.
 *
 * Use this when the store hands back a combined number rather than the words
 * — the extension's raw store does exactly that. Prefer `decodeWords` when the
 * words are available, because only that form can apply word order; a value
 * joined by the caller has already committed to an endianness, right or wrong.
 */
export function decodeRaw(spec: RegisterSpec, raw: number): Decoded {
  const base = absent(spec);
  if (!Number.isFinite(raw)) return base;

  const signed = applySign(spec.kind, raw);

  // Sentinel BEFORE scale. See the file header.
  const sentinel =
    spec.noReading !== undefined && spec.noReading !== null
      ? spec.noReading
      : spec.kind === 's32'
        ? S32_NO_READING
        : null;
  if (sentinel !== null && signed === sentinel) {
    return { ...base, raw };
  }

  // Enum wins outright, on the RAW value.
  const hit = spec.valueMap ? spec.valueMap[String(raw)] : undefined;
  if (hit !== undefined) {
    return {
      ...base,
      raw,
      value: signed,
      text: hit,
      label: hit,
      missing: false,
    };
  }

  // Then bitfield, also on the RAW value.
  if (spec.bitFlags && spec.bitFlags.length > 0) {
    const bits = activeBits(raw, spec.bitFlags);
    return {
      ...base,
      raw,
      value: signed,
      text: bits.length === 0 ? 'None' : bits.join(', '),
      bits,
      missing: false,
    };
  }

  // A scale of 0 would silently zero every reading, so it is treated as absent.
  const scale = spec.scale && spec.scale !== 0 ? spec.scale : 1;
  const value = signed * scale;
  return {
    ...base,
    raw,
    value,
    text: formatNumber(value, scale),
    missing: false,
  };
}
