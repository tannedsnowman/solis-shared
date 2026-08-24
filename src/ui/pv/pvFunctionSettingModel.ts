/**
 * The register maths behind the PV Function Settings screen, with no React in it.
 *
 * 3304 IS A BITFIELD, AND SOLISCLOUD PRINTS IT AS IF IT WERE A VALUE
 * -----------------------------------------------------------------
 * This is the trap the whole file exists for. SolisCloud has separate pages
 * for "N-PE Detection", "Zero Power Control Mode" and "AFCI", and several of
 * their rows print the register number 3304 beside a plain on/off control.
 * They are not separate registers. 3304 is `specialFunctionControlWord` — one
 * 16-bit word holding six unrelated function switches — and SolisCloud is
 * showing individual BITS while labelling every row with the PARENT address.
 *
 * A UI that believes those labels writes 0 or 1 into 3304 and clears the other
 * five switches in the same breath. On a live machine that turns the boost
 * stage off, stops DC injection adjustment, drops the 0% power relay trip and
 * disables L-ground fault detection, and the inverter ACKs all of it without
 * a word. Every 3304 change on this screen is therefore read-modify-write, and
 * the mask claims only the bit the user actually moved.
 *
 * BITS ARE RESOLVED BY LABEL, NEVER BY NUMBER
 * -------------------------------------------
 * Not one bit position is a literal in this file. `bitNamed()` asks
 * `pvRules.json` which bit carries a given label, exactly the way
 * `protectSettingModel.ts` does for the hybrid side. The reason is concrete:
 * 3304's `bit_flags` in the map were HYBRID labels copied onto a PV register
 * ("PV Priority Discharge" on BIT03, "Per-Phase Backflow Control" on BIT06).
 * Neither function exists in any PV document, and BIT03 is really the AFCI
 * self-check trigger. A UI built on those labels wrote AFCI self-check while
 * claiming to change discharge priority. Reading positions out of the rules
 * file means a corrected rules file corrects this screen with no edit here,
 * which is the only way "field correction beats the document" can hold.
 *
 * THREE OF 3304'S SWITCHES ARE ACTIVE-LOW
 * ---------------------------------------
 * BIT00 (boost), BIT01 (DC injection adjustment) and BIT05 (L-ground fault
 * detection) all store the bit SET to mean the function is OFF. Only BIT02
 * (0% power relay trip) reads the ordinary way. As on the hybrid Protect
 * screen, this screen shows the FUNCTION and not the bit, and the inversion
 * happens in exactly two places — `functionOn()` and `wordForFunction()`.
 * Invert a second time in the JSX and the screen will report a protection
 * enabled at the moment it is disabled.
 *
 * WHAT COULD NOT BE RESOLVED, AND IS THEREFORE ABSENT
 * --------------------------------------------------
 * SolisCloud's "N-PE Switch" (3304), "Discon_Relay" (3304), "AFCI Self-Check
 * Switch" (3304) as a persistent checkbox, and "No Wave" (3304) have NO bit in
 * the corrected rules for 3304. The rule enumerates bits 0, 1, 2 and 5 as free
 * switches and 3/4 as the AFCI self-check group; 6-15 are reserved. There is
 * no bit left that any PV document calls N-PE detection or a disconnect relay.
 * Guessing one would write a live machine's boost or ground-fault switch under
 * a label that says something else, so those rows are OMITTED rather than
 * approximated. Same for the AFCI registers SolisCloud lists in the 3441-3448
 * range: none of them exists anywhere in the PV map.
 *
 * The AFCI self-check IS in the word, on the 3/4 group, but the rule is
 * explicit that the documents disagree about its shape and that it is a
 * momentary TRIGGER which shuts the inverter down before testing. It is
 * exposed as a trigger button, never as a checkbox.
 */
import {
  clearBit,
  isSet,
  setBit,
} from '../../settings/index'
import { ruleFor, type PvRule } from '../../gospel/pvRules'
import { first } from './captures'

/* ---------------------------------------------------------------- registers */

/**
 * Special Function Control Word 01 — the bitfield SolisCloud spreads across
 * four of its pages.
 */
