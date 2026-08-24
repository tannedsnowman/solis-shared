/**
 * Composite settings decoders — the registers that are not a flat lookup.
 *
 * Everything that IS a flat lookup (enum, enable/disable pair, bitfield) now
 * lives on the mapper description as `valueMap` / `bitFlags`, where `decode()`
 * finds it. What remains here packs more than one field into a single word, so
 * no value map can express it.
 *
 * Keep this small. A new entry here should be a real composite, not a lookup
 * someone did not want to type into the mapper.
 */

const METER_LOCATIONS: Record<number, string> = {
  0x01: 'Grid',
  0x02: 'Load',
  0x03: 'Grid + PV (Two Meter)',
};

const METER_TYPES: Record<number, string> = {
  0x01: 'General 1Ph',
  0x02: 'Acrel 3Ph',
  0x03: 'General 3Ph',
  0x04: 'Eastron SDM120 (1Ph)',
  0x05: 'Eastron SDM630 (3Ph)',
  0x06: 'No Meter Mode',
};

/**
 * Meter type and location share one register: high byte is the location,
 * low byte the meter type.
 */
export function decodeMeterTypeLocation(value: number): string {
  const location = (value >> 8) & 0xff;
  const type = value & 0xff;
  const hex = (n: number) => `Unknown (0x${n.toString(16).toUpperCase()})`;
  return `${METER_LOCATIONS[location] ?? hex(location)} / ${METER_TYPES[type] ?? hex(type)}`;
}

// EPM-AX packs its meter selection the other way round: low byte is the meter
// type, high byte the location, with its own label sets.
const AX_METER_TYPES: Record<number, string> = {
  0: 'Acrel',
  1: 'Eastron',
  2: 'Rayleigh',
  3: 'Rayleigh F',
  4: 'No Meter',
};

const AX_METER_LOCATIONS: Record<number, string> = {
  0: 'Grid',
  1: 'Load',
  2: 'Other PV',
  3: 'Total PV',
  4: 'Generator',
  5: 'N/A',
};

/**
 * EPM-AX meter select: low byte is the meter type, high byte the location.
 * (Note the byte order is the reverse of {@link decodeMeterTypeLocation}.)
 */
export function decodeAxMeterSelect(value: number): string {
  const type = value & 0xff;
  const location = (value >> 8) & 0xff;
  const hex = (n: number) => `Unknown (0x${n.toString(16).toUpperCase()})`;
  return `${AX_METER_TYPES[type] ?? hex(type)} @ ${AX_METER_LOCATIONS[location] ?? hex(location)}`;
}

/** Registers whose value packs multiple fields into one word. */
const COMPOSITES: Record<string, (value: number) => string> = {
  meter1TypeAndLocation: decodeMeterTypeLocation,
  meterSelect: decodeAxMeterSelect,
  meter2Select: decodeAxMeterSelect,
};

/**
 * Decode a composite settings register, or return undefined when the key is
 * an ordinary one — in which case the caller should use `decode()` with the
 * register's description.
 */
export function decodeSpecial(key: string, rawValue: number): string | undefined {
  return COMPOSITES[key]?.(rawValue);
}
