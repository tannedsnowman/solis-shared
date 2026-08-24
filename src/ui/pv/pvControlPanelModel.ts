/**
 * The register maths behind the PV Control Panel screen, with no React in it.
 *
 * The screen holds the inverter on/off switch, the night SVG (reactive power
 * after dark) settings, and the HMI restart action.
 *
 * WHY PV NEEDS ITS OWN MODEL RATHER THAN REUSING THE HYBRID ONE
 * -------------------------------------------------------------
 * Two differences, and both of them are silent when you get them wrong.
 *
 * 1. ADDRESS ALONE IS NOT AN IDENTITY IN PV. Hybrid separates its spaces by
 *    number — data at 33000+, settings at 43000+ — so `byAddress.get(43007)`
 *    can only mean one thing. PV's two spaces BOTH start at 3000 and overlap
 *    on 260 addresses. 3030 is `alarmCodeData` under function 0x04 and
 *    `nightSvgQSet` under 0x03. This screen wants the SETTINGS one. Every
 *    lookup here therefore names its scope, and there is no bare-address
 *    helper in this file to reach for by mistake. See `pvGospel.ts`.
 *
 * 2. PV RULES ARE KEYED `space:address`, NOT a bare address. The hybrid
 *    `ruleFor(43007)` in `useRegisterWrite.ts` reads `hybridRules.json` and
 *    would answer `undefined` for every PV register even when a rule exists.
 *    This file goes through `pvRules.ruleFor(scope, address)` instead, which
 *    is the only lookup that can see `pvRules.json`.
 *
 * THE WIRE OFFSET
 * ---------------
 * PV documents print an address one HIGHER than the number that goes in the
 * Modbus frame: printed 3007 is wire 3006. This file deals only in PRINTED
 * addresses, which is what the gospel stores and what an engineer reads off a
 * manual. `wireAddress('settings', n)` performs the subtraction and is the
 * only place it is allowed to happen — see `pvGospel.ts`. Nothing here
 * subtracts one.
 *
 * WHAT IS DELIBERATELY ABSENT: "24-HOUR LOAD MONITORING"
 * ------------------------------------------------------
 * SolisCloud's on/off page lists a "24-Hour Load Monitoring" switch against
 * register 3007 under "Other Setting". There is no such switch at 3007. In
 * the settings space 3007 is `onOff`, a two-value enum (0xBE / 0xDE) with no
 * spare bits and no third legal value, in eight separate source documents.
 *
 * 24-hour monitoring is real, but it is not a switch and it is not here:
 *
 *   - settings 3151 `internalEpmSwitch` carries "24H consumption" as one
 *     ENUM VALUE among Meter in Grid / Meter in Load / EPM OFF. Its code
 *     differs by model class (04 on 0.7-8K1P, 03 on 3-20K 3P, 04 again on
 *     25-110K), which is exactly why it must be rendered from the register's
 *     own enum table on the EPM screen and never as a boolean anywhere else.
 *   - data 3250 `meterPlacement` reports it BACK as BIT02, "24H Consumption
 *     Monitoring (Only get meter data, no control)" — read-only telemetry.
 *
 * So SolisCloud's placement is a UI error on their side: the setting belongs
 * to the internal EPM mode, one screen over. Rendering a toggle here would
 * have meant writing a made-up value to the inverter's master on/off
 * register, which stops a live machine. Nothing is drawn for it.
 *
 * NIGHT SVG IS THREE THINGS, AND ONLY ONE OF THEM IS REACHABLE
 * ------------------------------------------------------------
 * The setpoint (3030) is readable and writable through the normal PV settings
 * band. The SEASON WINDOW (3343-3346) is not: the store's PV settings band is
 * keyed by `pvSettingsMapper`, whose highest index is 337 — printed 3337 —
 * so nothing above that ever lands in `variables`, whatever the inverter
 * replies. Those rows are declared here with `reachable: false` so the screen
 * can say so plainly rather than drawing four boxes that read "not read"
 * forever and invite an installer to type into them. See `SVG_WINDOW_ROWS`.
 *
 * 3624 is a DATA register, not a setting: "Reactive power can be output at
 * night", 0 or 1. It is the inverter's own answer to whether night SVG is
 * possible, so it is shown as read-only status and never as a control.
 */