export const SPECIAL_FUNCTION = 3304

/** Shading MPPT multi-peak scan enable. A register of its own, not a bit. */
export const MPPT_SCAN_ENABLE = 3180

/**
 * Shading MPPT scan interval, minutes.
 *
 * The map's own description says 3180 and 3181 "need to be set together, with
 * 10 function code" — so this pair is written as one block, not as two
 * independent rows. See `MPPT_SCAN_PAIR`.
 */
export const MPPT_SCAN_INTERVAL = 3181

/** Logic interface (DRM) master switch. Takes a magic code, not 0/1. */
export const DRM_ONOFF = 3027

/** DRM power-limit set-points for DI 1-4, in 0.01% of rated power. */
export const DRM_LIMITS = [3023, 3024, 3025, 3026]

/** Overvoltage active-power control switch. Another bitfield, two bits used. */
export const OVERVOLTAGE_CONTROL = 3118

/** Restart the HMI. Destructive-ish, magic code, function 6 three times. */
export const RESTART_HMI = 3028

/** AFCI master switch. Not a bit of 3304. */
export const AFCI_ONOFF = 3077

/** AFCI sensitivity level. */
export const AFCI_LEVEL = 3079

/** ARC-fault manual reset. Magic code, and only valid after 5 faults in 24h. */
export const ARC_FAULT_RESET = 3087

/** Keep running after an arc fault — the "non-stop flag". */
export const AFCI_NON_STOP = 3246

/* ------------------------------------------------------------------- rules */

/**
 * The bit vocabulary the corrected rules carry, which `PvRule` does not yet
 * declare.
 *
 * `pvRules.ts` was written when the only PV bitfields put their labels inside
 * `bit_groups`. The 2026-08-22 corrections to 3304 and 3312 introduced the
 * hybrid file's `independent_bits` / `independent_bit_labels` / `bit_notes`
 * shape, which is genuinely in the JSON and read by `ownedMask` already.
 *
 * Widened HERE rather than in `pvRules.ts` because that file is shared with
 * three other screens being built alongside this one, and a concurrent edit to
 * a common type is how two agents produce one broken merge. The fields are
 * optional, so this narrows nothing and breaks nothing when `PvRule` catches
 * up — at which point this alias can simply become `PvRule`.
 */
export type PvBitRule = PvRule & {
  independent_bits?: number[]
  independent_bit_labels?: Record<string, string>
  bit_notes?: Record<string, string>
}

/**
 * The rule for a settings register, or a thrown error.
 *
 * PV rules are keyed `space:address` because PV data and settings addresses
 * overlap on 260 registers. There is deliberately no bare-address lookup to
 * reach for by mistake — see the header of `pvRules.ts`.
 */
export function settingRule(address: number): PvBitRule {
  const r = ruleFor('settings', address)
  if (!r) {
    throw new Error(
      `No rule for settings:${address}; the gospel is the source, not this file`,
    )
  }
  return r
}

/** The rule if there is one. Most registers have none, which means "write it plainly". */
export const optionalRule = (address: number): PvBitRule | undefined =>
  ruleFor('settings', address)

/**
 * The bit a named switch sits on, looked up by its rules-file label.
 *
 * Prefix-matched because the labels carry their polarity in the name —
 * "Boost Not Working (0=Boost ON, 1=Boost always working)" — and that suffix
 * is exactly the thing this screen exists to save a human from parsing.
 *
 * Throws rather than returning a default. A missing label means the rules file
 * changed shape underneath us, and the correct response to that is a loud
 * failure at import, not a write to bit 0.
 */
export function bitNamed(address: number, startsWith: string): number {
  const labels = settingRule(address).independent_bit_labels ?? {}
  const found = Object.entries(labels).find(([, l]) => l.startsWith(startsWith))
  if (!found) {
    throw new Error(
      `settings:${address} has no independent bit labelled "${startsWith}..." in the rules file`,
    )
  }
  return Number(found[0])
}

