/**
 * PV behavioural rules — how a setting may be WRITTEN.
 *
 * The map says what a register IS; these say what happens when you change it.
 * Only 11 PV registers have one, and they are the ones an interface gets
 * wrong: magic unlock codes, writes that must go together, and words where a
 * bare write silently clears switches the user never touched.
 *
 * KEYS ARE `space:address`, NOT a bare address
 * -------------------------------------------
 * Hybrid rules are keyed `"43110"` because a hybrid address names exactly one
 * register. PV addresses do not — data and settings overlap on 260 of them
 * (see `pvGospel.ts`). So PV rules are keyed `"settings:3027"`, and
 * `ruleFor(scope, address)` is the only supported way in. There is
 * deliberately no bare-address lookup to reach for by mistake.
 */
import rulesJson from './generated/pvRules.json';
import type { PvScope } from './pvGospel';

/** How a write must be performed. */
export type PvWriteMode =
  /** Write the value. Nothing special. */
  | 'plain'
  /** Function 0x06 only — never inside a 0x10 block write. */
  | 'single_register_only'
  /** Read the word, change only your bits, write it back. */
  | 'read_modify_write'
  /** Must be written together with the registers in `write_with`. */
  | 'write_together';

export interface PvBitGroup {
  name: string;
  /**
   * The map's own claim about the group.
   *
   * TREAT THIS AS UNRELIABLE — use `isExclusiveGroup()`, never this field
   * directly. See the note there.
   */
  rule: string;
  /** Bit numbers in the group, or null when the map does not enumerate them. */
  bits: number[] | null;
  /** Prose from the source document. */
  explain?: string;
  /** bit number (as a string key) -> label. */
  bit_labels?: Record<string, string>;
}

export interface PvRule {
  title: string;
  /** 'enum' | 'bitfield' | 'value' | 'destructive'. */
  kind: string;
  summary: string;
  write: PvWriteMode;
  write_explain?: string;
  /** The magic value that actually performs the action, e.g. 0xAA55. */
  unlock_value?: number;
  /** What bites you if you get it wrong. Worth surfacing in the UI. */
  gotcha?: string;
  bit_groups?: PvBitGroup[];
  /**
   * Bits that are free-standing switches — no selector, no siblings cleared.
   *
   * A word can hold both: 3304 has four independent bits AND a two-bit AFCI
   * group. A bit is never in both, and the vault build fails if one is.
   */
  independent_bits?: number[];
  /** Why those bits are independent, and which of them are inverted. */
  independent_explain?: string;
  /**
   * bit number (as a string key) -> label, for `independent_bits`.
   *
   * ACTIVE-LOW POLARITY LIVES HERE. On 3312 the protections read
   * "Relay Protection (0=Enable, 1=Disable)" — the bit SET means the
   * protection is OFF. A screen finds its bits by matching a label PREFIX
   * (see `Hybrid/Settings/protectSettingModel.ts`), so the suffix is what
   * tells the reader which way round the bit goes. Render the raw bit and
   * you will tell a fitter a protection is on while it is off.
   */
  independent_bit_labels?: Record<number, string>;
  /** bit number (as a string key) -> prose. Repeats the polarity in words. */
  bit_notes?: Record<number, string>;
  /** True when performing the write loses data or configuration. */
  destructive?: boolean;
  /** Exactly what is lost, and what to save first. */
  destructive_explain?: string;
  /**
   * More than one magic ON code, each enabling DIFFERENT registers.
   *
   * 3071 is the case: 0xA1 unlocks the reactive-power set-point and 0xA2
   * unlocks the power factor. A boolean toggle cannot express the choice.
   */
  unlock_values?: Record<string, string>;
  /** The magic value meaning OFF, where that is not simply 0. */
  off_value?: number;
  /** How the related registers relate. */
  related_explain?: string;
  /** For `write_together`: the other registers in the transaction. */
  write_with?: string[];
  related_registers?: string[];
  applies_when?: string;
  enables?: string;
  sources?: string[];
  confidence?: string;
  /** Printed address. */
  register: number;
  space: string;
  key: string;
  name: string;
  /** Address as it goes in the frame — already offset. */
  wire_address: number;
}

/** Every rule, keyed exactly as the JSON has it: `"settings:3027"`. */
export const rulesByScopedAddress: Record<string, PvRule> = (rulesJson as any)
  .rules;

/**
 * The rule for a register, or undefined when it has none.
 *
 * Most registers have none — that is normal and means "write it plainly".
 */
export function ruleFor(
  scope: PvScope,
  printedAddress: number,
): PvRule | undefined {
  return rulesByScopedAddress[`${scope}:${printedAddress}`];
}

/**
 * True when a bit group really is "pick exactly one" — radio buttons.
 *
 * WHY THIS IS NOT JUST `group.rule === 'mutually_exclusive'`
 * ---------------------------------------------------------
 * Every PV bitfield group in the map today is TAGGED `mutually_exclusive`
 * while its own `explain` text says the opposite, and all three carry
 * `bits: null`:
 *
 *   3033 "Each bit is its own standard's ride-through and any combination
 *         is valid."
 *   3069 "They are not a selector — any combination is valid."
 *   3118 two independent enables.
 *
 * Trusting the tag would render five independent ride-through switches as
 * radio buttons, so turning on Brazil LVRT would turn OFF US Rule21 — the
 * exact silent-clobber failure these rules exist to prevent, introduced by
 * the thing meant to prevent it.
 *
 * So a group is only exclusive when it ENUMERATES the bits it selects
 * between. A group with `bits: null` cannot be a selector: there is nothing
 * to select among. This is conservative in the safe direction — checkboxes
 * can express any state, radio buttons cannot.
 *
 * If the map is corrected to carry real `bits` arrays, this starts returning
 * true on its own with no code change.
 */
export function isExclusiveGroup(group: PvBitGroup): boolean {
  return (
    (group.rule === 'exactly_one' || group.rule === 'mutually_exclusive') &&
    Array.isArray(group.bits) &&
    group.bits.length > 1
  );
}

/**
 * Bit number -> label for a rule, flattened across its groups.
 *
 * Keys in `bit_labels` are strings because they came from JSON.
 */
export function bitLabels(rule: PvRule): Record<number, string> {
  const out: Record<number, string> = {};
  for (const group of rule.bit_groups ?? []) {
    for (const [bit, label] of Object.entries(group.bit_labels ?? {})) {
      out[Number(bit)] = label;
    }
  }
  return out;
}

/**
 * True when writing this register needs a magic value rather than 0/1.
 *
 * `3027 drmOnOff` takes 0x00AA, not 1 — writing 1 does nothing at all, with
 * no error. A plain on/off toggle is wrong for these.
 */
export function needsUnlockValue(rule: PvRule): boolean {
  return typeof rule.unlock_value === 'number';
}

export const ruleCount = Object.keys(rulesByScopedAddress).length;
