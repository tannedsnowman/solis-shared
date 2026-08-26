/**
 * Gospel-driven decoding for the Hybrid DATA view.
 *
 * Pure. Raw register value in, presentable text out. It does not know whether
 * the number arrived over the API bridge or from a scraped SolisCloud hex
 * string, which is what keeps both paths working.
 *
 * The rules implemented here are the ones in
 * `docs/superpowers/handoffs/2026-08-20-gospel-map-sync-SHARED.md`:
 *
 *   3. sign      s16 -> Int16, s32 -> Int32
 *   4. sentinel  s32 value -0x80000000 means "no reading" -> "--"
 *   5. enum      value_map hit on the RAW value wins outright
 *   6. bits      bit_flags lists set bits, "Reserve" skipped, none -> "None"
 *   7. scale     value = signed * scale
 *   8. decimals  0.1 -> 1dp, 0.01 -> 2dp, 1 -> 0dp
 *
 * Enum beats bitfield beats numeric. An undocumented enum code falls through
 * to the number — never "Unknown (7)".
 */
import { byAddress, byKey, GospelRegister } from '../../gospel/gospel';
import { displayValue } from '../../gospel/decodeGospel';

/*
 * THE ARITHMETIC LIVES IN `@solis/shared`, NOT HERE.
 *
 * `decimalsForScale`, `toInt16`, `toInt32` and `formatNumber` used to be
 * written out again in this file. There were seven copies of the first one and
 * five of the sign extension across the two apps, and they disagreed at the
 * edges — which is the worst arrangement, because the divergence only shows on
 * the registers nobody tests. They are re-exported rather than deleted so the
 * existing importers of this module keep working.
 *
 * ONE BEHAVIOUR CHANGED. The shared `decimalsForScale` uses `Math.ceil` where
 * this file used `Math.round`. They differ only for a scale that is not a
 * power of ten, and across all four maps exactly ONE register has one:
 * `LGHighVoltageBatteryCommFailureTimeout` (43639, scale 0.5), which now shows
 * 1 decimal place instead of 0. `ceil` wins because `round` discards a digit
 * the device actually reported.
 */
import {
  NO_READING,
  S32_NO_READING,
  formatNumber,
  toInt32,
  applySign as applySignToKind,
  joinWords,
} from '../../decode/index';

export {
  NO_READING,
  S32_NO_READING,
  decimalsForScale,
  formatNumber,
  toInt16,
  toInt32,
} from '../../decode/index';

export interface Decoded {
  /** Raw register word(s) as read, before scale and before sign for u16. */
  raw: number;
  /** Signed and scaled number, or null when the reading is absent. */
  value: number | null;
  /** Ready-to-render text: enum label, bit list, formatted number, or "--". */
  text: string;
  /** Enum label when value_map matched, else null. */
  label: string | null;
  /** Set bit labels when the register is a bitfield, else empty. */
  bits: string[];
  /** Units symbol from the gospel ("V", "A", "W"), never a scale factor. */
  units: string;
  /** The gospel record, or null when the address/key is unknown. */
  reg: GospelRegister | null;
  /** True when the reading is missing or sentinel. */
  missing: boolean;
}

/**
 * Apply the gospel `kind` to a stored word.
 *
 * A thin adapter over the shared `applySign`: that one takes a `kind`, and
 * the callers here hold the whole gospel record.
 *
 * The extension's reader combines 32-bit pairs with `(hi << 16) + lo`, which
 * JavaScript evaluates signed, so an s32 arrives correct and a u32 arrives
 * negative when its top bit is set. Both are normalised by the shared form.
 */
export function applySign(reg: GospelRegister | null, raw: number): number {
  return applySignToKind(reg?.kind ?? null, raw);
}

/**
 * Decode one raw value against a gospel record.
 *
 * `reg` may be null — an address the map does not describe still renders its
 * number, because an undescribed register is real information.
 */