/**
 * The bits of a named `bit_groups` entry, by group name.
 *
 * Used for the AFCI self-check pair, whose two bits are a group rather than
 * free switches. Returns them ascending so "the trigger bit" is a stable
 * choice rather than whatever order the JSON happened to serialise.
 */
export function groupBits(address: number, groupName: string): number[] {
  const group = (settingRule(address).bit_groups ?? []).find(
    (g) => g.name === groupName,
  )
  if (!group || !Array.isArray(group.bits) || group.bits.length === 0) {
    throw new Error(
      `settings:${address} has no bit group "${groupName}" with enumerated bits`,
    )
  }
  return [...group.bits].sort((a, b) => a - b)
}

/* ------------------------------------------------------------------- bits */

/*
 * The four free switches of 3304, by their rules-file label prefix.
 *
 * These constants are the ONLY place a 3304 bit is named. Everything below
 * refers to them, so a corrected rules file moves the whole screen at once.
 */
export const BOOST_BIT = bitNamed(SPECIAL_FUNCTION, 'Boost Not Working')
export const DC_INJECTION_BIT = bitNamed(SPECIAL_FUNCTION, 'DC Injection Adjustment')
export const ZERO_POWER_RELAY_BIT = bitNamed(SPECIAL_FUNCTION, '0% Power Relay Trip')
export const L_GROUND_BIT = bitNamed(SPECIAL_FUNCTION, 'L-Ground Fault Detection')

/**
 * The AFCI self-check trigger bit.
 *
 * The rule gives bits 3 and 4 as an `at_most_one` group because the 2021.5.6
 * document reads them as a two-bit field while V18/V19 describe BIT03 alone as
 * "0 = no self-inspection, 1 = start". The LOW bit of the group is the one
 * both readings agree starts the check, so that is the one we pulse.
 *
 * `first` rather than `[0]`: if the gospel ever stops carrying an
 * "AFCI self-check" group this would otherwise be `undefined`, and
 * `setBit(word, undefined)` would quietly write a corrupt word to 3117 --
 * a bad register write dressed up as a working button. Throwing at module
 * load names the label that went missing instead.
 */
export const AFCI_SELF_CHECK_BIT = first(
  groupBits(SPECIAL_FUNCTION, 'AFCI self-check'),
)

/** The two bits of 3118, likewise by label. */
export const OV_AUTO_LIMIT_BIT = bitLabelledIn(
  OVERVOLTAGE_CONTROL,
  'Overvoltage active power automatic limit',
)
export const VREF_CONTROL_BIT = bitLabelledIn(
  OVERVOLTAGE_CONTROL,
  'Vref control enable',
)

/**
 * A bit label lookup that also searches `bit_groups`.
 *
 * 3304 carries its free switches in `independent_bit_labels`, but 3118 puts
 * its two in a `bit_groups` entry whose `bits` is null — the group enumerates
 * no bits, only labels. `bitNamed` cannot see those, and `isExclusiveGroup`
 * in `pvRules.ts` already refuses to treat a `bits: null` group as a selector,
 * so the labels are free checkboxes and reading them out of the group is
 * correct rather than a workaround.
 */
export function bitLabelledIn(address: number, startsWith: string): number {
  const rule = settingRule(address)
  const sources: Array<Record<string, string>> = [
    rule.independent_bit_labels ?? {},
    ...(rule.bit_groups ?? []).map((g) => g.bit_labels ?? {}),
  ]
  for (const labels of sources) {
    const found = Object.entries(labels).find(([, l]) => l.startsWith(startsWith))
    if (found) return Number(found[0])
  }
  throw new Error(
    `settings:${address} has no bit labelled "${startsWith}..." in the rules file`,
  )
}

/* ---------------------------------------------------------------- switches */

/**
 * One bit-backed switch on this screen.
 *
 * `inverted` is not a display preference. It decides which way a write goes,
 * so it lives beside the bit rather than in the JSX.
 */
export interface FunctionSwitch {
  address: number
  bit: number
  label: string
  /** ACTIVE-LOW: the bit SET means this function is OFF. */
  inverted: boolean
  description: string
}

