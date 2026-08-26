/**
 * The register maths behind the Control Panel screen.
 *
 * The screen holds the inverter on/off switch and the grid-support modes that
 * decide how much real and reactive power the machine puts out.
 *
 * THE ONE THING TO UNDERSTAND HERE
 * --------------------------------
 * 43451 packs EIGHT modes into one word, and six of them command the same
 * physical quantity — reactive power. Volt-var, Fixed PF, Fixed reactive
 * power, Power-PF, P-Q and Qref cannot sensibly run together, so turning one
 * on clears the other five. `at_most_one` rather than `exactly_one`: all six
 * off is a legal state meaning no reactive mode is running.
 *
 * BIT00 Volt-watt is deliberately NOT in that group. It curtails REAL power
 * against voltage, so it does not compete with the reactive modes and grid
 * codes commonly run it alongside one. Folding it into the exclusive group
 * would silently switch off a curtailment curve the installer set.
 *
 * BIT06 Volt-Control is also left free. The documents do not say whether it
 * conflicts with the group, and clearing a mode on a guess is worse than
 * leaving one set.
 *
 * The exclusivity itself is INFERRED, not wire-proven — see the rule's
 * `confidence_note` in the gospel. The bit numbers and labels are v3.5 p67
 * verbatim and are read out of the rules file here, never typed as literals,
 * so a corrected document breaks a test rather than a customer's site.
 *
 * SETPOINTS BELONG TO MODES
 * -------------------------
 * The old documents talk about "mode 3" and "mode 4". Those are 1-BASED
 * indexes into the bit list, not bit numbers:
 *
 *   "only for mode 3" -> BIT02 Fixed PF       -> 43054
 *   "only for mode 4" -> BIT03 Fixed reactive -> 43051
 *
 * 43052 (max output power) is tied to no mode; it is a plain ceiling.
 */
import { byAddress } from '../../gospel/gospel'
import type { RegisterRule } from '../../settings/bitRules'
import { applyBitChange, isSet } from '../../settings/bitRules'
import { ruleFor } from '../settings/GospelRows'

/** Inverter on/off. An ENUM, not a bitfield: 190 = ON, 222 = OFF. */
export const ON_OFF = 43007

/** Standard Operating Mode Switch — the eight-mode bitfield. */
export const MODE_SWITCH = 43451

/** Inverter max output power, % of rated. Plain ceiling, no mode attached. */
export const MAX_OUTPUT_POWER = 43052
/** PF setpoint for Fixed PF. */
export const PF_SETPOINT = 43053
/** Second PF setpoint — "only for mode 3", i.e. BIT02 Fixed PF. */
export const PF_SETPOINT_02 = 43054
/** Reactive power setpoint — "only for mode 4", i.e. BIT03 Fixed reactive. */
export const REACTIVE_SETPOINT = 43051

/** Labels as the rules file spells them. Lookups go through `bitOf`. */
export const VOLT_WATT = 'Volt-watt'
export const VOLT_VAR = 'Volt-var'
export const FIXED_PF = 'Fixed PF'
export const FIXED_REACTIVE = 'Fixed reactive power'
export const POWER_PF = 'Power-PF'
export const P_Q = 'P-Q'
export const VOLT_CONTROL = 'Volt-Control'
export const QREF = 'Qref'

/**
 * The 43451 rule.
 *
 * Goes through `ruleFor` rather than touching the rules map directly:
 * `rulesByAddress` is a plain record keyed by STRING, not a Map, and reaching
 * into it here would duplicate that detail in a second place.
 */
export function modeRule(): RegisterRule | undefined {
  return ruleFor(MODE_SWITCH)
}

/**
 * Bit number for a mode label, or null when the rules file no longer carries
 * it.
 *
 * NULL, never a fallback number. A missing label means the gospel changed
 * under us, and flipping a guessed bit is how the wrong grid-support mode gets
 * switched on at a live site.
 */
export function bitOf(
  rule: RegisterRule | undefined,
  label: string,
): number | null {
  if (!rule) return null
  const want = label.trim().toLowerCase()

  for (const g of rule.bit_groups ?? []) {
    for (const [bit, name] of Object.entries(g.bit_labels ?? {})) {
      if (String(name).trim().toLowerCase() === want) return Number(bit)
    }
  }
  for (const [bit, name] of Object.entries(rule.independent_bit_labels ?? {})) {
    if (String(name).trim().toLowerCase() === want) return Number(bit)
  }
  return null
}

/** Is this mode on in `word`? */
export function modeIsOn(word: number, bit: number): boolean {
  return isSet(word, bit)
}

/**
 * The word to write to turn one mode on or off.
 *
 * Delegates to `applyBitChange`, which is what enforces the group rules:
 * setting a member of the `at_most_one` group clears its five siblings, and
 * every bit outside the group is left exactly as it was.
 */
