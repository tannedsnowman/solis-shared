/**
 * The one place the EPM and EPM-AX gospel maps are loaded.
 *
 * Mirrors `gospel.ts` (hybrid) and `pvGospel.ts` deliberately: same record
 * shape, same lookup names, same "address is the primary identity" rule. A
 * reader who knows one knows the others.
 *
 * TWO DEVICES, TWO FILES, ONE MODULE
 * ----------------------------------
 * EPM and EPM-AX share both base addresses (data 36000, settings 36500) but
 * NOT their meanings. Four settings offsets name different things on each:
 *
 *   offset  EPM                          EPM-AX
 *   9       inverterNumber               inverterQty (two byte counts)
 *   10      epmMode                      perPhaseLimiting
 *   11      failSafeOnOff (0/1)          failSafe (5 modes)
 *   13      epmDataTransmissionSwitch    transmitOnOff
 *
 * So a register's identity here is (DEVICE, SCOPE, ADDRESS). One flat map
 * would let an EPM label render over an AX register. Every lookup in this
 * module therefore takes the device first, and there is no all-devices index
 * to reach for by mistake.
 *
 * THREE THINGS THAT ARE NOT LIKE PV — copying PV's answers breaks all three
 * ------------------------------------------------------------------------
 * 1. `wire_offset` IS 0, not −1. PV prints an address and subtracts 1 for the
 *    frame. EPM does not: `address = base_address + offset`, and the number
 *    printed is the number that goes on the wire. `epmPowerA` is offset 6,
 *    the document prints 36006, and a live capture read 36006.
 *
 * 2. 32-bit registers are LITTLE-endian — LOW WORD FIRST. PV is big-endian
 *    throughout. Decoding an EPM wide register big-endian does not fail
 *    loudly: it returns site totals in the hundreds of thousands of kW. That
 *    happened on a real site (confirmed 2026-08-07). Each register carries
 *    its own `word_order`; `decodeWords` below reads it rather than assuming.
 *
 * 3. Addresses are unique within a device. Unlike PV — where 260 addresses
 *    name a different register in each space — EPM data lives at 36000+ and
 *    settings at 36500+, so they cannot collide. `byAddress` is safe here in
 *    a way it is not on PV. The scope is still recorded, because the FUNCTION
 *    CODE differs (0x04 vs 0x03/0x06/0x10) and a read has to pick one.
 *
 * epm.json and ax.json are small next to hybrid (79 KB and 96 KB), but they
 * are imported HERE ONLY all the same, so webpack bundles each payload once.
 */
import epmJson from './generated/epm.json';
import axJson from './generated/ax.json';
import type { GospelRegister as GospelLabels } from './gospel';

/** Which device a map describes. EPM and EPM-AX are never interchangeable. */
export type EpmDevice = 'epm' | 'ax';

/** The space a register is read from. Picks the Modbus function code. */
export type EpmScope = 'data' | 'settings';

/**
 * One EPM/AX register, exactly as the gospel map states it.
 *
 * Note `address` / `address_end`, NOT PV's `address_start`. The two maps were
 * built by the same generator but name this field differently, and quietly
 * accepting either is how a lookup returns `undefined` for every register.
 *
 * WHY IT PICKS TWO FIELDS OUT OF `GospelRegister` RATHER THAN EXTENDING IT
 * -----------------------------------------------------------------------
 * The only thing EPM shares with the hybrid record is the LABEL TABLES —
 * `value_map` and `bit_flags` — which is exactly what `decodeGospel.ts`
 * consumes, so picking them keeps `displayValue()` usable on an EPM record.
 *
 * Extending the whole interface looked tidier and was wrong. It would import
 * `address_start`, `kind`, `category` and `unverified`, none of which an EPM
 * record carries, and it would force `key` to be required — which it is not:
 * 13 `document_only` rows per device have no key at all. Picking states the
 * real overlap instead of asserting one that does not exist.
 */
