/**
 * The register maths behind the PV Special Function screen, with no React.
 *
 * Three sections: constant-voltage MPPT, V/FRT ride-through, and the
 * miscellaneous "Other Setting" block that includes two destructive actions.
 * Fan control was the fourth and is its own screen — see
 * `pvFanControlModel.ts` for why.
 *
 * THE DANGEROUS PART: BIT00 OF 3312
 * ---------------------------------
 * 3312 `specialControlWord02` holds the constant-voltage MPPT enable in BIT00.
 * It also holds SIX SAFETY PROTECTIONS in BIT02-BIT07, and five of those are
 * ACTIVE-LOW: the bit SET means the protection is DISABLED.
 *
 *   BIT00  constant voltage MPPT enable      <- this screen, and only this
 *   BIT01  multi-channel MPPT parallel        Protection screen
 *   BIT02  relay protection        active-low Protection screen
 *   BIT03  leakage current         active-low Protection screen
 *   BIT04  grounding protection    active-low Protection screen
 *   BIT05  grid disturbance 02     active-low Protection screen
 *   BIT06  IgADCheck protection               Protection screen
 *
 * A blind write of 1 to 3312 to "turn constant voltage on" sets BIT00 and
 * CLEARS every other bit — which, because five of them are active-low,
 * ENABLES those five protections rather than disabling them, and disables
 * MPPT parallel. That particular direction happens to be safe. The reverse is
 * not: a blind write of 0 to turn it off clears BIT00 and leaves the rest at
 * 0 too, which is again "protections on". The real danger is a write of a
 * STALE word — a page read ten minutes ago writing back protections another
 * engineer has since changed.
 *
 * So every write of 3312 from this screen goes through `mergeForWrite` with
 * `constantVoltageMask()` — a mask of exactly one bit. Bits outside the mask
 * are taken from a fresh read of the device, so no protection can move
 * whatever this screen believes about them. `pvSpecialFunctionModel.test.ts`
 * proves it bit by bit.
 *
 * WHY THE BIT IS FOUND BY LABEL AND NOT COUNTED
 * ---------------------------------------------
 * 3312's `bit_flags` in `pv.json` USED TO BE WRONG — four entries reading
 * "Overload Protection Enhanced, Reserved, Reserved, Reserved", which
 * describes a different register entirely. They have since been corrected,
 * and a pvRules bitfield entry now carries the layout as well.
 *
 * The resolution order below is kept anyway, and the test pins all three
 * sources agreeing. The lookup was written to survive one source being wrong
 * because one source WAS wrong; deleting that now would leave the screen
 * trusting whichever it happened to read first, which is the arrangement that
 * produced the bug in the first place.
 *
 * `constantVoltageBit()` therefore resolves BY MEANING, in this order:
 *   1. a pvRules bit_group label mentioning constant voltage
 *   2. the map's bit_flags, if one mentions it
 *   3. the register's description prose, "BIT00: constant voltage Mppt..."
 *
 * and returns null if none of them say. Null DISABLES the row rather than
 * defaulting to bit 0 — because defaulting to a bit number is exactly how a
 * screen ends up writing a protection bit while believing it wrote an MPPT
 * mode. The one thing this file must never do is guess which bit it owns.
 *
 * WHAT THE MAP DOES NOT SUBSTANTIATE — reported, not invented
 * ----------------------------------------------------------
 * SolisCloud's Other Setting section lists these. They are NOT in the PV
 * settings map at any address, under any name (searched by address and by
 * keyword):
 *
 *   3209 PV ISO Fault Time  3210 PVISO Count
 *   3228 GPRS KEYA Set      3259 Power Display Dead Zone
 *   3260 IGBTSift_Step
 *
 * Nothing is drawn for any of them. `UNSUBSTANTIATED` carries the list to the
 * screen so it says so plainly, which is more useful than a silent omission
 * that reads as an oversight.
 *
 * TWO REGISTERS CAME OFF THAT LIST ON 2026-08-22
 * ----------------------------------------------
 * 3174 and 3175 were on it, and are not any more. The harvest had taken V17's
 * single blanket row `3156-3239 Reserve` literally and suppressed 84
 * addresses that V18/V19 actually document; the vault now lets a NAMED row
 * outrank a Reserve range.
 *
 *   3174 is NOT "V_Bus UP", which is what SolisCloud calls it. The map calls
 *   it `highVoltageRideThroughBoostBusVoltageCommandControlEnableFlag` — an
 *   HVRT boost-bus-voltage command enable. It is a ride-through flag, so it
 *   is drawn in the V/FRT section, not in Other. See `HVRT_BOOST_ROW`.
 *
 *   3175 is NOT "PV Fault Lockout". It is
 *   `noRestartFunctionAfterShutdownDueToPvInsulationFailure` — and it is TWO
 *   THINGS IN ONE REGISTER. See the Device Maintenance block below, which is
 *   the part of this file most likely to be got wrong.
 *
 * These tests now pin both as PRESENT rather than absent. The gap has bitten
 * twice; a harvest regression must fail loudly rather than silently dropping
 * them again.
 *
 * PRINTED 3175 GOES ON THE WIRE AS 3174 — AND 3174 IS ALSO A REGISTER
 * -------------------------------------------------------------------
 * PV settings carry `wire_offset: -1`, so printed 3175 leaves as frame 3174,
 * which is the number printed 3174 is called. Two neighbouring registers
 * whose printed and wire numbers cross over is exactly the arrangement that
 * makes an off-by-one look plausible in a capture. Nothing here subtracts
 * one; `usePvRegisterWrite` calls `wireAddress` and there is a test pinning
 * both, so the collision is proven rather than reasoned about.
 *
 * PRINTED ADDRESSES ONLY. Nothing here subtracts one; see `pvGospel.ts`.
 */
