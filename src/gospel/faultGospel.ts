/**
 * The fault map: one entry per fault BIT or CODE, across hybrid and PV.
 *
 * WHY FAULTS ARE THEIR OWN MAP
 * ----------------------------
 * The register maps answer "what is at this address". A fault is a different
 * question — "what does bit 3 of 33116 mean, and what should an installer go
 * and check" — and the second half has no field anywhere in a register map.
 *
 * So faults are a separate family with a `solution` on every entry. 653 of
 * them today: 310 hybrid, 343 PV.
 *
 * THE FOUR SHAPES
 * ---------------
 * A fault is identified by its `decode`, and each shape is reached by a
 * different lookup:
 *
 *   bitfield  (432)  register + bit     — one bit of a fault word
 *   discrete  (56)   register + bit     — same, from the Tauri lineage
 *   value     (120)  register + code    — a whole-word code, "0xF010"
 *   value+subcode (45) register + code + sub_code — a code refined by a
 *                                        second register
 *
 * `code` is a HEX STRING ("0xF010"), not a number, because that is how both
 * the documents and the app's own tables write it. `codeLabel` accepts a raw
 * number and formats it, so callers never have to care.
 *
 * SOLUTIONS ARE SPARSE, AND THAT IS EXPECTED
 * ------------------------------------------
 * 43 of 653 carry advice today. The rest are blank pending the vault's fault
 * work. `solutionFor` returning null means "nobody has written this one yet",
 * which is different from "this fault is fine" — callers should render
 * nothing rather than an empty box.
 *
 * The hybrid side has 47 more solutions lifted out of the retired mapper,
 * in `faultSolutions.ts`. Those are keyed by LABEL and are the
 * fallback here, so no advice is lost while the two sets converge.
 */
import faultsJson from './generated/faults.json';
import { solutionFor as legacyHybridSolution } from './faultSolutions';

export type FaultDecode = 'bitfield' | 'discrete' | 'value' | 'value+subcode';
export type FaultFamily = 'hybrid' | 'pv';

export interface FaultEntry {
  family: FaultFamily;
  id: string;
  decode: FaultDecode;
  register: number;
  register_name?: string;
  key?: string;
  /** Set on bitfield/discrete entries. */
  bit?: number;
  /** Set on value entries. Hex string, e.g. "0xF010". */
  code?: string;
  /** Set on value+subcode entries. */
  sub_register?: number;
  sub_code?: string;
  label: string;
  label_alt?: string | null;
  solution?: string;
  solution_source?: string | null;
  source?: string;
}

const all: FaultEntry[] = (faultsJson as any).faults ?? [];

/** Every fault entry, in map order. */
export const faults: readonly FaultEntry[] = all;

/** How many faults the map holds, by family. Useful in tests and diagnostics. */
export const faultCounts: Readonly<Record<string, number>> =
  (faultsJson as any).counts ?? {};

/** Normalise a raw word to the map's hex spelling: 61456 -> "0xF010". */
export function hexCode(value: number): string {
  return upper(value.toString(16));
}

/** register|bit -> entry, for the two bit-addressed shapes. */
const byBit = new Map<string, FaultEntry>();
/** register|CODE -> entry, for whole-word codes. */
const byCode = new Map<string, FaultEntry>();
/** register|CODE|SUBCODE -> entry. */
const bySubCode = new Map<string, FaultEntry>();
/** Folded label -> entry, for reaching advice by name. */
const byLabel = new Map<string, FaultEntry>();

const fold = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * One spelling for a hex code, whatever the caller wrote.
 *
 * The map spells them "0xF010": lowercase x, uppercase digits. Uppercasing
 * the whole string gives "0XF010", which matches nothing — the bug this
 * function exists to make impossible. Digits are also left-padded to four so
 * a caller's "0xF10" still lands.
 */
const upper = (c: string): string => {
  const body = c.replace(/^0[xX]/, '').toUpperCase().padStart(4, '0');
  return '0x' + body;
};

for (const f of all) {
  if (f.bit !== undefined) {
    const k = `${f.register}|${f.bit}`;
    if (!byBit.has(k)) byBit.set(k, f);
  }
  if (f.code !== undefined) {
    if (f.sub_code !== undefined) {
      const k = `${f.register}|${upper(f.code)}|${upper(f.sub_code)}`;
      if (!bySubCode.has(k)) bySubCode.set(k, f);
    } else {
      const k = `${f.register}|${upper(f.code)}`;
      if (!byCode.has(k)) byCode.set(k, f);
    }
  }
  if (f.label) {
    const k = fold(f.label);
    // First wins: a label shared across families is the same fault text, and
    // the advice does not differ by family.
    if (!byLabel.has(k)) byLabel.set(k, f);
  }
}

/** The fault at one bit of a fault word, or null. */
export function faultAtBit(register: number, bit: number): FaultEntry | null {
  return byBit.get(`${register}|${bit}`) ?? null;
}

/** The fault for a whole-word code, or null. Accepts a raw number. */
export function faultForCode(
  register: number,
  code: number | string,
): FaultEntry | null {
  const hex = typeof code === 'number' ? hexCode(code) : upper(code);
  return byCode.get(`${register}|${hex}`) ?? null;
}

/**
 * The fault for a code refined by a sub-code.
 *
 * Falls back to the plain code when the pair is not described, so a valid
 * fault still resolves when only its sub-code is unknown.
 */
export function faultForSubCode(
  register: number,
  code: number | string,
  subCode: number | string,
): FaultEntry | null {
  const hex = typeof code === 'number' ? hexCode(code) : upper(code);
  const sub = typeof subCode === 'number' ? hexCode(subCode) : upper(subCode);
  return (
    bySubCode.get(`${register}|${hex}|${sub}`) ??
    byCode.get(`${register}|${hex}`) ??
    null
  );
}

/** Every bit label of a fault word, lowest bit first. Gaps are null. */
export function bitLabels(register: number, width = 16): (string | null)[] {
  const out: (string | null)[] = [];
  for (let bit = 0; bit < width; bit++) {
    out.push(faultAtBit(register, bit)?.label ?? null);
  }
  return out;
}

/**
 * The installer fix for a fault, or null when nobody has written one.
 *
 * Tries the fault map first, then the 47 lifted out of the retired hybrid
 * mapper by label. Null means "not written yet", NOT "nothing to check" —
 * render nothing rather than an empty hint.
 */
export function solutionForFault(entry: FaultEntry | null): string | null {
  if (!entry) return null;
  if (entry.solution) return entry.solution;
  return legacyHybridSolution(entry.label);
}

/** The installer fix for a fault LABEL, across both sources. */
export function solutionForLabel(label: string): string | null {
  if (!label) return null;
  const hit = byLabel.get(fold(label));
  if (hit?.solution) return hit.solution;
  return legacyHybridSolution(label);
}