export function wordForMode(
  rule: RegisterRule,
  word: number,
  bit: number,
  on: boolean,
): number {
  return applyBitChange(rule, word, bit, on)
}

/** A row on the screen. */
export interface ControlRow {
  address: number
  label: string
  description: string
  /** Present on the eight mode rows; absent on value rows. */
  bitLabel?: string
  /**
   * Bit that must be ON for this row to matter.
   *
   * The setpoints are only obeyed while their mode runs, so the row says so
   * rather than pretending an idle number does something.
   */
  requiresBitLabel?: string
}

/**
 * The screen, in the order an installer works.
 *
 * On/off first because it gates everything. Then the real-power ceiling, which
 * applies whatever mode is running. Then the reactive modes, each setpoint
 * sitting directly under the mode that uses it, so the pairing is visible
 * without cross-referencing a manual.
 */
export const CONTROL_ROWS: ControlRow[] = [
  {
    address: ON_OFF,
    label: 'Inverter power',
    description:
      'Starts and stops the inverter. An enum, not a switch: 190 (0xBE) is ON and 222 (0xDE) is OFF.',
  },
  {
    address: MAX_OUTPUT_POWER,
    label: 'Inverter max output power',
    description:
      'Ceiling on real power, as a percentage of rated. 100 % is rated power; most S6 3-phase HV units stop at 100 %, while 5G/S5 and S6 1P LV 3-8K allow up to 110 %. Applies whatever mode is running.',
  },
  {
    address: MODE_SWITCH,
    bitLabel: VOLT_WATT,
    label: 'Volt-watt',
    description:
      'Curtails REAL power as grid voltage rises. Independent of the reactive modes below — it controls a different quantity, so it may run alongside one.',
  },
  {
    address: MODE_SWITCH,
    bitLabel: FIXED_PF,
    label: 'Fixed power factor',
    description:
      'Holds a constant power factor. Turning this on switches off the other reactive-power modes.',
  },
  {
    address: PF_SETPOINT,
    label: 'Power factor setpoint',
    requiresBitLabel: FIXED_PF,
    description:
      'The power factor to hold. Valid from 0.80 to 1.00 and from -1.00 to -0.80; 1.00 and -1.00 mean the same thing. Only obeyed while Fixed power factor is on.',
  },
  {
    address: PF_SETPOINT_02,
    label: 'Power factor setpoint 02',
    requiresBitLabel: FIXED_PF,
    description:
      'Second power factor register. The document calls it "only for mode 3", which is the 1-based position of Fixed power factor in the bit list, so it belongs to the same mode as the setpoint above.',
  },
  {
    address: MODE_SWITCH,
    bitLabel: FIXED_REACTIVE,
    label: 'Fixed reactive power',
    description:
      'Holds a constant reactive power. Turning this on switches off the other reactive-power modes.',
  },
  {
    address: REACTIVE_SETPOINT,
    label: 'Reactive power setpoint',
    requiresBitLabel: FIXED_REACTIVE,
    description:
      'Reactive power to hold, as a percentage of rated, from -60 % to +60 %. Negative is inductive, positive is capacitive. Only obeyed while Fixed reactive power is on.',
  },
  {
    address: MODE_SWITCH,
    bitLabel: VOLT_VAR,
    label: 'Volt-var',
    description:
      'Reactive power follows a curve against grid voltage. One of the exclusive reactive modes.',
  },
  {
    address: MODE_SWITCH,
    bitLabel: POWER_PF,
    label: 'Power-PF',
    description:
      'Power factor follows a curve against output power. One of the exclusive reactive modes.',
  },
  {
    address: MODE_SWITCH,
    bitLabel: P_Q,
    label: 'P-Q',
    description:
      'Reactive power follows a curve against real power. One of the exclusive reactive modes.',
  },
  {
    address: MODE_SWITCH,
    bitLabel: QREF,
    label: 'Qref',
    description:
      'Legacy VDE4110 multi-point volt-to-reactive curve (mode 0E). One of the exclusive reactive modes.',
  },
  {
    address: MODE_SWITCH,
    bitLabel: VOLT_CONTROL,
    label: 'Volt control',
    description:
      'VDE4110 piecewise-linear volt-to-reactive curve (mode 0D). Left independent: the documents do not say whether it conflicts with the modes above, so it is not cleared on a guess.',
  },
]

/** The edit slot a row stages into. Not the address — 43451 carries 8 rows. */
export function slotOf(row: ControlRow): string {
  return row.bitLabel ? `${row.address}:${row.bitLabel}` : String(row.address)
}

/** Every register this screen reads, for the range-button highlight. */
export function controlAddresses(): number[] {
  return Array.from(new Set(CONTROL_ROWS.map((r) => r.address))).sort(
    (a, b) => a - b,
  )
}

/** Gospel entry for a row, or undefined when the map lost it. */
export function regOf(address: number) {
  return byAddress.get(address)
}