/**
 * The 3304 switches, drawn together because they share a register.
 *
 * Polarity comes from the rule's own `bit_notes`, which state it per bit. It
 * is repeated here as a boolean because the code has to act on it, but the
 * rule text is what it was read from and the `?` panel quotes it.
 */
export const SPECIAL_FUNCTION_SWITCHES: FunctionSwitch[] = [
  {
    address: SPECIAL_FUNCTION,
    bit: ZERO_POWER_RELAY_BIT,
    label: '0% power relay trip',
    inverted: false,
    description:
      'With this on, the AC relay physically disconnects whenever the active power limit is set to 0%. This is the switch SolisCloud calls "Zero Power Control Mode" / "Discon_Relay". The only switch in this word that reads the ordinary way round.',
  },
  {
    address: SPECIAL_FUNCTION,
    bit: L_GROUND_BIT,
    label: 'L-ground fault detection',
    inverted: true,
    description:
      'Line-to-ground fault detection. Stored active-low, so this row shows the DETECTION: On means the inverter is checking. Only the 2021.5.6 document describes this bit; the V17-V19 descriptions stop before it, so confirm it reads back on your firmware.',
  },
  {
    address: SPECIAL_FUNCTION,
    bit: BOOST_BIT,
    label: 'Boost stage',
    inverted: true,
    description:
      'The DC boost stage. Stored active-low as a "not working" control: the bit SET makes the boost run continuously. This row shows the ordinary behaviour, so On means the boost works normally.',
  },
  {
    address: SPECIAL_FUNCTION,
    bit: DC_INJECTION_BIT,
    label: 'DC injection adjustment',
    inverted: true,
    description:
      'Trims DC injected into the grid. Stored active-low. The document marks turning this off as a TEST setting, not a field adjustment — most grid codes require DC injection to be controlled.',
  },
]

/** The two switches of 3118. Neither is inverted. */
export const OVERVOLTAGE_SWITCHES: FunctionSwitch[] = [
  {
    address: OVERVOLTAGE_CONTROL,
    bit: OV_AUTO_LIMIT_BIT,
    label: 'Overvoltage auto power limit',
    inverted: false,
    description:
      'Automatically limits active power as grid voltage rises. Required by the Italian and Polish PN50549 standards. SolisCloud calls this "OV-Auto-PLmt". Default off.',
  },
  {
    address: OVERVOLTAGE_CONTROL,
    bit: VREF_CONTROL_BIT,
    label: 'Vref control',
    inverted: false,
    description:
      'Enables the reference-voltage control governed by registers 3126-3127. Independent of the switch above; both may be on. Default off.',
  },
]

/** Every bit-backed switch this screen draws. */
export const ALL_SWITCHES: FunctionSwitch[] = [
  ...SPECIAL_FUNCTION_SWITCHES,
  ...OVERVOLTAGE_SWITCHES,
]

/* --------------------------------------------------------------- bit maths */

/**
 * Is this switch ON, as a human means it?
 *
 * For an inverted bit "on" means the FUNCTION is active, which is the bit
 * CLEAR. One of only two places the inversion is allowed to happen.
 */
export function functionOn(word: number, sw: FunctionSwitch): boolean {
  const bit = isSet(word, sw.bit)
  return sw.inverted ? !bit : bit
}

/**
 * The word to write to turn this switch on or off, as a human means it.
 *
 * The other of the two places the inversion happens. Only this switch's bit
 * moves; every other bit is left exactly as it was, and the write path merges
 * the result against a fresh read on top of that.
 */
export function wordForFunction(
  word: number,
  sw: FunctionSwitch,
  on: boolean,
): number {
  const bitShouldBeSet = sw.inverted ? !on : on
  return bitShouldBeSet ? setBit(word, sw.bit) : clearBit(word, sw.bit)
}

/**
 * The word that pulses the AFCI self-check.
 *
 * A momentary trigger, so it only ever SETS the bit — the inverter clears it
 * when the check finishes. Everything else in the word is untouched, which
 * matters more here than anywhere else on the screen: starting a self-check
 * already shuts the inverter down, and doing that while also clearing the
 * boost switch would look like the self-check broke the machine.
 */