import { mergeForWrite } from '../../settings/index'
import {
  byScopedAddress,
  settingsByAddress,
  type GospelRegister,
} from '../../gospel/pvGospel'
import { ruleFor, type PvRule } from '../../gospel/pvRules'
import { first, group } from './captures'

/* ------------------------------------------------------------------ *
 * Addresses. PRINTED, always.
 * ------------------------------------------------------------------ */

/** Special control word 02. BIT00 is ours; the rest are protections. */
export const SPECIAL_CONTROL_02 = 3312

/** Constant-voltage MPPT setpoint. Only does anything while BIT00 is set. */
export const CONSTANT_VOLTAGE_SET = 3313

/** VRT enable switch — five independent ride-throughs in one word. */
export const VRT_ENABLE = 3033

/** BDEW LVRT K value, the gain for the BDEW bit of 3033. */
export const BDEW_K = 3034

/** 50549_2 VRT enable. A separate standard, a separate register. */
export const EN50549_VRT_ENABLE = 3041

/** 50549_2 low-voltage ride-through mode, an enum of five behaviours. */
export const EN50549_LVRT_MODE = 3042

export const EN50549_K1 = 3045
export const EN50549_K2 = 3046
export const EN50549_VOLTAGE_CHANGE = 3047
export const EN50549_Q_LIMIT = 3048

/** VRT enable flag bit. A magic-code master, 0xA5 off / 0x5A on. */
export const VRT_FLAG = 3088

/**
 * HVRT boost bus voltage command control enable.
 *
 * RECOVERED 2026-08-22, suppressed by a stale `3156-3239 Reserve` range.
 * SolisCloud calls this address "V_Bus UP", which is wrong: the map's name is
 * `highVoltageRideThroughBoostBusVoltageCommandControlEnableFlag`. It is a
 * HIGH-voltage ride-through flag, which is why it sits with V/FRT rather than
 * in Other Setting.
 */
export const HVRT_BOOST_ENABLE = 3174

/**
 * PV insulation fault non-stop switch, AND the clear-fault action.
 *
 * RECOVERED 2026-08-22, same Reserve-range suppression. Two different kinds
 * of thing share this register — see `PV_INSULATION_SWITCH_VALUES` and
 * `clearFaultValue()`.
 */
export const PV_INSULATION_NONSTOP = 3175

/** Meter or dual-RS485 selection for the shared port. */
export const METER_OR_DUAL_485 = 3227

/** Factory reset. DESTRUCTIVE — magic value. */
export const FACTORY_RESET = 3159

/** Clear generation data. DESTRUCTIVE — magic value, wipes yield history. */
export const CLEAR_YIELD = 3300

/** Grid filter number, 0-7. */
export const GRID_FILTER = 3314

/** Anti-islanding selection, a two-bit enum inside one register. */
export const ANTI_ISLANDING = 3124

/* ------------------------------------------------------------------ *
 * Lookups. Every one names its scope — a bare PV address is not an
 * identity. See `pvGospel.ts`.
 * ------------------------------------------------------------------ */

/** Gospel record for a settings register, or null when the map lost it. */
export function settingReg(address: number): GospelRegister | null {
  return byScopedAddress('settings', address)
}

/**
 * The rule for a settings register, or undefined when it has none.
 *
 * Looked up at CALL TIME, never at module load. `pvRules.json` is being
 * extended alongside this screen — a corrected 3312 bitfield must reach here
 * without an edit.
 */
export function ruleForSetting(address: number): PvRule | undefined {
  return ruleFor('settings', address)
}

/* ------------------------------------------------------------------ *
 * 3312 BIT00 — the only bit this screen owns.
 * ------------------------------------------------------------------ */

/** The words that identify the constant-voltage bit in any of its sources. */
const CONSTANT_VOLTAGE_RE = /constant\s*volt/i