export interface EpmRegister extends Pick<GospelLabels, 'value_map' | 'bit_flags'> {
  /** Absolute address. This IS the wire address — no offset correction. */
  address: number;
  /** Last address the register owns. Differs from `address` when 32-bit. */
  address_end: number;
  space: EpmScope;
  /** Human name from the document, e.g. "EPM_Power A". */
  name: string;
  /**
   * camelCase key the apps store it under, e.g. "epmPowerA".
   *
   * ABSENT on a `document_only` register — one printed in a document that
   * NEITHER app maps. There are 13 on each device (a firmware-version word
   * and a run of Reserved padding). They have no key because no store ever
   * filed them under one, and no `offset` because offset is the apps' way of
   * addressing, not the document's. That is honest rather than missing work:
   * inventing a key would produce a lookup that can only ever miss.
   */
  key?: string;
  /**
   * Offset from the space's `base_address`. address = base + offset.
   *
   * Absent exactly when `key` is — see above. Use `offsetForAddress()` if you
   * need the number for a register that does not carry one.
   */
  offset?: number;
  /** Declared type, e.g. "U16", "S32". */
  data_type: string;
  /** 16 or 32. A 32-bit register owns two consecutive addresses. */
  width: number;
  /** "le" or "be". EVERY 32-bit EPM register is "le". Read it, don't assume. */
  word_order: 'le' | 'be';
  /** Multiplier applied to the raw value. Never 0 — the build rejects that. */
  scale: number;
  /** Display unit, e.g. "W", "kWh". */
  units: string;
  description: string;
  /** confirmed | app_only | document_only | disputed */
  confidence: string;
  /** Which apps map this register. */
  app_sources?: string[];

  /* ---- Flags the UI must honour. All optional; absent means "no". ---- */

  /** Writing this register is unsafe until a rule says otherwise. */
  do_not_write?: boolean;
  /** Why `do_not_write` was cleared. Travels with the data, by design. */
  do_not_write_cleared_because?: string;
  /** The two apps label this enum differently. Show the disagreement. */
  value_map_disputed?: boolean;
  /** The documents split U16 vs S16 here. 0xFFE2 is −30 or 65506. */
  signedness_disputed?: boolean;
  /** The apps disagree how many registers this spans. */
  span_disputed?: boolean;
  /** The document at this address describes the OTHER device. Never quote it. */
  document_is_other_device?: boolean;
  /** What the other device's document calls this address. */
  document_describes?: string;
  /** Low/high byte sub-fields. Writing a bare number clears the other half. */
  byte_fields?: {
    low?: { key: string; label: string; sources?: string[] };
    high?: { key: string; label: string; sources?: string[] };
  };
  /** Inclusive bounds for an editor, when the map states them. */
  valid_range?: { min: number; max: number };
  /** Note carried from the app config layer. */
  note?: string;
  app_description?: string;
}

/** How a whole space is read: the base, the function code, the offset. */
interface RawSpace {
  space: string;
  function_code: string;
  reg_type: string;
  /** 36000 for data, 36500 for settings. */
  base_address: number;
  /** 0 on EPM and AX. Present so nothing has to remember that. */
  wire_offset: number;
  registers: EpmRegister[];
}

/** The `app_profile` block: the UI model, captured as data. */
export interface EpmAppProfile {
  data_base: number;
  settings_base: number;
  display_name: string;
  views: string[];
  /**
   * How to fetch every setting in one pass.
   *
   * `computed` lets the app derive batches from `max_gap` / `max_count`.
   * `literal` means the ranges are DELIBERATE and must not be recomputed —
   * AX settings span 0–52 with a 21-register hole, and one read of 53 beats
   * two round-trips over the metered cloud proxy.
   */
  fetch_all:
    | { kind: 'computed'; max_gap: number; max_count: number }
    | { kind: 'literal'; ranges: { start: number; count: number }[] };
  groups: EpmGroup[];
}

/** One settings group as the map describes it — a widget's worth of rows. */
export interface EpmGroup {
  title: string;
  /** Offsets to read for this group. Null when the group is not a batch. */
  batch_start: number | null;
  batch_end: number | null;
  settings: { key: string; label: string }[];
}

