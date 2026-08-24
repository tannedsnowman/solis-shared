/**
 * Render a raw register value using the gospel map's enum and bitfield tables.
 *
 * Pure: value in, text out. It does not know whether the value came from a
 * serial read or a scraped SolisCloud hex string — which is what keeps the
 * web-scrape path working when the full decoder is ported from Tauri.
 *
 * `value_map` is `null` on every record today; a separate task is populating
 * it. Both paths fall through to `null` until then, so callers can use this
 * now and labels appear the moment the data lands.
 */
export interface GospelRegister {
  value_map: Record<string, string> | null;
  bit_flags: string[] | null;
}

/** Enum label for a raw value, or null when the map has no entry. */
export function enumLabel(reg: GospelRegister, raw: number): string | null {
  // JSON has no integer keys, so value_map keys are decimal strings.
  return reg.value_map?.[String(raw)] ?? null;
}

/** Labels of the set bits. "Reserve" entries are skipped. */
export function activeBits(reg: GospelRegister, raw: number): string[] {
  if (!reg.bit_flags) return [];
  return reg.bit_flags.filter(
    (label, bit) => label !== 'Reserve' && ((raw >> bit) & 1) === 1,
  );
}

/**
 * Display text for a raw value, or null when the register carries no table.
 * A null return means "format this as a number" — the caller decides how.
 */
export function displayValue(reg: GospelRegister, raw: number): string | null {
  const label = enumLabel(reg, raw);
  if (label !== null) return label;          // an enum code IS the meaning
  if (reg.bit_flags) {
    const on = activeBits(reg, raw);
    // "None" is a real reading — a fault word with nothing set must look
    // different from a register that was never read.
    return on.length ? on.join(', ') : 'None';
  }
  return null;
}