/**
 * Which bit of 3312 is the constant-voltage MPPT enable?
 *
 * Resolved BY MEANING from whichever source states it, never counted. Null
 * when no source does, which disarms the row.
 *
 * The order is deliberate: the rules file is the correction layer and wins;
 * the map's structured `bit_flags` come next; the register's own prose is the
 * last resort and is currently the ONLY source that has it right, because
 * 3312's `bit_flags` today describe a different register.
 *
 * Returning null rather than 0 is the safety property of this whole file. A
 * default of 0 would be correct today and catastrophic the day it is not:
 * this screen would write the bit it thinks is an MPPT mode into what is
 * actually an active-low protection.
 */
export function constantVoltageBit(): number | null {
  const fromRule = bitFromRule(SPECIAL_CONTROL_02, CONSTANT_VOLTAGE_RE)
  if (fromRule !== null) return fromRule

  const fromFlags = bitFromFlags(SPECIAL_CONTROL_02, CONSTANT_VOLTAGE_RE)
  if (fromFlags !== null) return fromFlags

  return bitFromProse(SPECIAL_CONTROL_02, CONSTANT_VOLTAGE_RE)
}

/**
 * A bit whose rules-file label matches, or null.
 *
 * BOTH label shapes are searched. `bit_groups[].bit_labels` is how a rule
 * describes bits that constrain each other; `independent_bit_labels` is how it
 * describes bits that do not. 3312's corrected rule uses the second, because
 * its seven switches are freely combinable — and a lookup that read only the
 * first would have found nothing and silently fallen through to the map's
 * wrong `bit_flags`. Reading both is what makes "the rules file wins" true
 * rather than true-for-one-schema-shape.
 */
export function bitFromRule(address: number, re: RegExp): number | null {
  const rule = ruleForSetting(address)
  if (!rule) return null

  for (const group of rule.bit_groups ?? []) {
    for (const [bit, label] of Object.entries(group.bit_labels ?? {})) {
      if (re.test(String(label))) return Number(bit)
    }
  }

  const independent = (rule as { independent_bit_labels?: Record<string, string> })
    .independent_bit_labels
  for (const [bit, label] of Object.entries(independent ?? {})) {
    if (re.test(String(label))) return Number(bit)
  }
  return null
}

/** A bit whose map `bit_flags` entry matches, or null. */
export function bitFromFlags(address: number, re: RegExp): number | null {
  const flags = settingsByAddress.get(address)?.bit_flags
  if (!flags) return null
  const index = flags.findIndex((f) => f && re.test(f))
  return index === -1 ? null : index
}

/**
 * A bit the register's DESCRIPTION prose names, or null.
 *
 * The documents write it as "BIT00: constant voltage Mppt mode enable control
 * bit". Matching the label to the BIT token before it is what makes this
 * survive the bits being listed in any order, and what stops "constant
 * voltage" appearing in some later bit's note from being mistaken for the
 * declaration.
 */
export function bitFromProse(address: number, re: RegExp): number | null {
  const prose = settingsByAddress.get(address)?.description ?? ''
  // Split on each BITnn: header so a clause is scored against its own bit.
  const clauses = [...prose.matchAll(/BIT\s*(\d{1,2})\s*[:：]([^]*?)(?=BIT\s*\d{1,2}\s*[:：]|$)/gi)]
  for (const clause of clauses) {
    if (re.test(group(clause, 2))) return Number(group(clause, 1))
  }
  return null
}

/**
 * The mask this screen is allowed to claim in a write of 3312.
 *
 * EXACTLY ONE BIT, and 0 when the bit cannot be resolved. Zero is the correct
 * failure: `mergeForWrite` with a zero mask returns the device's word
 * untouched, so a screen that has lost track of which bit it owns writes
 * nothing rather than something.
 *
 * Never widened to "every bit the rule names" — that is what the hybrid
 * Protect screen deliberately avoids too, and here it would be worse: the
 * other bits are not this screen's to hold an opinion about at all.
 */
export function constantVoltageMask(): number {
  const bit = constantVoltageBit()
  return bit === null ? 0 : (1 << bit) & 0xffff
}

/** Is constant-voltage MPPT enabled in this word? Null when unresolvable. */
export function constantVoltageOn(word: number): boolean | null {
  const bit = constantVoltageBit()
  if (bit === null) return null
  return ((word >> bit) & 1) === 1
}

/**
 * The word to write to turn constant-voltage MPPT on or off.
 *
 * NOT active-low. 3312's protections are; BIT00 is not — the map says
 * "0---disable; 1---enable". Do not generalise the inversion from the
 * protections beside it onto this bit.
 *
 * Returns the word unchanged when the bit cannot be resolved.
 */
export function wordForConstantVoltage(word: number, on: boolean): number {
  const bit = constantVoltageBit()
  if (bit === null) return word & 0xffff
  return (on ? word | (1 << bit) : word & ~(1 << bit)) & 0xffff
}

