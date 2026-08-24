/**
 * The arithmetic every Solis decoder needs, and the only place it is written.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before this package there were SEVEN implementations of `decimalsForScale`
 * and FIVE of sign extension across the two apps. They agreed on the common
 * cases and disagreed at the edges, which is the worst possible arrangement:
 * the divergence only shows up on the registers nobody tests.
 *
 * Two known divergences are settled here:
 *
 *   1. `decimalsForScale` used `Math.ceil` in SolisConnect and `Math.round`
 *      in the extension. They differ at scale 0.5, 0.05 and 0.005. `ceil`
 *      wins — see the note on that function.
 *
 *   2. Sign extension used `Int16Array`/`Int32Array` in SolisConnect and
 *      arithmetic (`- 0x10000`, `| 0`) in the extension. They agree on every
 *      input, so the arithmetic form wins on the grounds that it allocates
 *      nothing and reads as what it is.
 *
 * Nothing here may import from a platform. No `chrome.*`, no `@tauri-apps`,
 * no `window`, no `fs`. This file is pure arithmetic and must stay that way.
 */

/** Reinterpret a 16-bit word as signed. */
export function toInt16(raw: number): number {
  const w = raw & 0xffff;
  return w > 0x7fff ? w - 0x10000 : w;
}

/**
 * Reinterpret a 32-bit value as signed.
 *
 * `| 0` IS exactly a signed 32-bit reinterpretation in JavaScript — the
 * bitwise operators coerce to Int32 by definition. This is not a truncation
 * trick, it is the spec.
 */
export function toInt32(raw: number): number {
  return raw | 0;
}

/** Reinterpret a 32-bit value as unsigned. */
export function toUint32(raw: number): number {
  return raw >>> 0;
}

/** The widest values an s32 register can carry. */
export const S32_MIN = -0x80000000;
export const S32_MAX = 0x7fffffff;

/**
 * The word Solis publishes on an s32 reading that has no value.
 *
 * A generator port with no generator fitted reports 0x80000000. Decoded as a
 * plain number that is -2 147 483 648, which scaled becomes a plausible-looking
 * -2.1 GW. Every decode path must gate on this BEFORE scaling.
 */
export const S32_NO_READING = -0x80000000;

/** What a cell shows when there is nothing to show. */
export const NO_READING = '--';

/**
 * Decimal places implied by a scale: exactly the resolution the device reports.
 *
 *   1 -> 0dp,  10 -> 0dp,  0.1 -> 1dp,  0.01 -> 2dp,  0.001 -> 3dp
 *
 * CEIL, NOT ROUND. The two apps disagreed here and it matters for any scale
 * that is not a power of ten:
 *
 *   scale 0.5    ceil -> 1dp   round -> 0dp
 *   scale 0.05   ceil -> 2dp   round -> 1dp
 *   scale 0.005  ceil -> 3dp   round -> 2dp
 *
 * `round` discards a digit the device actually reported, which is the same
 * class of bug as the old `scale < 0.01 ? n : ...` bucket rules this replaced.
 * Showing one digit too many is harmless; showing one too few is data loss.
 *
 * Only one register in the current maps is affected
 * (`LGHighVoltageBatteryCommFailureTimeout`, scale 0.5), so this is a latent
 * trap rather than a live bug — but it is settled now rather than later.
 *
 * The `<= 0` and non-finite guard is not defensive noise: a scale of 0 in a
 * map would silently zero every reading through it.
 */
export function decimalsForScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  return Math.max(0, Math.ceil(-Math.log10(scale)));
}

/** Format a scaled number with the decimals its scale implies. */
export function formatNumber(value: number, scale: number): string {
  if (!Number.isFinite(value)) return NO_READING;
  return value.toFixed(decimalsForScale(scale));
}

/**
 * Join a register pair into one 32-bit value.
 *
 * `words` are in ADDRESS order. Which half is the high word is a property of
 * the DEVICE, not of this function — EPM and EPM-AX are little-endian and the
 * hybrid is big-endian, both live-verified. Passing the wrong order yields a
 * number wrong by a factor of 65 536 that still looks like a number, so the
 * caller must always state it.
 */
export function joinWords(
  first: number,
  second: number,
  wordOrder: WordOrder,
): number {
  const [high, low] = wordOrder === 'le' ? [second, first] : [first, second];
  return (((high & 0xffff) << 16) >>> 0) + (low & 0xffff);
}

/**
 * Split a signed 32-bit value into `[highWord, lowWord]` for an FC16 write.
 *
 * Out-of-range input is CLAMPED, not wrapped. Silently sending 3 000 000 000 W
 * as a negative power is the failure this exists to stop.
 */
export function splitInt32(
  value: number,
  wordOrder: WordOrder = 'be',
): [number, number] {
  const v = Math.min(S32_MAX, Math.max(S32_MIN, Math.round(value)));
  const u32 = toUint32(v < 0 ? v + 0x100000000 : v);
  const high = (u32 >>> 16) & 0xffff;
  const low = u32 & 0xffff;
  return wordOrder === 'le' ? [low, high] : [high, low];
}

/** Which half of a 32-bit register comes first in ADDRESS order. */
export type WordOrder = 'be' | 'le';

/** How a register's bits are to be read. `null` means "undescribed". */
export type RegisterKind =
  | 'u16'
  | 's16'
  | 'u32'
  | 's32'
  | 'ascii'
  | 'bit'
  | null;

/** How many 16-bit words a register of this kind occupies on the wire. */
export function wordsForKind(kind: RegisterKind): number {
  return kind === 'u32' || kind === 's32' ? 2 : 1;
}

/**
 * Apply a register's `kind` to a value that is already joined.
 *
 * The 32-bit branches exist because a joined pair can arrive either signed or
 * unsigned depending on how the caller combined it: `(hi << 16) + lo` yields a
 * signed Int32, so a u32 above 2^31 arrives negative. Both directions are
 * normalised here so callers do not have to know which they had.
 */
export function applySign(kind: RegisterKind, raw: number): number {
  switch (kind) {
    case 's16':
      return toInt16(raw);
    case 's32':
      return toInt32(raw);
    case 'u32':
      return raw < 0 ? raw + 0x100000000 : raw;
    default:
      return raw;
  }
}
