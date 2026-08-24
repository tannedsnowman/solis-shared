/**
 * EPM and EPM-AX behavioural rules — how a setting may be WRITTEN.
 *
 * The map says what a register IS; these say what happens when you change it.
 * Only a handful of registers have one, and they are exactly the ones an
 * interface gets wrong: byte-packed words where a bare write clears the other
 * half, a backflow limit whose sign the documents disagree about, and two AX
 * enums whose codes the two apps label differently.
 *
 * KEYS ARE `space:address`
 * ------------------------
 * Same shape as the PV rules: `"settings:36511"`, `"data:36009"`. EPM
 * addresses do not overlap across spaces the way PV's do, but the key form is
 * kept identical so a reader who knows one file knows both — and so the
 * function code is never left implicit.
 *
 * TWO DEVICES, TWO RULE FILES
 * ---------------------------
 * `epmRules.json` and `axRules.json` are separate for the same reason their
 * maps are: offsets 9, 10, 11 and 13 name different settings on each device.
 * A rule about AX's five-mode `failSafe` must never attach to EPM's 0/1
 * `failSafeOnOff`. So `ruleFor` takes the device first, always.
 */
import epmRulesJson from './generated/epmRules.json';
import axRulesJson from './generated/axRules.json';
import type { EpmDevice, EpmScope, EpmRegister } from './epmGospel';

/** How a write must be performed. */
export type EpmWriteMode =
  /** Write the value. Nothing special. */
  | 'plain'
  /** Measurement register. Not writable at all. */
  | 'read_only'
  /** Read the word, change only your half or your bits, write it back. */
  | 'read_modify_write'
  /** Must be written together with the registers in `write_with`. */
  | 'write_together';

export interface EpmRule {
  title: string;
  /** 'enum' | 'value' | 'bitfield' | 'destructive'. */
  kind: string;
  /** Plain-language description of what the setting does. */
  summary: string;
  write: EpmWriteMode;
  write_explain?: string;
  /** What bites you if you get it wrong. Worth surfacing in the UI. */
  gotcha?: string;
  /** How to confirm the value is being read correctly. */
  check?: string;
  /** Other registers this one should be read or written alongside. */
  related_registers?: string[];
  /** For `write_together`: the other registers in the transaction. */
  write_with?: string[];
  /** Where the rule came from. Keeps the decision auditable. */
  sources?: string[];
  /** 'high' | 'medium' | 'low'. */
  confidence?: string;
  /**
   * Why `do_not_write` was cleared on a disputed enum.
   *
   * The map sets `do_not_write` automatically on any disputed enum — a
   * DEFAULT, not a verdict. A rule may clear it, but only by stating why, and
   * a rule whose own confidence is `low` cannot: the gospel build fails.
   * Present here so the UI can show the reason next to the enabled control.
   */
  overrides_do_not_write?: string;
}

interface RawRules {
  content_type: string;
  family: string;
  document: string;
  rules: Record<string, EpmRule>;
}

const files: Record<EpmDevice, RawRules> = {
  epm: epmRulesJson as unknown as RawRules,
  ax: axRulesJson as unknown as RawRules,
};

/** The rule key for a scoped address, e.g. "settings:36511". */
export function ruleKey(scope: EpmScope, address: number): string {
  return `${scope}:${address}`;
}

/**
 * The rule for a register, or null when it has none.
 *
 * Most registers have no rule, and that is not a gap — it means "write it
 * plainly, nothing surprising happens". Only surprises are recorded.
 */
export function ruleFor(
  device: EpmDevice,
  scope: EpmScope,
  address: number,
): EpmRule | null {
  return files[device].rules[ruleKey(scope, address)] ?? null;
}

/** The rule for a register record, which already knows its own scope. */
export function ruleForRegister(
  device: EpmDevice,
  reg: EpmRegister,
): EpmRule | null {
  return ruleFor(device, reg.space, reg.address);
}