/**
 * The value to actually put on the wire, merged against the device's word.
 *
 * This is the function the screen must call. `deviceWord` is a FRESH read of
 * 3312, not the page's cached one — everything outside the one-bit mask is
 * taken from it verbatim, so no protection can move because of anything this
 * screen believes.
 *
 * Kept here rather than in the JSX so it is testable, and so there is exactly
 * one expression in the codebase that decides what goes into 3312.
 */
export function mergedConstantVoltageWrite(
  deviceWord: number,
  on: boolean,
): number {
  return mergeForWrite(
    deviceWord,
    wordForConstantVoltage(deviceWord, on),
    constantVoltageMask(),
  )
}

/**
 * Bits of 3312 this screen must never move, for the test to assert against.
 *
 * Every bit except the one it owns — deliberately expressed as "everything
 * else" rather than as a list of protections, so a bit a later firmware adds
 * is protected the moment it exists rather than when someone remembers to add
 * it here.
 */
export function foreignBitsMask(): number {
  return (~constantVoltageMask() & 0xffff) >>> 0
}

/* ------------------------------------------------------------------ *
 * Rows.
 * ------------------------------------------------------------------ */

/** A plain settings row the screen draws an editor for. */
export interface SpecialRow {
  /** PRINTED address, settings space. */
  address: number
  label: string
  description: string
}

/**
 * Constant-voltage MPPT: a switch in one register and a setpoint in another.
 *
 * The setpoint is drawn directly under the switch because it does nothing on
 * its own — the map says the two registers "are used at the same time" — and
 * a voltage typed into a machine with the mode off is a silent no-op.
 */
export const CONSTANT_VOLTAGE_ROW: SpecialRow = {
  address: CONSTANT_VOLTAGE_SET,
  label: 'Constant voltage MPPT setpoint',
  description:
    'The DC voltage the inverter holds instead of tracking maximum power. Does nothing at all while the switch above is off — the two registers only work together.',
}

/**
 * The V/FRT rows.
 *
 * TWO SEPARATE RIDE-THROUGH SYSTEMS live here and they are not alternatives:
 *
 *   3033 is a bitfield of five NAMED STANDARDS (LVRT, US Rule21 VRT and FRT,
 *   Brazil LVRT, BDEW LVRT), each its own independent switch, with 3034
 *   carrying the BDEW gain.
 *
 *   3041-3048 are the EN 50549-2 family (also VDE4110, 50549-SW, Poland
 *   NC-RFG): one enable, a five-way mode enum, two K gains, a voltage-change
 *   percentage and a reactive-power ceiling.
 *
 * 3088 is a master flag over both, taking magic codes rather than 0/1.
 *
 * Drawn in that order — standards block, then 50549 block, then the master —
 * so the two systems do not read as one long list of ride-through fields.
 */
export const VRT_STANDARD_ROWS: SpecialRow[] = [
  {
    address: BDEW_K,
    label: 'BDEW LVRT K value',
    description:
      'The reactive-current gain BDEW LVRT applies during a dip. Only used while the BDEW bit of the switch above is on.',
  },
]

export const EN50549_ROWS: SpecialRow[] = [
  {
    address: EN50549_VRT_ENABLE,
    label: '50549-2 VRT enable',
    description:
      'Ride-through for EN 50549-2, VDE 4110, 50549-SW and Poland NC-RFG. A separate system from the five named standards above, with its own mode and gains below. Off by default.',
  },
  {
    address: EN50549_LVRT_MODE,
    label: '50549-2 low-voltage ride-through mode',
    description:
      'How the inverter behaves during a dip: none, added reactive current, or added reactive current combined with active-power priority, reactive-power limiting or a zero-current threshold. Read the choices from the register.',
  },
  {
    address: EN50549_K1,
    label: '50549-2 K1 during VRT',
    description:
      'First reactive-current gain. ACCURACY DIFFERS BY STANDARD: under 50549-2 the value is sent as written (1 means K=1); under VDE 4110, 50549-SW and Poland NC-RFG it is sent tenfold (15 means K=1.5). The map carries scale 1, so what you type is what is sent — convert for the standard you are commissioning to.',
  },
  {
    address: EN50549_K2,
    label: '50549-2 K2 during VRT',
    description:
      'Second reactive-current gain. Same standard-dependent accuracy as K1 above.',
  },
  {
    address: EN50549_VOLTAGE_CHANGE,
    label: '50549-2 VRT voltage change',
    description:
      'The voltage deviation, as a percentage of nominal, that counts as a ride-through event.',
  },
  {
    address: EN50549_Q_LIMIT,
    label: '50549-2 VRT reactive power ceiling',
    description:
      'The most reactive power the inverter will inject during a ride-through, as a percentage of rated.',
  },
]