export function decodeRaw(
  reg: GospelRegister | null,
  raw: number | null | undefined,
): Decoded {
  const base: Decoded = {
    raw: 0,
    value: null,
    text: NO_READING,
    label: null,
    bits: [],
    units: reg?.units ?? '',
    reg: reg ?? null,
    missing: true,
  };

  if (raw === null || raw === undefined || !Number.isFinite(raw)) return base;

  // Sentinel first. A 32-bit "no reading" must never be scaled into a number
  // that looks like a real -2.1 GW.
  if (reg?.kind === 's32' && toInt32(raw) === S32_NO_READING) {
    return { ...base, raw };
  }

  /*
  THE SMART-PORT TOTALS ARE SIGNED, AND THAT IS NOW SETTLED IN THE MAP.

  There used to be a second gate here, listing 34492 (generator), 34494 (smart
  load) and 34496 (AC couple) by address so their 0x80000000 "not connected"
  word would suppress like an s32 sentinel. Those three were typed u32 by the
  extension with no document behind them (`present_in: []`), while their
  documented siblings 34617/34619 are s32 — so `applySign` took its u32 branch
  and the sentinel scaled to +2 147 483 648 instead of reading "--".

  All three are s32 in the gospel as of 2026-08-23, corrected in overrides.json
  on a field capture where an empty Smart port returned 0xFFFF89A8 on 34496
  and the diagram rendered "4294937.00 kW". The s32 gate above now covers them,
  and it covers every ordinary negative reading too, which the address list
  never did.
  */

  const signed = applySign(reg, raw);

  // Enum, then bitfield. Both look at the RAW value, before scale.
  if (reg) {
    const table = displayValue(reg, raw);
    if (table !== null) {
      const label = reg.value_map?.[String(raw)] ?? null;
      return {
        ...base,
        raw,
        value: signed,
        text: table,
        label,
        bits: label === null && reg.bit_flags ? splitBits(table) : [],
        missing: false,
      };
    }
  }

  const scale = reg?.scale ?? 1;
  const value = signed * scale;
  return {
    ...base,
    raw,
    value,
    text: formatNumber(value, scale),
    missing: false,
  };
}

/** "None" is a reading, not a list. Anything else splits on the joiner. */
function splitBits(text: string): string[] {
  return text === 'None' ? [] : text.split(', ');
}

/** Decode by absolute printed address, e.g. 33546. Never add a 33000 base. */
export function decodeAddress(
  address: number,
  raw: number | null | undefined,
): Decoded {
  return decodeRaw(byAddress.get(address) ?? null, raw);
}

/**
 * Readings whose 32-bit value is split across NON-ADJACENT registers, as
 * `low -> high`.
 *
 * DERIVED FROM THE MAP, not written here. Each low word carries a
 * `high_word_address` in the gospel, so adding a pair is a map edit and every
 * consumer of the gospel — this app, the Tauri app, a RAG query — learns the
 * same fact. This constant is only the lookup shape.
 *
 * Every other wide value occupies a contiguous pair, which the reader already
 * assembles. These do not: the halves sit in blocks added by different
 * document revisions, up to 1 196 registers apart, and for the BMS voltage
 * pair the high word sits BELOW the low word.
 *
 * Without joining them the reading silently WRAPS: at 65 535 W for the two
 * power pairs, at 655.35 V for the BMS voltage — a 744.8 V pack reports
 * 89.44 V. On a commercial unit that is a plausible-looking WRONG number
 * rather than an obviously missing one, which is worse than showing nothing.
 */
export const SPLIT_WORD_PAIRS: Record<number, number> = Object.fromEntries(
  Array.from(byAddress.values())
    .filter((r) => typeof r.high_word_address === "number")
    .map((r) => [r.address_start, r.high_word_address as number]),
);

/**
 * Decode a value whose high word lives at a distant address.
 *
 * Both words must be present. If the high word was never fetched we cannot
 * tell "high is genuinely 0" from "high was not read", and guessing zero is
 * how you get a 700 kW load reported as 4 464 W. So a missing high word
 * yields "--" and the caller is expected to surface the address, letting the
 * range-button hint show which extra block to fetch.
 */
export function decodeSplitWord(
  lowAddress: number,
  low: number | null | undefined,
  high: number | null | undefined,
): Decoded {
  const reg = byAddress.get(lowAddress) ?? null;
  if (
    low === null || low === undefined || !Number.isFinite(low) ||
    high === null || high === undefined || !Number.isFinite(high)
  ) {
    return decodeRaw(reg, null);
  }

  // The high word carries the sign for a signed pair (backup load power is
  // s16/s16), so combine before reinterpreting rather than after.
  const combined = joinWords(high, low, 'be');
  const signed = reg?.kind === 's16' || reg?.kind === 's32'
    ? toInt32(combined)
    : combined >>> 0;

  const scale = reg?.scale ?? 1;
  const value = signed * scale;
  return {
    raw: combined,
    value,
    text: formatNumber(value, scale),
    label: null,
    bits: [],
    units: reg?.units ?? '',
    reg,
    missing: false,
  };
}

/** Decode by the gospel's camelCase key, e.g. "batteryPower". */
export function decodeKey(
  key: string,
  raw: number | null | undefined,
): Decoded {
  return decodeRaw(byKey.get(key) ?? null, raw);
}

/** Text plus its units, for a single-line render. "--" stays bare. */
export function withUnits(d: Decoded): string {
  if (d.missing || !d.units || d.label !== null || d.bits.length) return d.text;
  return `${d.text} ${d.units}`;
}

/** Hex form of a flag word, the way a fault register is normally quoted. */
export function toHexWord(raw: number): string {
  return `0x${(raw & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}