import {
  byScopedAddress,
  settingsByAddress,
  wireAddress,
  type GospelRegister,
  type PvScope,
} from '../../gospel/pvGospel'
import { ruleFor, type PvRule } from '../../gospel/pvRules'

/* ------------------------------------------------------------------ *
 * Addresses. PRINTED, always — never wire. See the header.
 * ------------------------------------------------------------------ */

/** Inverter ON/OFF. An ENUM, not a switch: 0xBE (190) ON, 0xDE (222) OFF. */
export const ON_OFF = 3007

/** Restart the HMI. Destructive, and needs its magic value sent three times. */
export const RESTART_HMI = 3028

/** Night SVG Q Set — reactive power to hold after dark, % of rated. */
export const NIGHT_SVG_Q_SET = 3030

/** SVG season window: start month, start day, end month, end day. */
export const SVG_START_MONTH = 3343
export const SVG_START_DAY = 3344
export const SVG_END_MONTH = 3345
export const SVG_END_DAY = 3346

/**
 * DATA-space read-back: can this machine output reactive power at night?
 *
 * Function 0x04, not 0x03. Reported by the inverter, never written.
 */
export const REACTIVE_AT_NIGHT = 3624

/**
 * Highest printed settings address the store can hold a reading for.
 *
 * NOT a document limit and NOT a device limit — a limit of THIS APP's PV
 * settings band, whose key table (`pvSettingsMapper`) stops at index 337.
 * A register above it is read off the wire and then discarded, because
 * `mapRawValues` only files words it has a key for.
 *
 * Read out of the mapper at runtime rather than typed as 3337, so that the
 * day someone extends the key table, the SVG window rows light up on their
 * own instead of waiting for a human to notice this constant.
 */
export function highestReadableSettingsAddress(
  mapper: Record<string, number | number[]>,
): number {
  let max = -Infinity
  for (const index of Object.values(mapper)) {
    const first = Array.isArray(index) ? index[index.length - 1] : index
    if (typeof first === 'number' && first > max) max = first
  }
  // The band bases its indexes on PRINTED 3000; the wire −1 belongs to the
  // band, not to this arithmetic. See `Pv/gospelMapper.ts`.
  return max === -Infinity ? -Infinity : max + 3000
}

/* ------------------------------------------------------------------ *
 * Lookups. Every one names its scope.
 * ------------------------------------------------------------------ */

/** Gospel record for a settings register, or null when the map lost it. */
export function settingReg(address: number): GospelRegister | null {
  return byScopedAddress('settings', address)
}

/** Gospel record for a data register, or null when the map lost it. */
export function dataReg(address: number): GospelRegister | null {
  return byScopedAddress('data', address)
}

/**
 * The rule for a settings register, or undefined when it has none.
 *
 * Undefined is NORMAL and means "write it plainly". Most PV registers have no
 * rule; only the eleven an interface gets wrong do.
 *
 * Looked up at call time, never captured at module load. `pvRules.json` is
 * being extended in parallel with this screen, and a rule that appears for
 * 3007 tomorrow must reach this screen without an edit here.
 */
export function ruleForSetting(address: number): PvRule | undefined {
  return ruleFor('settings', address)
}

/** The address that goes in the Modbus frame for a printed settings address. */
export function settingWireAddress(address: number): number | null {
  return wireAddress(address, 'settings')
}

/* ------------------------------------------------------------------ *
 * The magic values, taken from the map — never typed here.
 * ------------------------------------------------------------------ */

/**
 * The raw value that means ON, read out of 3007's own `value_map`.
 *
 * NOT `0xBE` written into this file. The map is the source: if a revision
 * ever renumbers the enum, the screen follows it, and if the map loses the
 * label the lookup returns null and the row disables itself rather than
 * sending a guess to a register whose whole job is starting and stopping the
 * machine.
 *
 * Matched on the label rather than the number for the same reason: the number
 * is the thing that might change, the meaning is not.
 */