interface RawMap {
  family: string;
  device: string;
  app_profile: EpmAppProfile;
  register_spaces: RawSpace[];
  conflicts: unknown[];
  app_map_gaps: unknown[];
}

const maps: Record<EpmDevice, RawMap> = {
  epm: epmJson as unknown as RawMap,
  ax: axJson as unknown as RawMap,
};

/* ------------------------------------------------------------------ *
 * Per-device indexes, built once at module load.
 * ------------------------------------------------------------------ */

interface DeviceIndex {
  all: EpmRegister[];
  byAddress: Map<number, EpmRegister>;
  settingsByAddress: Map<number, EpmRegister>;
  byKey: Map<string, EpmRegister>;
  allByKey: Map<string, EpmRegister[]>;
  byQualifiedKey: Map<string, EpmRegister>;
  baseOf: Map<EpmScope, number>;
  wireOffsetOf: Map<EpmScope, number>;
  scopeOfRecord: Map<EpmRegister, EpmScope>;
}

/** A space's scope, from its `reg_type`. Only two spaces exist per device. */
function scopeOfSpace(s: RawSpace): EpmScope {
  return s.reg_type === 'settings' ? 'settings' : 'data';
}

function buildIndex(map: RawMap): DeviceIndex {
  const spaces = map.register_spaces;
  const all = spaces.flatMap((s) => s.registers);

  const baseOf = new Map<EpmScope, number>();
  const wireOffsetOf = new Map<EpmScope, number>();
  const scopeOfRecord = new Map<EpmRegister, EpmScope>();
  for (const s of spaces) {
    const scope = scopeOfSpace(s);
    baseOf.set(scope, s.base_address);
    wireOffsetOf.set(scope, s.wire_offset ?? 0);
    for (const r of s.registers) scopeOfRecord.set(r, scope);
  }

  const inScope = (scope: EpmScope) =>
    new Map(
      all
        .filter((r) => scopeOfRecord.get(r) === scope)
        .map((r) => [r.address, r] as const),
    );

  /* key -> every register carrying it, ascending by address. Keys collide
     across spaces the same way PV's do — `year` exists in both — so the
     qualified index below is what makes every record reachable.

     KEYLESS registers are skipped. The 13 `document_only` rows per device
     have no key at all; bucketing them would file every one under the same
     `undefined` and hand back a Reserved word for any missed lookup. They
     stay reachable by ADDRESS, which is the only name they actually have. */
  const allByKey = new Map<string, EpmRegister[]>();
  for (const r of all) {
    if (!r.key) continue;
    const list = allByKey.get(r.key);
    if (list) list.push(r);
    else allByKey.set(r.key, [r]);
  }
  for (const list of allByKey.values()) list.sort((a, b) => a.address - b.address);

  /* DOCUMENTED RESOLUTION: lowest DATA address wins; if the key exists only
     in settings, the lowest settings address wins. Stable in address order,
     never dependent on which record the generator emitted last. */
  const byKey = new Map<string, EpmRegister>();
  for (const [key, list] of allByKey) {
    const dataFirst = list.filter((r) => scopeOfRecord.get(r) === 'data');
    // `!`: allByKey is built by pushing, so no list is ever empty.
    byKey.set(key, (dataFirst.length ? dataFirst : list)[0]!);
  }

  /* One entry per register, so `byQualifiedKey.size === all.length`.
     Unambiguous keys stay bare; ambiguous ones take a `<scope>.` prefix. */
  const byQualifiedKey = new Map<string, EpmRegister>();
  for (const [key, list] of allByKey) {
    if (list.length === 1) {
      byQualifiedKey.set(key, list[0]!);
      continue;
    }
    for (const r of list) {
      const scope = scopeOfRecord.get(r) ?? 'data';
      // Positional suffix only if a scope somehow holds two of the same key.
      const sameScope = list.filter((x) => scopeOfRecord.get(x) === scope);
      const suffix =
        sameScope.length > 1 ? `#${sameScope.indexOf(r) + 1}` : '';
      byQualifiedKey.set(`${scope}.${key}${suffix}`, r);
    }
  }

  return {
    all,
    byAddress: inScope('data'),
    settingsByAddress: inScope('settings'),
    byKey,
    allByKey,
    byQualifiedKey,
    baseOf,
    wireOffsetOf,
    scopeOfRecord,
  };
}