export const VRT_MASTER_ROW: SpecialRow = {
  address: VRT_FLAG,
  label: 'VRT enable flag',
  description:
    'Master ride-through flag over both systems. A magic-code register, not a 0/1 switch — the map states 0xA5 for disable and 0x5A for enable, and the DSP default is on while the display default follows the grid code.',
}

/**
 * The HIGH-voltage ride-through boost-bus flag.
 *
 * Placed with V/FRT rather than in Other Setting on purpose. SolisCloud files
 * it under Other and labels it "V_Bus UP", which reads like a DC bus voltage
 * SETPOINT — a number you would type. It is neither: it is a 0/1 enable for
 * whether HVRT may command the boost stage to raise the bus.
 *
 * Everything else on this screen that concerns ride-through is in one place,
 * and an HVRT flag sitting three sections away under a bus-voltage-sounding
 * name is how someone commissioning ride-through misses it entirely. The map
 * supplies the name; this row supplies the location.
 *
 * The map gives it no `value_map`, so the screen draws it as a number rather
 * than inventing Enabled/Disabled labels — the description carries the
 * meaning of 0 and 1, which is where the document puts it too.
 */
export const HVRT_BOOST_ROW: SpecialRow = {
  address: HVRT_BOOST_ENABLE,
  label: 'HVRT boost bus voltage command',
  description:
    'Lets high-voltage ride-through command the boost stage to raise the DC bus while riding through an over-voltage. 0 not enabled, 1 enabled, default 0. SolisCloud lists this address as "V_Bus UP", which reads like a bus voltage setpoint — it is not a setpoint, it is an enable flag.',
}

/**
 * The Other Setting rows — the non-destructive ones.
 *
 * GRID FILTER (3314) IS DELIBERATELY NOT HERE. It was, until the Protection
 * screen's `PLAIN_ROWS` claimed it. Two rows writing one register is how two
 * engineers disagree without either seeing the other's change, so the second
 * claim yields rather than duplicating. See `GRID_FILTER_NOTE`.
 */
export const OTHER_ROWS: SpecialRow[] = [
  {
    address: METER_OR_DUAL_485,
    label: 'Meter or dual RS485',
    description:
      'What the shared RS485 port is for: meter communication, or a second 485 bus. Changing it takes the other function away — a meter on a port switched to dual 485 stops being read. For 5-25K series projects.',
  },
  {
    address: ANTI_ISLANDING,
    label: 'Anti-islanding',
    description:
      'Which island-detection scheme runs: the default, the Danish special scheme, both, or none. Turning island detection OFF is a factory diagnostic — a grid-connected inverter that cannot detect an island is a hazard to anyone working on the line.',
  },
]

/* ------------------------------------------------------------------ *
 * The destructive actions.
 * ------------------------------------------------------------------ */

/**
 * An action row: a button that writes one magic value. No value to show.
 *
 * Typed apart from `SpecialRow` on purpose — an action has no reading, no
 * range and no editor, and sharing a shape with a value row is how it
 * eventually acquires one.
 */
export interface SpecialAction {
  address: number
  label: string
  description: string
  /** Wipes something a customer cannot get back. Requires a deliberate confirm. */
  destructive: boolean
  /** The `?` prose spelling out exactly what is lost. */
  help: string
}

/**
 * The magic value that performs an action, from whichever source states it.
 *
 * NEVER typed here. The rule's `unlock_value` wins when a rule exists, since
 * that is the structured field for exactly this; otherwise the value is read
 * out of the register's own `value_map` or its description prose.
 *
 * Null disarms the button. That is the correct failure for a destructive
 * action: a factory reset triggered by a number this file invented is the
 * single worst outcome on the screen, and refusing to arm is cheap.
 */
export function actionValue(address: number): number | null {
  const fromRule = ruleForSetting(address)?.unlock_value
  if (typeof fromRule === 'number') return fromRule

  const reg = settingsByAddress.get(address)

  // A value_map entry whose LABEL says it triggers. Matched on meaning, not
  // on position: 3159's map is {0: "Normal", 43605: "RESET TRIGGERED"}.
  for (const [raw, label] of Object.entries(reg?.value_map ?? {})) {
    if (/trigger|enable|reset|clear/i.test(String(label)) && Number(raw) !== 0) {
      return Number(raw)
    }
  }

  // Otherwise the prose: "0x00AA: Enable", "0x55AA----represents clearing".
  const codes = [...(reg?.description ?? '').matchAll(/0x([0-9a-f]{2,4})/gi)]
    .map((m) => parseInt(group(m, 1), 16))
    .filter((n) => n !== 0)
  return codes.length ? first(codes) : null
}