export function onOffValue(which: 'ON' | 'OFF'): number | null {
  const map = settingsByAddress.get(ON_OFF)?.value_map
  if (!map) return null
  const want = which.trim().toLowerCase()
  for (const [raw, label] of Object.entries(map)) {
    if (String(label).trim().toLowerCase() === want) return Number(raw)
  }
  return null
}

/** True when `raw` is the ON code. Null when the map cannot say. */
export function isOn(raw: number | undefined): boolean | null {
  if (raw === undefined) return null
  const on = onOffValue('ON')
  return on === null ? null : raw === on
}

/**
 * The magic value that performs the HMI restart, from the rule.
 *
 * The rule carries it as `unlock_value` (43605 = 0xAA55). Returns null when
 * no rule is loaded, which is what makes the restart row refuse to arm rather
 * than write a number this file invented.
 */
export function restartUnlockValue(): number | null {
  const value = ruleForSetting(RESTART_HMI)?.unlock_value
  return typeof value === 'number' ? value : null
}

/**
 * How many times the restart value must be sent, and inside how long.
 *
 * The document is explicit: "it will take effect if it is successfully sent
 * three times within 6 seconds". Sending it once does nothing at all and
 * reports success, which is the trap — the write ACKs and the HMI stays up.
 *
 * These two ARE literals, and they are the only ones in this file. They are
 * not a register value, a scale or a bit position; they are a handshake
 * protocol stated in prose in the register's own description and in the
 * rule's `write_explain`, and neither the map nor the rules schema has a
 * field to carry them. `restartProtocolMatchesRule` below pins them against
 * that prose so a corrected document breaks a test.
 */
export const RESTART_REPEATS = 3
export const RESTART_WINDOW_MS = 6000

/**
 * Does the rule's prose still describe the handshake encoded above?
 *
 * Exists so the two constants cannot drift away from the document silently.
 * A false here means the rule was reworded or corrected and the repeat count
 * or window needs re-reading by a human — it does NOT mean the screen may
 * guess a new one.
 */
export function restartProtocolMatchesRule(): boolean {
  const rule = ruleForSetting(RESTART_HMI)
  if (!rule) return false
  const prose = `${rule.write_explain ?? ''} ${rule.summary ?? ''}`.toLowerCase()
  const seconds = RESTART_WINDOW_MS / 1000
  return (
    prose.includes('three times') &&
    prose.includes(`${seconds} second`)
  )
}

/* ------------------------------------------------------------------ *
 * The rows.
 * ------------------------------------------------------------------ */

/** A plain settings row the screen draws an editor for. */
export interface PvControlRow {
  /** PRINTED address, settings space. */
  address: number
  label: string
  description: string
  /**
   * False when this app cannot hold a reading for the register.
   *
   * The row is still drawn — hiding it would be a lie about what the inverter
   * has — but it is drawn as unreachable rather than as an empty editor. See
   * the header.
   */
  reachable: boolean
}

/**
 * The on/off row.
 *
 * Alone at the top because it gates everything else on the screen: a night
 * SVG setpoint on a stopped inverter does nothing.
 */
export const POWER_ROW: PvControlRow = {
  address: ON_OFF,
  label: 'Inverter power',
  description:
    'Starts and stops the inverter. An enum, not a switch — the register takes 190 (0xBE) for ON and 222 (0xDE) for OFF, and no other value. Turning it off stops export immediately.',
  reachable: true,
}

/**
 * Night SVG — reactive power after dark.
 *
 * The setpoint and the season window are one feature, so they are one group,
 * even though only the setpoint is reachable through this app today. Splitting
 * them would hide the fact that a setpoint alone may not be the whole story.
 */
export const NIGHT_SVG_ROW: PvControlRow = {
  address: NIGHT_SVG_Q_SET,
  label: 'Night SVG reactive power',
  description:
    'Reactive power the inverter holds after dark, as a percentage of rated. Negative is inductive, positive is capacitive; 0 % means no night reactive output. The machine must also report that it is capable of it — see the status row below.',
  reachable: true,
}