export function wordForSelfCheck(word: number): number {
  return setBit(word, AFCI_SELF_CHECK_BIT)
}

/**
 * The bits that differ between the word as read and the word as staged.
 *
 * This is the mask a write on this screen claims, and it is deliberately
 * narrower than every bit the rule describes.
 *
 * `mergeForWrite` protects bits OUTSIDE the mask by taking them from a fresh
 * read. All four 3304 switches sit inside the rule's mask, so claiming the
 * whole mask would mean a page read ten minutes ago writes ten-minute-old
 * values for all four — and re-reading first changes nothing, because the
 * stale word wins inside the mask anyway. Someone else's change to the other
 * three switches would be silently reverted by a fitter toggling one.
 *
 * Claiming only the bits the user actually moved makes the pre-write re-read
 * do the job it looks like it is doing.
 *
 * Returns 0 when nothing was staged, which writes the word back unchanged
 * rather than asserting anything about it.
 */
export function changedMask(read: number, staged: number | undefined): number {
  if (staged === undefined) return 0
  return (read ^ staged) & 0xffff
}

/**
 * Every bit the rule describes, groups included — the widest mask a masked
 * write may ever claim.
 *
 * `ownedMask` in `bitRules.ts` walks `bit_groups[].bits` and
 * `independent_bits`, both of which PV rules carry, so it is reused rather
 * than reimplemented. The screen intersects `changedMask` with this so a bit
 * the rules file does not describe can never be claimed even if a staged word
 * somehow differs there.
 */
export function ownedMaskOf(address: number): number {
  const rule = settingRule(address)
  let mask = 0
  for (const g of rule.bit_groups ?? []) {
    for (const b of g.bits ?? []) mask |= 1 << b
    /*
     * A group may LABEL bits without ENUMERATING them: 3118 carries
     * `bits: null` with two `bit_labels`, which is what stops `pvRules.ts`
     * treating it as a radio group. Taking the mask from `bits` alone would
     * return 0 for that register, and a masked write with an empty mask sends
     * the word back byte-for-byte unchanged — a Save that reports success and
     * does nothing, which is worse than a refusal because nobody investigates
     * it. The label keys are bit numbers, so they are the mask.
     */
    for (const b of Object.keys(g.bit_labels ?? {})) mask |= 1 << Number(b)
  }
  for (const b of rule.independent_bits ?? []) mask |= 1 << b
  for (const b of Object.keys(rule.independent_bit_labels ?? {})) {
    mask |= 1 << Number(b)
  }
  return mask & 0xffff
}

/**
 * The mask a Save on this screen actually claims for a bit word.
 *
 * The intersection of "what the user moved" and "what the rules file lets this
 * screen own". Both halves matter: the first keeps a stale page from reverting
 * switches nobody touched, the second keeps a staged word that somehow differs
 * on a reserved bit from claiming it.
 *
 * Zero is a legitimate answer — it means nothing was staged — and the caller
 * must treat it as "write the word back unchanged", not as an error.
 */
export function writeMaskFor(
  address: number,
  read: number,
  staged: number | undefined,
): number {
  return changedMask(read, staged) & ownedMaskOf(address)
}

/* ------------------------------------------------------------------- prose */

/**
 * The `?` text shown on every 3304 row.
 *
 * Written out rather than summarised because the consequence of believing
 * SolisCloud's row labels is a blind write that clears four function switches
 * at once on a live machine.
 */
export const SPECIAL_FUNCTION_HELP = [
  `Register ${SPECIAL_FUNCTION} is a 16-BIT WORD, not a value. It holds several unrelated function switches at once.`,
  `SolisCloud spreads these bits across its N-PE Detection, Zero Power Control Mode and AFCI pages, and prints "${SPECIAL_FUNCTION}" beside every one of them. That is the PARENT register number, not the thing the row controls.`,
  `Writing a plain 0 or 1 to ${SPECIAL_FUNCTION} would clear every other switch in the word. This screen never does that: it reads the register, changes only the bit you moved, and writes the whole word back.`,
  `Three of these switches are stored ACTIVE-LOW — the bit SET means the function is OFF. This screen shows you the FUNCTION, so "On" always means the function is working, whichever way the underlying bit sits. The raw word is printed on each row so you can check it against SolisCloud or a Modbus capture.`,
  `Bit positions are read from the rules file at runtime, never written into the app. The map previously carried HYBRID labels on this register ("PV Priority Discharge", "Per-Phase Backflow Control") which belong to no PV function at all.`,
].join('\n\n')