export const FACTORY_RESET_ACTION: SpecialAction = {
  address: FACTORY_RESET,
  label: 'Factory reset',
  description:
    'Clears alarm history, resets every special setting to default and resets the grid code to default. Takes a magic value, not 1.',
  destructive: true,
  help: [
    `Factory reset does three things, and the map states all three: it clears the alarm messages, it resets every special setting to its default, and it resets the GRID CODE to default.`,
    `The grid code is the part that matters. Resetting it puts the inverter back on a default protection profile that may not be the one the site is certified to, and every commissioning setting made on this tab — voltage and frequency trip points, ride-through, power factor, export limits — goes with it.`,
    `There is no undo and no readback that tells you what the settings were. If the site's configuration is not written down somewhere else, it is gone.`,
    `It takes a magic value rather than 1, so nothing here fires by accident — but that is the register's protection, not this screen's. The confirm step is.`,
  ].join('\n\n'),
}

export const CLEAR_YIELD_ACTION: SpecialAction = {
  address: CLEAR_YIELD,
  label: 'Clear generation data',
  description:
    "Wipes the inverter's stored yield history — today, this month, this year and lifetime. Takes a magic value, not 1.",
  destructive: true,
  help: [
    `This wipes the generation totals the inverter has accumulated: daily, monthly, yearly and lifetime yield.`,
    `That data is the customer's record of what their system has produced. On a system under a performance guarantee or a feed-in arrangement it may be the only local record. Clearing it is not a diagnostic step and it cannot be undone from the inverter.`,
    `The monitoring portal may hold its own copy, which would survive this. Do not rely on that without checking first — the portal's history depends on the logger having been online.`,
    `It takes a magic value rather than 1. That stops an accidental write, not a deliberate one.`,
  ].join('\n\n'),
}

/* ------------------------------------------------------------------ *
 * Device Maintenance — register 3175, which is TWO THINGS.
 *
 * A SECTION, not a screen. The rail is six job screens plus ALL, and that
 * consolidation is deliberate; one register does not earn a seventh.
 * ------------------------------------------------------------------ */

/**
 * The two PERSISTENT values of 3175, as a switch.
 *
 * 0 and 1 are a setting that survives a power cycle. 0x2A is not — it is a
 * momentary action, and it is deliberately NOT in this list. The rule is
 * explicit: "An interface must present 0/1 as a switch and 0x2A as a separate
 * action, never as three items in one dropdown."
 *
 * That is not a style preference. A dropdown containing all three makes
 * "clear the fault log" look like a third mode you can sit in, so a fitter
 * selects it expecting a state and instead fires a one-shot that discards
 * diagnostic evidence — and then finds the register reading 0 again and
 * assumes it did not work.
 *
 * Read out of the register's own `value_map` rather than typed, filtered to
 * the values the map does NOT describe as momentary.
 */
export function pvInsulationSwitchValues(): Array<{
  value: number
  label: string
}> {
  const map = settingsByAddress.get(PV_INSULATION_NONSTOP)?.value_map ?? {}
  return Object.entries(map)
    .filter(([, label]) => !/momentary|clear/i.test(String(label)))
    .map(([value, label]) => ({ value: Number(value), label: String(label) }))
    .sort((a, b) => a.value - b.value)
}

/**
 * The ONE documented clear code, from the map. Null when it does not say.
 *
 * Matched on the label meaning rather than on the number, so 0x2A is never
 * typed into this file. Null disarms the button — the correct failure for an
 * action that discards a machine's fault evidence.
 */
export function clearFaultValue(): number | null {
  const map = settingsByAddress.get(PV_INSULATION_NONSTOP)?.value_map ?? {}
  for (const [raw, label] of Object.entries(map)) {
    if (/clear/i.test(String(label))) return Number(raw)
  }
  return null
}

/**
 * The non-stop switch.
 *
 * NOT a fault fix, and the description says so first. Setting it on makes the
 * inverter keep running with a PV insulation fault present — an earth-leakage
 * condition — so this is a safety-relevant setting rather than a
 * nuisance-trip workaround, and it is the sort of thing that gets set once by
 * someone chasing an intermittent trip and then left set for years.
 */
export const PV_INSULATION_ROW: SpecialRow = {
  address: PV_INSULATION_NONSTOP,
  label: 'PV insulation fault non-stop',
  description:
    'Whether the inverter keeps running when it detects a PV insulation fault. This is NOT a fix for the fault — turning it on makes the machine run with an earth-leakage condition present. Saved across a power cycle. The protection itself is switched on the Protection screen, and its threshold lives there too.',
}

/**
 * Clearing the latched fault information.
 *
 * Destructive because it discards evidence, not because it changes a setting.
 * The latched insulation-fault data is the only record on the machine of what
 * went wrong; clearing it before it has been read loses it for good.
 */