/**
 * The SVG season window.
 *
 * Four registers, one date range: night SVG runs only between the start and
 * end dates. There is no year — it is a seasonal window that repeats.
 *
 * All four used to sit above this app's PV settings band and carried
 * `reachable: false`: the key table stopped at printed 3337, so the
 * inverter's answer for them was received and then discarded. Extending
 * `pvSettingsMapper` from the gospel settings space put all four on the air,
 * so they are ordinary editable rows now.
 */
export const SVG_WINDOW_ROWS: PvControlRow[] = [
  {
    address: SVG_START_MONTH,
    label: 'SVG window start month',
    description: 'Month night SVG starts running. Range 1-12.',
    reachable: true,
  },
  {
    address: SVG_START_DAY,
    label: 'SVG window start day',
    description: 'Day of that month night SVG starts running. Range 1-31.',
    reachable: true,
  },
  {
    address: SVG_END_MONTH,
    label: 'SVG window end month',
    description: 'Month night SVG stops running. Range 1-12.',
    reachable: true,
  },
  {
    address: SVG_END_DAY,
    label: 'SVG window end day',
    description: 'Day of that month night SVG stops running. Range 1-31.',
    reachable: true,
  },
]

/* ------------------------------------------------------------------ *
 * STRAIGHT OUTPUT CONTROL — derating and power factor.
 * ------------------------------------------------------------------ */

/** Active power limit, % of rated. Gated by 3070. */
export const POWER_LIMIT = 3052

/**
 * Active power switch. 0x55 off, 0xAA on.
 *
 * WHICH REGISTERS IT ACTUALLY GATES IS NOT WHAT ITS TEXT SAYS.
 *
 * The map prints 3070's description as "0xAA Enable 3051 and 3080", and its
 * value_map label carries the same pair. Taken as PRINTED addresses that is
 * nonsense on both counts: 3051 is the REACTIVE power limitation, which is
 * gated by 3071 and needs working mode 04, and 3080 is the power control
 * word, a bitfield that saves itself to flash and is not gated by anything.
 * An ACTIVE power switch enabling neither of the two active-power registers
 * sitting next to it is not a rule, it is a misprint.
 *
 * Read as WIRE addresses it is exactly right. PV documents print one higher
 * than the wire -- see the module header -- so wire 3051/3080 are printed
 * 3052/3081: the active power percentage and the absolute active power
 * set-point. An active power switch enabling the active power limit and its
 * set-point is the rule the hardware obviously has.
 *
 * So this file gates PRINTED 3052 and 3081, which is the same reading
 * `pvPowerSettingModel` arrived at independently. The map is not corrected
 * here -- the misprint is in the vendor document and belongs to whoever
 * revises the map -- but it is not repeated to the user either: the row's
 * description below names the registers, not the raw quoted text.
 *
 * The value_map LABEL is a separate problem and is left alone deliberately:
 * the editor renders the map's own enum labels, so the dropdown still reads
 * "ON (Enable 3051 & 3080)". Rewriting enum labels in a screen model is how a
 * screen starts disagreeing with the register table it is supposed to show.
 */
export const ACTIVE_POWER_SWITCH = 3070

/**
 * PF Setting. Selected by WORKING MODE 03 in 3073 -- NOT by the 3071 switch.
 *
 * PV carries two power-factor registers and they are reached completely
 * differently. This one answers to the mode enum. Printed 3054 (`pfSetting02`)
 * is the one 3071's 0xA2 code unlocks and the one 3069 BIT03 saves to flash --
 * V19 states it twice, "0xA2 PF 02 setting effective (for 3054 Reg)" and
 * 3054's own "To enable 3054, need to enable 3071 A2".
 *
 * The generated map's 3071 description still reads "0xA2 Enable 3053 Register"
 * and its 3069 text still assigns BIT03 to 3053; both are the older wording
 * that V19 supersedes. Neither is repeated to the user here.
 *
 * Two consequences worth knowing before writing this register. Writing 3054
 * -- the OTHER one -- switches the inverter into mode 03 by itself, stopping
 * whatever reactive mode was running. And models of 15 kW and below do not
 * carry 3053 at all, so on those machines 3054 is the only power factor there
 * is. Both live on Power Setting, which owns 3054 and the 0xA2 switch.
 */
