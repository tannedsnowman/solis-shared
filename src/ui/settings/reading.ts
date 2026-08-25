/**
 * Turning a stored settings reading into the text a row shows.
 *
 * These two functions are the whole of what the PV settings screens took
 * from the extension's `GospelRows.tsx`. They are pure: a store entry and a
 * register record in, a number or a string out. No transport, no store
 * access, no React -- which is why they can sit beside the cards while the
 * 400 lines of `GospelRows` around them cannot.
 *
 * WHY NOT MOVE `GospelRows` ITSELF
 * -------------------------------
 * The rest of that file is welded to one app's back end -- it calls
 * `useRegisterWrite`, and its `rawOf` is bound to the HYBRID key map. Three
 * PV screens had already written their own local `rawOf` precisely because
 * the shared one answers for the wrong device. Moving the pure pair and
 * leaving the rest is confirming what those screens already do, not a new
 * split.
 */
import type { GospelRegister } from '../../gospel/gospel';
import { displayValue } from '../../gospel/decodeGospel';
import { rawToDisplay } from '../../settings/editorFor';
import { decimalsForScale } from '../../decode/primitives';

/**
 * One store entry, as an app's settings store holds it.
 *
 * Deliberately loose about `raw` vs `value`: the legacy store keeps the
 * SCALED reading with the scale beside it, while newer writes record the raw
 * word directly. Both shapes are live, so both are read.
 */
export interface SettingEntry {
  /** The raw register word, when the store recorded it directly. */
  raw?: number;
  /** The scaled reading, which is what the legacy mapper wrote. */
  value?: number | string;
  /** The scale `value` was multiplied by, needed to undo it. */
  scale?: number;
  /**
   * Whether this reading is current.
   *
   * A write marks the entry `fresh: false` rather than deleting it, so the
   * row stops claiming the old word is the new one. Anything not exactly
   * `true` is therefore "not read" -- an entry left over from before a write
   * must not be shown as a reading.
   */
  fresh?: boolean;
}

/** A settings store snapshot, keyed by the owning app's register key. */
export type SettingStore = Record<string, SettingEntry | undefined>;

/**
 * The RAW word an app last read for a key, or undefined when it has none.
 *
 * The store may hold the raw word or the scaled one; the gospel decodes from
 * raw, so a scaled reading is divided back down. `fresh !== true` is
 * undefined rather than a number, because a stale entry is not a reading.
 */
export function rawOf(
  variables: SettingStore | null | undefined,
  key: string,
): number | undefined {
  const v = variables?.[key];
  if (!v || v.fresh !== true) return undefined;
  // The legacy mapper stores the SCALED value; the gospel decodes from raw.
  if (typeof v.raw === 'number') return v.raw;
  if (typeof v.value !== 'number') return undefined;
  const scale = typeof v.scale === 'number' && v.scale ? v.scale : 1;
  return Math.round(v.value / scale);
}

/**
 * Human-readable current reading for a row's middle column.
 *
 * Prefers the register's own `value_map` or bit list via `displayValue`, and
 * falls back to the scaled number with its units. An unread register reads
 * "not read" rather than 0 -- the two mean opposite things to an engineer.
 */
export function currentText(
  reg: GospelRegister | undefined,
  raw: number | undefined,
): string {
  if (raw === undefined) return 'not read';
  if (reg) {
    const text = displayValue(reg, raw);
    if (text !== null) return text;
    const shown = rawToDisplay(raw, reg.scale);
    return `${shown.toFixed(decimalsForScale(reg.scale))}${reg.units ? ` ${reg.units}` : ''}`;
  }
  return String(raw);
}