/**
 * The `?` for the rows SolisCloud offers and this screen refuses to.
 *
 * Surfaced in the UI rather than buried in a comment, because a fitter who
 * came here looking for N-PE Detection needs to be told it is missing on
 * purpose and why, not left to assume the screen is unfinished.
 */
export const UNRESOLVED_HELP = [
  `SolisCloud shows several more rows against ${SPECIAL_FUNCTION}: "N-PE Switch", "Discon_Relay", "No Wave" and an "AFCI Test" switch.`,
  `None of them can be resolved to a bit. The corrected rules for ${SPECIAL_FUNCTION} describe bits 0, 1, 2 and 5 as free switches and bits 3-4 as the AFCI self-check group; bits 6-15 are reserved and no PV document assigns them a function.`,
  `Rather than guess, those rows are left out. A wrong bit write here would move the boost stage, DC injection adjustment or ground-fault detection on a live inverter under a label claiming to do something else — and the inverter would acknowledge it without complaint.`,
  `SolisCloud's "Discon_Relay" is almost certainly the 0% power relay trip, which IS on this screen under that name. It is offered as that bit, with the document's own wording, rather than as a second row of unknown provenance.`,
  `The AFCI registers SolisCloud lists in the 3441-3448 range — adaptive sensitivity, CFA shutdown counts and the rest — do not exist anywhere in the PV map. They are not omitted from this screen so much as absent from the machine as documented.`,
].join('\n\n')

/** The `?` for the DRM row. The rule's own gotcha, which is a real one. */
export const DRM_HELP = [
  `Turning the logic interface (DRM) on AUTOMATICALLY TURNS THE EPM FUNCTION OFF. The inverter does it silently — nothing in the Modbus reply mentions it.`,
  `If this site relies on export limiting, that limiting stops the moment DRM goes on, and nothing will tell you.`,
  `${DRM_ONOFF} also takes MAGIC CODES rather than 0 and 1: 0x00AA (170) is on and 0x0000 is off. Writing 1 is accepted and does nothing at all.`,
  `The four DI limits (${DRM_LIMITS.join(', ')}) are the power ceilings the logic-interface inputs select between, in 0.01% of rated power, so 10000 is 100%.`,
].join('\n\n')

/** The `?` for the MPPT scan pair, whose two registers must go together. */
export const MPPT_SCAN_HELP = [
  `Multi-peak (shading) MPPT scanning sweeps the whole string voltage looking for a second power peak, which is what partial shade creates.`,
  `${MPPT_SCAN_ENABLE} and ${MPPT_SCAN_INTERVAL} must be SET TOGETHER using function code 0x10, per the map's own note on both registers. Writing them one at a time is what the note exists to warn against.`,
  `The interval is in minutes, default 30, adjustable 10-180. A short interval costs generation: the inverter stops tracking while it sweeps.`,
].join('\n\n')

/** The `?` for the AFCI section. */
export const AFCI_HELP = [
  `AFCI (arc fault circuit interrupter) detects the electrical signature of a DC arc and shuts the inverter down.`,
  `The master switch is ${AFCI_ONOFF} and the sensitivity level is ${AFCI_LEVEL} — both registers of their own, NOT bits of ${SPECIAL_FUNCTION}.`,
  `The only part of AFCI that does live in ${SPECIAL_FUNCTION} is the SELF-CHECK, and it is a momentary trigger rather than a setting: starting it shuts the inverter down, runs the test and reports a result. That is why it is a button here and not a checkbox.`,
  `${ARC_FAULT_RESET} clears a latched arc fault, and only works once there have been more than five arc faults in 24 hours. Below that threshold the write is accepted and does nothing.`,
  `${AFCI_NON_STOP} keeps the inverter running after an arc fault by stopping the ARM board passing the fault to the DSP. That defeats the point of AFCI and should not be left on at a live site.`,
].join('\n\n')

