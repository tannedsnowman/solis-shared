/**
 * The one place the PV gospel map is loaded.
 *
 * Mirrors `gospel.ts` (hybrid) deliberately: same record shape, same lookup
 * names, same "address is the primary identity" rule. A reader who knows one
 * knows the other.
 *
 * pv.json is ~1.2 MB. Import it HERE ONLY; every consumer takes the prebuilt
 * lookups below so webpack bundles the payload once.
 *
 * WHY PV IS SIMPLER THAN HYBRID
 * -----------------------------
 * The hybrid map carries self-describing module blocks and a parallel-system
 * block, so its `scopeOf` has to derive them. PV has neither. Its only
 * ambiguity is the DATA vs SETTINGS collision — 38 keys, `year`, `sn`,
 * `ctRatio` and friends, which exist in both the 0x04 read space and the
 * 0x03/0x06/0x10 holding space. So `GospelScope` here is just those two, plus
 * the one-register model space.
 *
 * THE WIRE OFFSET — the trap this map exists to make safe
 * ------------------------------------------------------
 * PV documents say the register address "needs to offset one bit". The
 * printed address is 3042; the number that goes in the Modbus frame is 3041.
 * The map stores the PRINTED address and carries the −1 separately as
 * `wire_offset` on each space, so nothing has to remember it.
 *
 *   printed 3042  ->  wire 3041  ->  extension index 42 (base 2999)
 *
 * `wireAddress()` is the ONLY place that subtraction should happen. Note the
 * model space (35000) has `wire_offset: 0` — it is NOT offset — which is
 * exactly the kind of exception a hardcoded −1 gets wrong.
 *
 * ADDRESS ALONE IS NOT UNIQUE IN PV — READ THIS BEFORE USING `byAddress`
 * ---------------------------------------------------------------------
 * This is the one place PV genuinely differs from hybrid, and getting it
 * wrong is silent. Hybrid separates its spaces by NUMBER: data lives at
 * 33000+, settings at 43000+, so an address names exactly one register.
 *
 * PV does not. Both spaces start at 3000 and OVERLAP: 260 addresses carry a
 * different register in each. 3042 is `inverterTemperature` (s16) when read
 * with function 0x04 and `en505492LowVoltageRideThroughMode` (u16) when read
 * with 0x03. Same number, different register, different sign.
 *
 * So the identity of a PV register is (SCOPE, ADDRESS), never address alone.
 * `byAddress` is therefore DATA-space only — the safe default, since that is
 * what a live-values view reads — and settings must be reached through
 * `byScopedAddress` / `settingsByAddress`. A single flat map keyed on address
 * would have quietly served the wrong register for a quarter of the map.
 */
import pvJson from './generated/pv.json';
import type { GospelRegister } from './gospel';

export type { GospelRegister };

/**
 * The scope a PV register is reported at.
 *
 * `model` is the single read-only 35000 register, which lives in its own
 * space with no wire offset.
 */
export type PvScope = 'data' | 'settings' | 'model';

interface RawSpace {
  space: string;
  reg_type: string;
  /** Added to a printed address to get the wire address. −1 for PV, 0 for model. */
  wire_offset: number;
  registers: GospelRegister[];
}

const spaces: RawSpace[] = (pvJson as any).register_spaces;

const all: GospelRegister[] = spaces.flatMap((s) => s.registers);

/* ------------------------------------------------------------------ *
 * Address lookups, one per scope. See the header: address alone is not
 * unique in PV, so there is no flat all-spaces map to reach for by mistake.
 * ------------------------------------------------------------------ */

/**
 * Addresses the model space claims, which the data space must not answer for.
 *
 * 35000 is listed in BOTH `operation_0x04` and `model_0x04` — the same
 * register, described twice. Only the model space carries the correct
 * `wire_offset: 0`, so serving the data-space copy would apply −1 and read
 * 34999. The model space is the more specific statement, so it wins.
 */
const modelAddresses = new Set(
  spaces
    .filter((s) => s.space === 'model_0x04')
    .flatMap((s) => s.registers.map((r) => r.address_start)),
);