const indexes: Record<EpmDevice, DeviceIndex> = {
  epm: buildIndex(maps.epm),
  ax: buildIndex(maps.ax),
};

/* ------------------------------------------------------------------ *
 * Lookups. Device first, always — see the header.
 * ------------------------------------------------------------------ */

/** Every register on a device, ascending by address within each scope. */
export function registers(device: EpmDevice): EpmRegister[] {
  return indexes[device].all;
}

/** Every register on a device in one scope, ascending by address. */
export function registersInScope(
  device: EpmDevice,
  scope: EpmScope,
): EpmRegister[] {
  const ix = indexes[device];
  return ix.all
    .filter((r) => ix.scopeOfRecord.get(r) === scope)
    .sort((a, b) => a.address - b.address);
}

/**
 * Look up by the pair that identifies a register within a device.
 *
 * Addresses do not collide across EPM spaces, but naming the scope still
 * matters: it is what decides the function code the read must use.
 */
export function byScopedAddress(
  device: EpmDevice,
  scope: EpmScope,
  address: number,
): EpmRegister | null {
  const ix = indexes[device];
  const map = scope === 'settings' ? ix.settingsByAddress : ix.byAddress;
  return map.get(address) ?? null;
}

/** DATA registers by absolute address, e.g. 36006 -> epmPowerA. */
export function dataByAddress(device: EpmDevice): Map<number, EpmRegister> {
  return indexes[device].byAddress;
}

/** SETTINGS registers by absolute address, e.g. 36508 -> backflowPower. */
export function settingsByAddress(device: EpmDevice): Map<number, EpmRegister> {
  return indexes[device].settingsByAddress;
}

/**
 * Look up by camelCase key, e.g. "epmPowerA".
 *
 * DO NOT USE THIS TO BUILD A SETTINGS ROW. Ambiguous keys resolve to the
 * lowest DATA address — see `buildIndex` — and `year`, `month`, `day`,
 * `hours`, `mins`, `seconds` and `ctRatio` all exist in BOTH spaces. Asking
 * for `year` while building a settings widget returns the DATA clock at
 * 36019, so the row renders against a read-only register and a write lands
 * at the wrong address. Nothing reports it; the number even looks plausible,
 * because both registers really do hold a year.
 *
 * Use `settingByKey` / `dataByKey` when the scope is known, which for a
 * widget it always is.
 */
export function byKey(device: EpmDevice, key: string): EpmRegister | null {
  return indexes[device].byKey.get(key) ?? null;
}

/** Look up a key within ONE scope. The safe form — see `byKey`. */
export function byScopedKey(
  device: EpmDevice,
  scope: EpmScope,
  key: string,
): EpmRegister | null {
  const ix = indexes[device];
  const list = ix.allByKey.get(key) ?? [];
  // Lowest address within the scope, so the answer is stable across rebuilds.
  const inScope = list
    .filter((r) => ix.scopeOfRecord.get(r) === scope)
    .sort((a, b) => a.address - b.address);
  return inScope[0] ?? null;
}

/** A SETTINGS register by key. Use this when building a settings widget. */
export function settingByKey(device: EpmDevice, key: string): EpmRegister | null {
  return byScopedKey(device, 'settings', key);
}

/** A DATA register by key. Use this when building a data panel. */
export function dataByKey(device: EpmDevice, key: string): EpmRegister | null {
  return byScopedKey(device, 'data', key);
}