export const PF_SETTING = 3053

/*
 * 3071, THE REACTIVE POWER SWITCH, IS NOT A CONSTANT HERE ON PURPOSE.
 *
 * It is not drawn on this screen and nothing here is gated by it, so there is
 * no address for this file to own. `pvPowerSettingModel` owns 3071, beside the
 * registers it actually gates.
 *
 * The reasoning is kept because 3071's own text invites a mistake. It reads
 * "0x55 OFF; 0xA1 Enable 3050 and 3082; 0xA2 Enable 3053", and two of those
 * three are wrong as PRINTED addresses:
 *
 *   - 0xA2 enables printed 3054 (`pfSetting02`), not 3053. V19 states it
 *     twice -- "0xA2 PF 02 setting effective (for 3054 Reg)" and, from the
 *     other side, 3054's "To enable 3054, need to enable 3071 A2". The
 *     generated map still carries the older 3053 wording. This matters here
 *     because 3053 IS on this screen: reading the map literally would have
 *     drawn 3071 as its gate, and it is not one.
 *
 *   - 0xA1's "3050 and 3082" are unrelated registers as printed (3082 is a CT
 *     ratio). As WIRE addresses they are printed 3051/3083 -- the reactive
 *     limitation and the reactive set-point, which is the pair a reactive
 *     switch should gate. Same misprint as 3070 carries; see above.
 *
 * So one sentence in that description mixes printed and wire conventions.
 * Never infer which by sniffing the label text.
 */

/**
 * WHY DERATING AND POWER FACTOR BELONG ON THE CONTROL PANEL.
 *
 * Reported from the field: turning output down, and setting a power factor,
 * are NOT work modes. They are straight adjustments — you are trimming a
 * quantity the inverter is already producing, not asking it to follow a curve
 * against grid voltage. Every genuine mode in 3073 answers "how should the
 * machine RESPOND to conditions"; these two answer "what should it produce".
 *
 * They lived on Power Setting, which is a correct home for them in isolation
 * but buried the two controls an installer reaches for most often under ramp
 * rates, FSM and EN50549 tables. Putting them on the Control Panel — beside
 * the on/off switch, which is the other "what should it produce right now"
 * control — is where a commissioning engineer looks first.
 *
 * THE SWITCHES COME WITH THEM, AND THAT IS THE WHOLE POINT.
 * --------------------------------------------------------
 * Both values are GATED. 3052 does nothing until 3070 holds its ON code, and
 * 3053 is selected by working mode 03. A limit written while its gate is shut
 * is ACCEPTED BY THE INVERTER AND IGNORED — no error, no clue. Power Setting
 * deliberately keeps each value next to its switch for exactly this reason,
 * and moving the values here while leaving the switches behind would have
 * recreated the "go and look at the other screen" trap that consolidation was
 * supposed to remove. So the gate travels with the value.
 *
 * These rows are NOT deleted from Power Setting. That screen's subject is the
 * whole gating/persistence story (3069's save bits, both on-codes of 3071),
 * and removing two rows from the middle of it would leave holes in an
 * argument the file spends 200 lines making. Both screens write through the
 * same `usePvRegisterWrite`, against the same printed addresses, so there is
 * no second write path to disagree — this is the same control surfaced where
 * it is wanted, not a copy of it.
 *
 * See `FIXED_PF_HELP` in `pvWorkModeModel.ts` for why work mode 03 is the
 * same PF function reached through a second door.
 */