/**
 * Merge the two descriptions of a model register.
 *
 * 35000 is described TWICE and the halves are not the same. The
 * `operation_0x04` copy carries the 701-entry model-name `value_map`; the
 * `model_0x04` copy carries the correct `wire_offset: 0` but no labels.
 *
 * Taking either one alone loses something real — the offset (reading 34999)
 * or every model name. So the model record wins on identity and the data
 * record fills in the label tables it is missing. Field-wise and narrow, so
 * a future map that carries both keeps working unchanged.
 */
function mergeModelRecord(model: GospelRegister): GospelRegister {
  const twin = spaces
    .filter((s) => s.space !== 'model_0x04')
    .flatMap((s) => s.registers)
    .find((r) => r.address_start === model.address_start);
  if (!twin) return model;
  return {
    ...model,
    value_map: model.value_map ?? twin.value_map,
    bit_flags: model.bit_flags ?? twin.bit_flags,
  };
}

function addressMap(scope: PvScope): Map<number, GospelRegister> {
  const space = spaces.find((s) =>
    scope === 'model'
      ? s.space === 'model_0x04'
      : s.space !== 'model_0x04' &&
        (s.reg_type === 'settings') === (scope === 'settings'),
  );
  const rows = (space?.registers ?? []).filter(
    (r) => scope === 'model' || !modelAddresses.has(r.address_start),
  );
  return new Map(
    rows.map((r) => [r.address_start, scope === 'model' ? mergeModelRecord(r) : r]),
  );
}

/**
 * DATA registers by absolute PRINTED address, e.g. 3042 -> inverterTemperature.
 *
 * Data space only, by design — see the header. For a settings register use
 * `settingsByAddress`; to be explicit either way use `byScopedAddress`.
 */
export const byAddress: Map<number, GospelRegister> = addressMap('data');

/** SETTINGS registers by absolute PRINTED address, e.g. 3042 -> LVRT mode. */
export const settingsByAddress: Map<number, GospelRegister> = addressMap('settings');

/** The single read-only model register (35000), which has no wire offset. */
export const modelByAddress: Map<number, GospelRegister> = addressMap('model');

/**
 * Look up by the pair that actually identifies a PV register.
 *
 * Prefer this wherever the scope is known — it cannot silently return the
 * other space's register the way a bare address lookup can.
 */
export function byScopedAddress(
  scope: PvScope,
  address: number,
): GospelRegister | null {
  const map =
    scope === 'settings'
      ? settingsByAddress
      : scope === 'model'
        ? modelByAddress
        : byAddress;
  return map.get(address) ?? null;
}

/**
 * The scope a Modbus function code reads.
 *
 * 0x04 is the live-data space; 0x03/0x06/0x10 are the holding (settings)
 * space. This is what makes "which 3042 did I just read?" answerable from
 * the frame itself rather than from context.
 */
export function scopeForFunction(fn: number): PvScope {
  return fn === 4 ? 'data' : 'settings';
}

/* ------------------------------------------------------------------ *
 * Scope and wire offset, read from the map, never hardcoded.
 * ------------------------------------------------------------------ */

/**
 * Scope is resolved by RECORD IDENTITY, not by address.
 *
 * Keyed on the record object itself, so the 260 addresses that exist in both
 * spaces each keep their own answer. Keying this on the number would have
 * made `scopeOf(dataRegister)` return 'settings' for a quarter of the map.
 */
const scopeOfRecord = new Map<GospelRegister, PvScope>();
const wireOffsetOfScope = new Map<PvScope, number>();
for (const s of spaces) {
  // The model space is a data space by reg_type but is its own scope: one
  // register, no offset, read-only.
  const scope: PvScope =
    s.space === 'model_0x04'
      ? 'model'
      : s.reg_type === 'settings'
        ? 'settings'
        : 'data';
  wireOffsetOfScope.set(scope, s.wire_offset ?? 0);
  for (const r of s.registers) {
    // The data space's duplicate of a model register is the model register.
    // Recording it as 'data' would hand it the −1 offset. See `addressMap`.
    const effective: PvScope =
      scope === 'data' && modelAddresses.has(r.address_start) ? 'model' : scope;
    scopeOfRecord.set(r, effective);
  }
}

// `addressMap('model')` hands back MERGED clones (see `mergeModelRecord`),
// which are not the objects the loop above recorded. Register them too, or
// `scopeOf` falls through to its 'data' default for exactly the register
// whose whole point is that it is not in the data space.
for (const reg of modelByAddress.values()) scopeOfRecord.set(reg, 'model');