export const CLEAR_FAULT_ACTION: SpecialAction = {
  address: PV_INSULATION_NONSTOP,
  label: 'Clear fault information',
  description:
    'Clears the latched PV insulation fault information. A momentary action, not a setting — it is not saved at power off, and the register reads back as the switch value above. Read and record the fault before clearing it.',
  destructive: true,
  help: [
    `This clears the latched fault information the inverter is holding about a PV insulation failure.`,
    `That latched data is the EVIDENCE of what went wrong, and it is the only record of it on the machine. Once cleared there is no undo and nothing to recover it from. Read the fault and write it down before pressing this.`,
    `It is a MOMENTARY action, not a third setting. The register takes 0x2A, performs the clear, and does not save that value at power off — so afterwards the register reads back as whatever the non-stop switch above is set to. That is correct behaviour, not a failed write.`,
    `SolisCloud's Device Maintenance page shows TWO "Set" rows against this one address — "CLear PV ISO-PRO" and a truncated "CLear PVGndRun ...". This app offers ONE, because the documents substantiate one code. See the note below the button.`,
  ].join('\n\n'),
}

/**
 * Why there is one clear button here and two on SolisCloud.
 *
 * THIS IS A REFUSAL, AND IT IS DELIBERATE. The whole corpus was searched for
 * `PVGndRun`, `GndRun`, `ISO-PRO`, a ground-run lockout and a second clear
 * value, and none of it exists — neither app mapper carries an entry either.
 * So what SolisCloud's second row writes is genuinely UNKNOWN.
 *
 * A guessed value here would be written to a live machine's fault state. The
 * only honest options are to omit it or to explain it, and explaining it is
 * better: the next person to compare the two screens will otherwise assume
 * this app is missing a feature and go looking for the value themselves.
 *
 * Pinned by a test on this side, mirroring the vault's own.
 */
export const SECOND_CLEAR_REFUSED = [
  `SolisCloud's Device Maintenance page shows TWO "Set" actions on register ${PV_INSULATION_NONSTOP}: "CLear PV ISO-PRO" and a truncated "CLear PVGndRun ...". This app offers only the first.`,
  `The documents substantiate exactly ONE clear code for this register, 0x2A, for the PV insulation fault. No document in the corpus mentions PVGndRun, a ground-run lockout, or a second clear value, and neither app mapper has an entry for one.`,
  `So whatever the second row writes is unknown. It is not offered because guessing it would mean writing an invented number into a live machine's fault state — and unlike a setting you can read back and correct, a fault-clear cannot be undone.`,
  `This is a gap in the documents, not in this app. If the second code is ever proven on the wire, the row gets built then.`,
].join('\n\n')

export const DESTRUCTIVE_ACTIONS: SpecialAction[] = [
  FACTORY_RESET_ACTION,
  CLEAR_YIELD_ACTION,
]

/**
 * Does the map still call these registers destructive?
 *
 * `pvRules.json` marks a rule `kind: "destructive"` (3028 restart-HMI is the
 * one that has it today). Neither 3159 nor 3300 has a rule yet, so this
 * returns false for both and the screen's confirm step comes from the row's
 * own `destructive` flag instead.
 *
 * Exists so that when the rules arrive, the screen can PREFER them: a rule
 * that says destructive must be honoured even if someone edits the flag
 * below to false. The screen ORs the two, so the confirm can be added by the
 * rules file but never removed by it.
 */
export function ruleSaysDestructive(address: number): boolean {
  return ruleForSetting(address)?.kind === 'destructive'
}

/** Must this action be confirmed? Either source saying yes is enough. */
export function needsConfirm(action: SpecialAction): boolean {
  return action.destructive || ruleSaysDestructive(action.address)
}

/* ------------------------------------------------------------------ *
 * Help text.
 * ------------------------------------------------------------------ */

/** Why this screen touches one bit of 3312 and nothing else. */
export const SHARED_WORD_HELP = [
  `Register ${SPECIAL_CONTROL_02} is shared. BIT00 is the constant-voltage MPPT enable, which this screen owns. Everything above it is somebody else's: BIT01 is MPPT parallel, and BIT02 to BIT06 are SAFETY PROTECTIONS — relay, leakage current, grounding, grid disturbance 02 and grid-current sampling. Those live on the Protection screen.`,
  `Five of those protections are stored ACTIVE-LOW: the bit SET means the protection is DISABLED. So a careless write to this register does not just change a setting, it can turn off earth-leakage or grounding protection on a live machine while reporting success.`,
  `This screen never writes a whole word to ${SPECIAL_CONTROL_02}. It re-reads the register immediately before writing and merges in exactly one bit, so every other bit comes from the device as it is right now. Nothing this screen believes about the protections can reach the inverter, because this screen holds no belief about them.`,
  `The bit is found by its LABEL, not counted. The map's bit flags for ${SPECIAL_CONTROL_02} are currently wrong — they name a different register's fields — so the layout is read from the register's own description text instead, and a corrected map or rules file will be preferred automatically. If no source states which bit it is, the row disables itself rather than guessing, because guessing here means writing a protection bit.`,
].join('\n\n')