/** key -> register, with EVERY register reachable. `settings.year` etc. */
export function byQualifiedKey(
  device: EpmDevice,
  qualified: string,
): EpmRegister | null {
  return indexes[device].byQualifiedKey.get(qualified) ?? null;
}

/** Every scope a key exists at, ascending by address. */
export function allByKey(device: EpmDevice, key: string): EpmRegister[] {
  return indexes[device].allByKey.get(key) ?? [];
}

/** Every key that appears at more than one address on this device. */
export function ambiguousKeys(device: EpmDevice): ReadonlySet<string> {
  return new Set(
    [...indexes[device].allByKey.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([k]) => k),
  );
}

/** The scope a register is reported at. */
export function scopeOf(device: EpmDevice, reg: EpmRegister): EpmScope {
  return indexes[device].scopeOfRecord.get(reg) ?? 'data';
}

/* ------------------------------------------------------------------ *
 * Addresses, offsets, and the frame.
 * ------------------------------------------------------------------ */

/** The space's base: 36000 for data, 36500 for settings. */
export function baseAddress(device: EpmDevice, scope: EpmScope): number {
  return indexes[device].baseOf.get(scope) ?? (scope === 'settings' ? 36500 : 36000);
}

/**
 * The address to put in the Modbus frame.
 *
 * On EPM this is the identity — `wire_offset` is 0 — but it is READ from the
 * map rather than assumed, so a future map that needs a correction gets it
 * without a code change. Returns null for an address the scope does not
 * describe, because guessing lands a read one register out and returns a
 * plausible wrong number instead of an error.
 */
export function wireAddress(
  device: EpmDevice,
  address: number,
  scope: EpmScope = 'data',
): number | null {
  if (!byScopedAddress(device, scope, address)) return null;
  return address + (indexes[device].wireOffsetOf.get(scope) ?? 0);
}

/** Absolute address for a relative offset. address = base + offset. */
export function addressForOffset(
  device: EpmDevice,
  scope: EpmScope,
  offset: number,
): number {
  return baseAddress(device, scope) + offset;
}

/** Relative offset for an absolute address. The inverse of the above. */
export function offsetForAddress(
  device: EpmDevice,
  scope: EpmScope,
  address: number,
): number {
  return address - baseAddress(device, scope);
}

/** The Modbus function code that reads a scope. */
export function functionForScope(scope: EpmScope): number {
  return scope === 'settings' ? 3 : 4;
}

/** The scope a Modbus function code reads. The inverse of the above. */
export function scopeForFunction(fn: number): EpmScope {
  return fn === 4 ? 'data' : 'settings';
}

/* ------------------------------------------------------------------ *
 * Decoding
 * ------------------------------------------------------------------ */

/**
 * Combine a register's raw words into its numeric value, before scaling.
 *
 * THIS IS THE FUNCTION THE LITTLE-ENDIAN TRAP LIVES IN. `words` must be given
 * in ADDRESS ORDER — `words[0]` is the word at `reg.address`. For a 32-bit
 * EPM register `word_order` is "le", so `words[0]` is the LOW half. Getting
 * this backwards produces a number in the hundreds of thousands of kW that
 * no error ever reports.
 *
 * Signedness comes from `data_type`. Watch `signedness_disputed`: at 36017
 * and 36508 the documents split U16 vs S16, and both are 16 bits, so no width
 * check can catch it — 0xFFE2 is either −30 or 65506.
 *
 * Returns null when the words needed are missing, so "not read yet" stays
 * distinguishable from "read as zero".
 */
export function decodeWords(
  reg: EpmRegister,
  words: (number | null | undefined)[],
): number | null {
  const need = reg.width === 32 ? 2 : 1;
  const got = words.slice(0, need);
  if (got.length < need || got.some((w) => w === null || w === undefined)) {
    return null;
  }
  const w = got as number[];

  if (need === 1) {
    const raw = w[0]! & 0xffff;
    return reg.data_type.startsWith('S') && raw & 0x8000 ? raw - 0x10000 : raw;
  }

  // Address order in, word order applied here and NOWHERE else.
  const [low, high] =
    // `!`: the one-word branch returned above, so both indices exist here.
    reg.word_order === 'le' ? [w[0]!, w[1]!] : [w[1]!, w[0]!];
  const raw = ((high & 0xffff) * 0x10000 + (low & 0xffff)) >>> 0;
  return reg.data_type.startsWith('S') && raw & 0x80000000
    ? raw - 0x100000000
    : raw;
}