export const DERATING_ROWS: PvControlRow[] = [
  {
    address: ACTIVE_POWER_SWITCH,
    label: 'Active power switch',
    description:
      'Gate for the power limit below. Until this holds its ON code (0xAA; 0x55 is off), a limit written below is accepted by the inverter and has no effect. It gates the active power limit (3052) and the absolute active power set-point (3081) — the register numbers in the dropdown label are the map’s own, and are wire addresses rather than printed ones.',
    reachable: true,
  },
  {
    address: POWER_LIMIT,
    label: 'Active power limit',
    description:
      'Percentage of rated active power, 0 ~ 110%. Straight derating — the usual export limit. Needs the switch above to be on.',
    reachable: true,
  },
  /*
   * THE REACTIVE SWITCH IS DELIBERATELY NOT DRAWN HERE.
   *
   * It was, for one revision, sitting immediately above the power factor row
   * the way the active switch sits above the power limit. That symmetry was a
   * lie: 3071 does not gate 3053. 3053 answers to working mode 03, and 3071's
   * 0xA2 code unlocks a DIFFERENT power-factor register (3054) which is not on
   * this screen. A switch drawn directly above a value it does not control is
   * worse than no switch at all -- it is the exact "check the wrong thing"
   * failure the gate rows exist to prevent, with the gate itself doing the
   * misleading.
   *
   * 3071 is on Power Setting, beside 3054 and the reactive set-points it
   * really does gate. The row below says so in as many words instead.
   */
  {
    address: PF_SETTING,
    label: 'Power factor',
    description:
      'Signed power factor. The sign carries leading versus lagging, and 1.00 and -1.00 are the same operating point. Selected by WORKING MODE 03 in 3073, NOT by the switch above — the Work Mode screen reaches the same function through that enum. Models of 15 kW and below do not carry this register at all; on those, the power factor is 3054 on Power Setting.',
    reachable: true,
  },
]

/** Every writable settings row, in the order the screen draws them. */
export const PV_CONTROL_ROWS: PvControlRow[] = [
  POWER_ROW,
  ...DERATING_ROWS,
  NIGHT_SVG_ROW,
  ...SVG_WINDOW_ROWS,
]

/**
 * The read-only status row, from the DATA space.
 *
 * Deliberately typed apart from `PvControlRow`: it is read with a different
 * function code, out of a different space, and must never acquire an editor.
 * Giving it the same shape as a control row is how it would eventually get
 * one.
 */
export const STATUS_ROW = {
  address: REACTIVE_AT_NIGHT,
  scope: 'data' as PvScope,
  label: 'Reactive power at night',
  description:
    "The inverter's own answer to whether it can output reactive power after dark. Read-only, and off by default on most units. If this says it cannot, the night SVG setpoint above will do nothing however it is set.",
}

/**
 * The restart action.
 *
 * Not a `PvControlRow`: it has no value to show and no value to type. It is a
 * button that performs a handshake, and it is marked destructive because it
 * drops the display session while it runs.
 */
export const RESTART_ACTION = {
  address: RESTART_HMI,
  label: 'Restart the display',
  description:
    'Reboots the HMI (the display board), not the inverter. Export is not interrupted, but the display session drops and this app will stop getting replies until it comes back. The command must be accepted three times within six seconds or nothing happens.',
  destructive: true as const,
}

/**
 * The `?` text for the missing 24-hour load monitoring switch.
 *
 * Written out in full rather than summarised because the next person to read
 * SolisCloud's on/off page will ask the same question, and the useful answer
 * is not "we could not find it" but "here is where it actually lives".
 */
export const LOAD_MONITORING_HELP = [
  `SolisCloud's on/off page lists a "24-Hour Load Monitoring" switch against register ${ON_OFF}, under "Other Setting". This screen does not draw one, because there is no such switch at ${ON_OFF}.`,
  `In the settings space, ${ON_OFF} is the inverter's master ON/OFF enum: 190 (0xBE) means ON, 222 (0xDE) means OFF, and eight separate source documents agree. It has no spare bits and no third legal value. A "monitoring" toggle written here would send an invented number to the register that starts and stops the machine.`,
  `24-hour monitoring is real, but it is a MODE, not a switch, and it belongs to the internal EPM setting at 3151. There it is one choice among Current Sensor / Meter in Grid / Meter in Load / 24H consumption / EPM OFF — and its code differs by model class, so it can only be set from that register's own enum table, on the EPM screen.`,
  `The inverter reports the mode back in the data space at 3250 "Meter placement", BIT02, "24H Consumption Monitoring (only get meter data, no control)". That is telemetry, not a control.`,
  `So SolisCloud's placement is a UI error on their side. The setting is one screen over, not missing.`,
].join('\n\n')