/** Every rule on a device, keyed `space:address`. */
export function allRules(device: EpmDevice): Record<string, EpmRule> {
  return files[device].rules;
}

/**
 * Whether the UI may offer to WRITE this register.
 *
 * Four things can forbid it, and they are checked in this order:
 *
 * 1. It is a data register. Measurements are never written.
 * 2. It has no KEY — a `document_only` register that NEITHER app maps. See
 *    below; this one is easy to get wrong.
 * 3. A rule saying `read_only`.
 * 4. `do_not_write` on the map, UNLESS a rule cleared it. The map sets that
 *    flag automatically on any disputed enum; clearing it is a stated human
 *    decision that travels with the data as `do_not_write_cleared_because`.
 *
 * Anything else is writable: an absent rule means a plain write is fine.
 *
 * WHY KEYLESS MEANS NOT WRITABLE
 * ------------------------------
 * A keyless register is printed in a document but mapped by no app, so
 * nothing is known about its codes, its range, or what the device does when
 * it changes. AX settings 36514 is the one that shows why this must be a
 * rule rather than a judgement call: it is named "Inverter type Select",
 * which sounds eminently settable, and there is no store key to write
 * through even if it were.
 *
 * Every settings lane reached this conclusion independently and excluded them
 * by construction. It belongs here so a future widget cannot miss it.
 *
 * The disagreement does NOT disappear when `do_not_write` is cleared:
 * `value_map_disputed` stays true and the UI should keep showing it.
 */
export function isWritable(device: EpmDevice, reg: EpmRegister): boolean {
  if (reg.space === 'data') return false;
  if (!reg.key) return false;
  const rule = ruleForRegister(device, reg);
  if (rule?.write === 'read_only') return false;
  if (reg.do_not_write && !reg.do_not_write_cleared_because) return false;
  return true;
}

/**
 * How a write to this register must be performed.
 *
 * Defaults to `read_modify_write` for a byte-packed register even without a
 * rule: `meterSelect` and `inverterQty` pack two counts into one word, and a
 * bare write clears the half the user did not touch. Safe by default, because
 * the failure is silent.
 */
export function writeModeFor(
  device: EpmDevice,
  reg: EpmRegister,
): EpmWriteMode {
  const rule = ruleForRegister(device, reg);
  if (rule?.write) return rule.write;
  if (reg.byte_fields) return 'read_modify_write';
  return 'plain';
}

/**
 * The warnings a UI should show beside a register, most important first.
 *
 * Collected in one place so every widget surfaces the same set rather than
 * each remembering a different subset. Empty means nothing surprising.
 */
export function warningsFor(device: EpmDevice, reg: EpmRegister): string[] {
  const out: string[] = [];
  const rule = ruleForRegister(device, reg);

  if (reg.do_not_write && !reg.do_not_write_cleared_because) {
    out.push('Do not write: this register’s meaning is not agreed.');
  }
  if (reg.value_map_disputed) {
    out.push(
      'The two apps label these codes differently. The extension’s labels are shown.',
    );
  }
  if (reg.signedness_disputed) {
    out.push(
      'The documents disagree whether this is signed. Check a live reading before trusting a negative value.',
    );
  }
  if (reg.span_disputed) {
    out.push('The apps disagree how many registers this spans.');
  }
  if (reg.document_is_other_device) {
    out.push(
      `No document describes this address for this device${
        reg.document_describes
          ? ` — the printed table describes “${reg.document_describes}” on the other one`
          : ''
      }.`,
    );
  }
  if (reg.byte_fields) {
    out.push(
      'Two settings share this register. Writing one alone clears the other — read first.',
    );
  }
  if (rule?.gotcha) out.push(rule.gotcha);

  return out;
}

/** Total rules on a device. */
export function ruleCount(device: EpmDevice): number {
  return Object.keys(files[device].rules).length;
}