/**
 * The scaled, display-ready number for a register's raw words.
 *
 * `scale` is a multiplier from the map and is never 0 — the build rejects
 * that, because a zero scale silently zeroes every reading.
 */
export function decodeValue(
  reg: EpmRegister,
  words: (number | null | undefined)[],
): number | null {
  const raw = decodeWords(reg, words);
  return raw === null ? null : raw * (reg.scale ?? 1);
}

/**
 * Split a byte-packed register into its low and high halves.
 *
 * `meterSelect` (36549) packs meter type low and location high; `inverterQty`
 * (36509) packs PV count low and hybrid count high. Writing a bare number to
 * either clears the other half, which is why these need read-modify-write.
 * Returns null when the register is not byte-packed.
 */
export function splitBytes(
  reg: EpmRegister,
  raw: number,
): { low: number; high: number } | null {
  if (!reg.byte_fields) return null;
  return { low: raw & 0xff, high: (raw >> 8) & 0xff };
}

/**
 * Rebuild a byte-packed register's word from its two halves.
 *
 * The read-modify-write partner of `splitBytes`. Both halves must be supplied
 * — that is the point: the caller has to have READ the other half first.
 */
export function joinBytes(low: number, high: number): number {
  return ((high & 0xff) << 8) | (low & 0xff);
}

/* ------------------------------------------------------------------ *
 * The UI model, read from the map rather than hardcoded.
 * ------------------------------------------------------------------ */

/** The `app_profile` block for a device: bases, views, fetch plan, groups. */
export function appProfile(device: EpmDevice): EpmAppProfile {
  return maps[device].app_profile;
}

/** The settings groups the map describes, in order. */
export function groups(device: EpmDevice): EpmGroup[] {
  return maps[device].app_profile.groups;
}

/**
 * The offset ranges to read to fill every settings group.
 *
 * KEEP AX's PLAN A LITERAL. AX settings span 0–52 with a 21-register hole,
 * and the map states the ranges deliberately: one read of 53 is cheaper than
 * two round-trips over the metered cloud proxy. A computed plan would split
 * it. So a `literal` plan is returned VERBATIM and never recomputed.
 *
 * A `computed` plan (EPM) is derived from the groups: consecutive batches are
 * merged while the gap between them is within `max_gap` and the running span
 * stays within `max_count`.
 */
export function fetchRanges(
  device: EpmDevice,
): { start: number; count: number }[] {
  const plan = maps[device].app_profile.fetch_all;
  if (plan.kind === 'literal') return plan.ranges.map((r) => ({ ...r }));

  const batches = groups(device)
    .filter(
      (g): g is EpmGroup & { batch_start: number; batch_end: number } =>
        g.batch_start !== null && g.batch_end !== null,
    )
    .map((g) => ({ start: g.batch_start, end: g.batch_end }))
    .sort((a, b) => a.start - b.start);

  const out: { start: number; count: number }[] = [];
  for (const b of batches) {
    const last = out[out.length - 1];
    if (last) {
      const lastEnd = last.start + last.count - 1;
      const gap = b.start - lastEnd - 1;
      const span = b.end - last.start + 1;
      if (gap <= plan.max_gap && span <= plan.max_count) {
        last.count = Math.max(last.count, span);
        continue;
      }
    }
    out.push({ start: b.start, count: b.end - b.start + 1 });
  }
  return out;
}

/** Total registers described for a device. */
export function registerCount(device: EpmDevice): number {
  return indexes[device].all.length;
}

/** The name to show for a device, from the map. */
export function displayName(device: EpmDevice): string {
  return maps[device].app_profile.display_name;
}