/** The scope a register is reported at. */
export function scopeOf(reg: GospelRegister): PvScope {
  return scopeOfRecord.get(reg) ?? 'data';
}

/**
 * The address to put in the Modbus frame for a printed address.
 *
 * The offset belongs to the SPACE, so the scope must be named. It defaults to
 * 'data' because that is what a live-values read uses, but pass the scope
 * explicitly whenever you know it — the model space is NOT offset, and
 * applying −1 to 35000 reads the wrong register.
 *
 * Returns null for an address that scope does not describe, because guessing
 * an offset is how a read lands one register out and returns a plausible
 * wrong number rather than an error.
 */
export function wireAddress(
  printedAddress: number,
  scope: PvScope = 'data',
): number | null {
  if (!byScopedAddress(scope, printedAddress)) return null;
  return printedAddress + (wireOffsetOfScope.get(scope) ?? 0);
}

/* ------------------------------------------------------------------ *
 * Indexes
 * ------------------------------------------------------------------ */

/** key -> every register carrying that key, ordered by ascending address. */
export const allByKey: Map<string, GospelRegister[]> = (() => {
  const out = new Map<string, GospelRegister[]>();
  for (const r of all) {
    const list = out.get(r.key);
    if (list) list.push(r);
    else out.set(r.key, [r]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.address_start - b.address_start);
  }
  return out;
})();

/** Every key that appears at more than one address. */
export const ambiguousKeys: ReadonlySet<string> = new Set(
  [...allByKey.entries()].filter(([, v]) => v.length > 1).map(([k]) => k),
);

/**
 * Look up by camelCase key, e.g. "inverterTemperature".
 *
 * DOCUMENTED RESOLUTION FOR AMBIGUOUS KEYS: the LOWEST address in the DATA
 * space wins; if the key exists only in settings, the lowest settings address
 * wins. Stable (address order, not file order), and never silently dependent
 * on which record the generator emitted last.
 *
 * Callers needing a specific scope must use `byQualifiedKey`.
 */
export const byKey: Map<string, GospelRegister> = (() => {
  const out = new Map<string, GospelRegister>();
  for (const [key, list] of allByKey) {
    const dataFirst = list.filter((r) => scopeOfRecord.get(r) === 'data');
    out.set(key, (dataFirst.length ? dataFirst : list)[0]!);
  }
  return out;
})();

/**
 * Deterministic positional suffix for duplicates the map itself does not
 * distinguish — the 1-based occurrence in ASCENDING ADDRESS order, so it is
 * stable across rebuilds. See `gospel.ts` for the same rule.
 */
function positionalSuffix(reg: GospelRegister, siblings: GospelRegister[]): string {
  // Identity, not address. 35000 is described twice with the SAME address
  // (once in `operation_0x04`, once in `model_0x04`), so matching on the
  // number gives both records `#1` and one of them becomes unreachable.
  const index = siblings.indexOf(reg);
  return `#${index + 1}`;
}

/**
 * key -> register, with EVERY register reachable. One entry per register, so
 * `byQualifiedKey.size === registerCount`.
 *
 * Unambiguous keys are stored bare. Ambiguous ones are stored as
 * `<scope>.<key>`, e.g. `settings.year`, and if two still collide inside one
 * scope they additionally take the positional suffix.
 */
export const byQualifiedKey: Map<string, GospelRegister> = (() => {
  const out = new Map<string, GospelRegister>();
  for (const [key, list] of allByKey) {
    if (list.length === 1) {
      out.set(key, list[0]!);
      continue;
    }
    const byScope = new Map<PvScope, GospelRegister[]>();
    for (const r of list) {
      const scope = scopeOf(r);
      const bucket = byScope.get(scope);
      if (bucket) bucket.push(r);
      else byScope.set(scope, [r]);
    }
    for (const [scope, bucket] of byScope) {
      for (const r of bucket) {
        const suffix = bucket.length > 1 ? positionalSuffix(r, bucket) : '';
        out.set(`${scope}.${key}${suffix}`, r);
      }
    }
  }
  return out;
})();

/** Every register in one scope, ascending by address. */
export function registersInScope(scope: PvScope): GospelRegister[] {
  return all
    .filter((r) => scopeOfRecord.get(r) === scope)
    .sort((a, b) => a.address_start - b.address_start);
}

export const registerCount = all.length;