/* -------------------------------------------------------------- value rows */

/** A plain numeric or enum row this screen draws. */
export interface ValueRow {
  address: number
  label: string
  description: string
}

/** The four DRM DI power limits. Labels come from the map; prose from here. */
export const DRM_LIMIT_ROWS: ValueRow[] = DRM_LIMITS.map((address, i) => ({
  address,
  label: `P_Limit DI ${i + 1}`,
  description: `Power ceiling the logic interface applies when digital input ${i + 1} is asserted. Scaled 0.01%, so 10000 means 100% of rated power.`,
}))

/* ----------------------------------------------------------- loose rows */

/**
 * The rows this screen draws that are neither bit switches nor DRM limits.
 *
 * Every one of these was already rendered — MPPT scanning, the DRM master
 * switch, the AFCI block, the display restart — but each was written straight
 * into the JSX with its label typed at the call site, so there was nothing to
 * import. Collected here for the same reason `DRM_LIMIT_ROWS` is a model
 * export rather than screen JSX: the rail's search index has to be able to
 * find "mppt scan" and "arc fault reset" without a hand-kept copy of the
 * screen's wording going stale beside it.
 *
 * `ARC_FAULT_RESET` and the self-check are commands rather than settings, but
 * they are listed all the same: someone searching "arc fault" wants to be
 * told which screen holds it, and the distinction between a button and a
 * checkbox is the screen's job to draw, not search's job to hide.
 */
export const FUNCTION_VALUE_ROWS: ValueRow[] = [
  {
    address: MPPT_SCAN_ENABLE,
    label: 'MPPT scan enable',
    description: 'Whether the inverter periodically sweeps for the global maximum power point.',
  },
  {
    address: MPPT_SCAN_INTERVAL,
    label: 'MPPT scan interval',
    description: 'How long between sweeps.',
  },
  {
    address: DRM_ONOFF,
    label: 'DRM (logic interface) switch',
    description: `Master enable for the demand-response logic interface. The four ceilings it applies are ${DRM_LIMITS.join(', ')}.`,
  },
  ...DRM_LIMIT_ROWS,
  {
    address: AFCI_ONOFF,
    label: 'AFCI (arc fault) protection',
    description: `Master arc-fault switch. A register of its own, NOT a bit of ${SPECIAL_FUNCTION}.`,
  },
  {
    address: AFCI_LEVEL,
    label: 'AFCI sensitivity level',
    description: 'Only does anything while AFCI above is on.',
  },
  {
    address: AFCI_NON_STOP,
    label: 'AFCI non-stop',
    description:
      'Keeps the inverter running after an arc fault by stopping the ARM board passing it to the DSP. Defeats the point of AFCI at a live site.',
  },
  {
    address: ARC_FAULT_RESET,
    label: 'Arc fault reset',
    description:
      'Clears a latched arc fault. Only works after more than five arc faults in 24 hours; below that the write is accepted and does nothing.',
  },
  {
    address: RESTART_HMI,
    label: 'Restart the display',
    description:
      'Reboots the HMI, not the inverter. Export is uninterrupted but the display session drops.',
  },
]

/**
 * Every register this screen reads.
 *
 * Derived from the same row and switch arrays the screen renders, so a row
 * added or removed moves this with it. `PvFunctionSetting.tsx` keeps its own
 * `ADDRESSES` export for its screen test; this is the copy the rail's index
 * reads, because a model may be imported from the rail and a `.tsx` screen
 * may not — importing a screen there creates a cycle through the settings tab
 * that leaves the index undefined at module init and renders the page blank.
 */
export const ADDRESSES: number[] = Array.from(
  new Set([
    ...ALL_SWITCHES.map((s) => s.address),
    ...FUNCTION_VALUE_ROWS.map((r) => r.address),
  ]),
).sort((a, b) => a - b)