/** Why there are two ride-through systems on one screen. */
export const VRT_HELP = [
  `There are TWO independent ride-through systems here, not one.`,
  `${VRT_ENABLE} is a bitfield of five NAMED STANDARDS, each its own switch: LVRT, US Rule 21 VRT, US Rule 21 FRT, Brazil LVRT and BDEW LVRT. Any combination is valid. Four of the five default ON — only LVRT defaults off.`,
  `The rules file is explicit that ${VRT_ENABLE} must be read-modify-written: a blind write of 1 to enable LVRT sets that bit and CLEARS the other four, disabling ride-through for US Rule 21, Brazil and BDEW in a single write that reports success. This screen writes only the bit you moved.`,
  `${EN50549_VRT_ENABLE} to ${EN50549_Q_LIMIT} are a different system entirely — EN 50549-2, and with it VDE 4110, 50549-SW and Poland NC-RFG. One enable, a five-way mode, two gains, a voltage-change threshold and a reactive-power ceiling. It is off by default and is not affected by the switches above.`,
  `${VRT_FLAG} is a master flag over both, and it takes magic codes (0xA5 disable, 0x5A enable) rather than 0 and 1.`,
  `Watch K1 and K2: their accuracy DIFFERS BY STANDARD. Under 50549-2 a value of 1 means K=1. Under VDE 4110, 50549-SW and Poland NC-RFG, 15 means K=1.5. The register carries no scale to distinguish them, so the number you send must match the standard the site is commissioned to.`,
].join('\n\n')

/**
 * Where grid filter went, so nobody looks for it here and adds it back.
 *
 * Checked late, on purpose: 3314 was unclaimed when this screen was designed
 * and the Protection screen took it while both were being built. The note
 * survives the row so the next person finds the answer instead of the gap.
 */
export const GRID_FILTER_NOTE = `Grid filter (${GRID_FILTER}) is on the Protection screen, not here — it was claimed there while both screens were being built. It is not drawn twice: two rows writing one register is how two engineers disagree without either seeing the other's change.`

/** True while the Protection screen's claim on 3314 still holds. */
export const GRID_FILTER_OWNED_ELSEWHERE = true

/**
 * Registers the brief asked for that the map does not contain.
 *
 * Carried as data so the screen can list them, and so a test can assert the
 * list is still accurate — the day the map gains one of these, the test
 * fails and the row gets built instead of the excuse being left up forever.
 */
export const UNSUBSTANTIATED: Array<{ address: number; asked: string }> = [
  /* 3174 and 3175 were here until 2026-08-22, when the Reserve-range fix
     recovered them. They are drawn now — see HVRT_BOOST_ROW and the Device
     Maintenance block. Do not add them back. */
  { address: 3209, asked: 'PV ISO Fault Time Set' },
  { address: 3210, asked: 'PVISO Count' },
  { address: 3228, asked: 'GPRS KEYA Set' },
  { address: 3259, asked: 'Power Display Dead Zone' },
  { address: 3260, asked: 'IGBTSift_Step' },
]

/** True when the map still has nothing at that address in the settings space. */
export function stillUnsubstantiated(address: number): boolean {
  return settingsByAddress.get(address) === undefined
}

export const UNSUBSTANTIATED_HELP = [
  `SolisCloud's Other Setting section lists several rows this screen does not draw. They are not omissions — the registers are not in the gospel map at all, at those addresses or under those names.`,
  UNSUBSTANTIATED.map((u) => `  ${u.address}  ${u.asked}`).join('\n'),
  `Each address was checked twice: directly, and by searching the whole settings space for the name. In every case the address either holds an unrelated register or holds nothing.`,
  `Nothing is drawn for them because a row here would have to invent a scale, a range and a meaning, and then write a number to a register whose purpose this app does not know. If a later map revision adds them, they will be built then.`,
].join('\n\n')

/**
 * Every settings register this screen concerns itself with, for the range
 * button highlight.
 *
 * Built from the row structures so a row added or removed moves this with it.
 */
export function pvSpecialFunctionAddresses(): number[] {
  return Array.from(
    new Set([
      SPECIAL_CONTROL_02,
      CONSTANT_VOLTAGE_ROW.address,
      VRT_ENABLE,
      ...VRT_STANDARD_ROWS.map((r) => r.address),
      ...EN50549_ROWS.map((r) => r.address),
      VRT_MASTER_ROW.address,
      HVRT_BOOST_ROW.address,
      ...OTHER_ROWS.map((r) => r.address),
      PV_INSULATION_ROW.address,
      CLEAR_FAULT_ACTION.address,
      ...DESTRUCTIVE_ACTIONS.map((a) => a.address),
    ]),
  ).sort((a, b) => a - b)
}