/**
 * The `?` text for the active power switch.
 *
 * WHY THIS NEEDS SAYING AT ALL
 * ----------------------------
 * The switch is drawn as a gate above the limit it controls, and a gate drawn
 * that way invites one wrong conclusion: that it is normally shut and you have
 * to open it before the limit means anything. In the field the opposite is
 * usually true -- 3070 is already sitting on its ON code, because that is how
 * the machines arrive. The row exists to explain a limit that is doing
 * nothing, not to add a step to every job.
 *
 * Reported from the field. The map states no default for this register --
 * there is no `default` field on it and its `range` is empty -- so the claim
 * is worded as what is USUALLY true rather than as what the register
 * guarantees, and the text says how to settle it for the machine in front of
 * you: read the block and look at the value.
 *
 * THE HONEST ANSWER IS "READ IT"
 * ------------------------------
 * That is the part worth putting on screen. "Almost always on" is a
 * disposition, not a fact about this inverter, and a screen that stated it as
 * a fact would be doing the same thing SolisCloud's Enabled/Disabled rendering
 * does -- reporting a belief as a reading. Once the block has been read the
 * row shows the real code and the guess stops mattering, which is why the help
 * points at the range buttons rather than at a number.
 */
export const ACTIVE_POWER_SWITCH_HELP = [
  `This switch is almost always ALREADY ON. Inverters generally ship with ${ACTIVE_POWER_SWITCH} holding its ON code, so in most cases there is nothing to do here — the row is drawn so that a power limit which appears to do nothing has a visible explanation, not because it is a step you normally have to take first.`,
  `Do not take that on trust for the machine in front of you. The register map states no default for this register, so "almost always" is field experience rather than something the document guarantees. The only way to know is to READ it: press the range button covering ${ACTIVE_POWER_SWITCH} (or ALL) and the row will show the code the inverter actually holds.`,
  `Until it has been read the row shows "not read", which is deliberately different from showing OFF. A register nobody has asked about and a register that is genuinely off are different situations, and only one of them needs your attention.`,
  `When it IS off, the failure is silent. The inverter accepts a write to the power limit, acknowledges it, and ignores it — there is no error to notice. That is the whole reason this switch is shown next to the limit rather than left on another screen.`,
  `Changing it is a normal write: 0xAA (170) is on, 0x55 (85) is off. The dropdown's own label reads "ON (Enable 3051 & 3080)" because that is the wording in the register map; those are wire addresses, and the registers it really enables are the printed ${POWER_LIMIT} below and the absolute set-point at 3081.`,
].join('\n\n')

/**
 * The `?` text for the SVG season window.
 *
 * Explains what the window is and how the two dates relate, now that all four
 * registers are readable and writable.
 */
export const SVG_WINDOW_HELP = [
  `Night SVG runs only between a start date and an end date — a seasonal window that repeats every year, with no year field. The four registers are ${SVG_START_MONTH} and ${SVG_START_DAY} for the start, ${SVG_END_MONTH} and ${SVG_END_DAY} for the end.`,
  `Set all four. A month without its day, or a day without its month, leaves the window half-described and the inverter reads whatever was there before.`,
  `The setpoint above sets HOW MUCH reactive power night SVG provides; this window sets WHEN it is allowed to run at all. Both matter — a setpoint outside the window does nothing.`,
].join('\n\n')

/**
 * Every settings register this screen reads, for the range-button highlight.
 *
 * The unreachable ones are included on purpose: the highlight is about which
 * part of the map the screen concerns itself with, and hiding them would make
 * the range button disagree with the rows on screen.
 */
export function pvControlAddresses(): number[] {
  return Array.from(
    new Set([...PV_CONTROL_ROWS.map((r) => r.address), RESTART_ACTION.address]),
  ).sort((a, b) => a - b)
}
