/**
 * The register maths behind the PV Protection screen, with no React in it.
 *
 * WHY THIS SCREEN IS DANGEROUS
 * ----------------------------
 * FIVE of the seven switches in 3312 are ACTIVE-LOW: the bit SET means the
 * protection is DISABLED. The register's own description in the gospel says it
 * in as many words, and the rules file repeats it bit by bit —
 *
 *   BIT02 Relay protection                 0 = enable, 1 = NOT enabled
 *   BIT03 Leakage current protection       0 = enable, 1 = NOT enabled
 *   BIT04 Grounding protection             0 = enable, 1 = NOT enabled
 *   BIT05 Grid Disturbance 02              0 = enabled, 1 = closed. DEFAULT 1.
 *   BIT06 Grid current sampling AD (IgADCheckPro)   0 = enable, 1 = disable
 *
 * — while BIT00 (constant-voltage MPPT) and BIT01 (multi-channel MPPT
 * parallel) in the SAME word are the ordinary way round, 1 = enabled. The
 * inversion is per-bit, not per-register, and no blanket rule will do.
 *
 * SolisCloud prints the raw bit. A fitter reading "1" on their screen against
 * "Leakage current protection" believes the protection is ON at the moment it
 * is off. This screen shows the PROTECTION, not the bit. `protectionOn()` and
 * `wordForProtection()` are the ONLY two places the inversion happens. Invert
 * a second time up in the JSX and the screen will cheerfully report "Enabled"
 * while earth-leakage protection is disabled on a live machine.
 *
 * BIT05 DEFAULTS TO DISABLED, WHICH NOTHING ELSE IN THE WORD DOES
 * ---------------------------------------------------------------
 * Every other protection bit here defaults to 0 — enabled. Grid Disturbance 02
 * defaults to 1, so out of the box that protection is OFF. A screen that only
 * says "Disabled" without saying that is technically right and practically
 * misleading, so the row carries it.
 *
 * BIT06 IS THE LEAST TRUSTWORTHY BIT IN THE WORD
 * ----------------------------------------------
 * The rules file records that the same bit has a second, firmware-dependent
 * reading — "grid current DC component protection enable" with the OPPOSITE
 * sense — and says not to expose it without reading it back. It is therefore
 * declared inverted (which is what the primary description and the label both
 * say) and drawn with that warning in its own row, rather than quietly
 * omitted: a fitter who finds it in SolisCloud and not here will assume the
 * app cannot see it.
 *
 * NOT ONE BIT POSITION IS A LITERAL HERE
 * --------------------------------------
 * `bitNamed()` resolves every bit by its LABEL out of `pvRules.json`. The PV
 * map's `bit_flags` for 3312 WAS wrong until 2026-08-22 — it carried a run of
 * four hybrid labels ("Overload Protection Enhanced", "Reserved" x3) against a
 * seven-bit word, and the rules file now records that any UI built on those
 * labels put the protections on the wrong bits. That is not a hypothetical
 * failure mode; it already happened. So a corrected rules file must be able to
 * move a switch without an edit here, carrying its active-low handling with
 * it. Counting positions would leave the inversion attached to whatever bit
 * ended up in that slot.
 *
 * A missing rule or a missing label THROWS, naming the register. There is no
 * safe guess about which bit disables leakage protection.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * - GRID CODE THRESHOLDS. OV-G-V, UN-G-F, the 59/27/81 stages and the
 *   ride-through curves belong to the Grid Code screen. This one is the
 *   machine protecting itself.
 * - 3315 `specialControlWord03` (NoSmallPulse, IgFollow, PV midpoint
 *   grounding). Its two protections are documented NOT inverted — "0 =
 *   protection is not enabled, 1 = protection is enabled" — which makes it a
 *   perfect illustration that polarity belongs to the bit and not to the
 *   device. It is left off anyway because it has no rule in `pvRules.json`,
 *   and its `bit_flags` in the map is malformed: the array interleaves labels
 *   with polarity prose, so BIT01 resolves to the STRING "0=narrow pulse
 *   control enabled, 1=not enabled" instead of to IgFollow. Resolving a
 *   protection switch off that array would land the toggle one bit out. When
 *   3315 gets a rule with proper `independent_bit_labels`, add it here as a
 *   third block with `inverted: false` — the machinery below already supports
 *   a non-inverted protection.
 */
import { clearBit, isSet, setBit } from '../../settings/index'
import { ruleFor, type PvRule } from '../../gospel/pvRules'
import { settingsByAddress } from '../../gospel/pvGospel'
import { first, group } from './captures'

/** Everything on this screen is in the SETTINGS space (0x03/0x06/0x10). */
export const SCOPE = 'settings' as const

/** Special control word 02 — the protection bit word. */
export const SPECIAL_CONTROL_02 = 3312

/** Leakage current protection trip level, mA. The level for the BIT03 switch. */
export const LEAKAGE_LIMIT = 3084

/** PV insulation impedance protection threshold, kOhm. The level for BIT04. */
export const INSULATION_LIMIT = 3085

/** Grid Filter NO., 0-7. Shapes what the grid measurements — and so the
 *  disturbance checks — actually see. */
export const GRID_FILTER = 3314

/** AFCI (arc fault) master switch. A register of its own, not a bit of 3312. */
export const AFCI_ONOFF = 3077

/** AFCI sensitivity level, 0-7. */
export const AFCI_LEVEL = 3079

const WORD = 0xffff

/**
 * The rule for a register in the settings space, or a loud failure.
 *
 * PV rules are keyed `"settings:3312"`, never a bare address: 260 PV printed
 * addresses name a different register under 0x03 than under 0x04 — 3312 is
 * `specialControlWord02` in settings and PV12 CURRENT in data — so a
 * bare-address lookup is how a protection switch gets confused with a string
 * current. See `pvRules.ts`.
 */
export function rule(address: number): PvRule {
  const r = ruleFor(SCOPE, address)
  if (!r) {
    throw new Error(
      `No rule for PV settings register ${address}; the gospel is the source. ` +
        `Add "settings:${address}" to pvRules.json rather than hard-coding its bits here.`,
    )
  }
  return r
}

/** True when the rules file describes this register at all. */
export const hasRule = (address: number): boolean =>
  ruleFor(SCOPE, address) !== undefined

/**
 * Every labelled bit of a rule, flattened: bit number -> label.
 *
 * Reads BOTH shapes the rules files use, because the two families settled on
 * different ones and this screen must not care which arrives:
 *
 *   - `independent_bit_labels` — how 3312 is written, a flat map of seven
 *     unrelated switches sharing a word.
 *   - `bit_groups[].bit_labels` — how the older PV rules (3033, 3069, 3118)
 *     are written, labels nested inside a group.
 *
 * A rule that grew a group later, or lost one, keeps working. Neither shape is
 * privileged; a bit labelled in both would be a rules-file bug, and the group
 * form is read second so it would be visible rather than silently shadowed.
 */
export function labelledBits(r: PvRule): Record<number, string> {
  const out: Record<number, string> = {}
  for (const [bit, label] of Object.entries(r.independent_bit_labels ?? {})) {
    out[Number(bit)] = String(label)
  }
  for (const g of r.bit_groups ?? []) {
    for (const [bit, label] of Object.entries(g.bit_labels ?? {})) {
      out[Number(bit)] = String(label)
    }
  }
  return out
}

/**
 * The bit a named switch sits on, looked up by its rules-file label rather
 * than counted.
 *
 * Asking by label is what makes the inversion below survive a renumbering: if
 * 'Relay Protection' ever moves, the lookup moves with it and the active-low
 * handling stays attached to the right bit. Matched on a case-insensitive
 * prefix because the labels carry the polarity in the name — "Relay Protection
 * (0=Enable, 1=Disable)" — and that suffix is exactly the thing this screen
 * exists to stop a human having to parse.
 *
 * A prefix that matches more than one bit is an ERROR, not a first-wins. Two
 * bits whose labels both begin "Grid" is precisely the case where quietly
 * taking the lower one puts the inversion on the wrong protection.
 */
export function bitNamed(address: number, startsWith: string): number {
  const labels = labelledBits(rule(address))
  const needle = startsWith.toLowerCase()
  const hits = Object.entries(labels).filter(([, l]) =>
    l.toLowerCase().startsWith(needle),
  )
  if (hits.length === 0) {
    throw new Error(
      `PV settings register ${address} has no bit labelled "${startsWith}..." in pvRules.json ` +
        `(labels present: ${Object.values(labels).join(' | ') || 'none'})`,
    )
  }
  if (hits.length > 1) {
    throw new Error(
      `"${startsWith}" matches ${hits.length} bits of PV settings register ${address} ` +
        `(${hits.map(([b, l]) => `BIT${b} ${l}`).join(', ')}); the prefix must name exactly one`,
    )
  }
  return Number(first(hits)[0])
}

/**
 * One switch on this screen.
 *
 * `inverted` is the whole point of the file. It is not a display preference —
 * it decides which way a write goes, so it lives beside the bit rather than in
 * the JSX. `evidence` is the sentence from the map that justifies it, kept
 * next to the flag so nobody has to take the flag on trust.
 */
export interface PvProtectSwitch {
  address: number
  bit: number
  label: string
  /** ACTIVE-LOW: the bit SET means this protection is OFF. */
  inverted: boolean
  description: string
  /** The map's own words about this bit's polarity. */
  evidence: string
  /** Set where the bit needs a caveat louder than its description. */
  caution?: string
}

/**
 * Is this switch ON, as a human means it?
 *
 * For an inverted bit "on" means the protection is ACTIVE, which is the bit
 * CLEAR. This is one of only two places the inversion is allowed to happen.
 */
export function protectionOn(word: number, sw: PvProtectSwitch): boolean {
  const bit = isSet(word, sw.bit)
  return sw.inverted ? !bit : bit
}

/**
 * The word to write to turn this switch on or off, as a human means it.
 *
 * The other of the two places the inversion happens. Only this switch's bit
 * moves; every other bit in the word is left exactly as it was, and the write
 * path merges it against a fresh read on top of that.
 */
export function wordForProtection(
  word: number,
  sw: PvProtectSwitch,
  on: boolean,
): number {
  const bitShouldBeSet = sw.inverted ? !on : on
  return bitShouldBeSet ? setBit(word, sw.bit) : clearBit(word, sw.bit)
}

/**
 * Plain-language state for a switch. The only string the view prints as the
 * state of a protection — the raw word is shown separately and labelled raw.
 */
export const stateText = (
  word: number | undefined,
  sw: PvProtectSwitch,
): string =>
  word === undefined ? 'not read' : protectionOn(word, sw) ? 'Enabled' : 'Disabled'

/**
 * The bits that differ between the word as read and the word as staged.
 *
 * This is the mask a write on THIS screen should claim, and it is narrower
 * than "every bit the rule names" on purpose.
 *
 * A read-modify-write merge protects the bits OUTSIDE the mask by taking them
 * from a fresh read. All seven switches sit inside 3312's rule mask, so
 * claiming the whole mask means a page read ten minutes ago writes
 * ten-minute-old values for all seven — and re-reading first changes nothing,
 * because the stale word wins inside the mask anyway. Another engineer's
 * change to any of the other six would be silently reverted by someone
 * toggling one.
 *
 * Claiming only the bits the user actually moved makes the re-read do the job
 * it looks like it is doing: every switch nobody touched comes from the device
 * as it is right now. Returns 0 when nothing was staged, which correctly
 * writes the word back unchanged rather than asserting anything about it.
 */
export function changedMask(read: number, staged: number | undefined): number {
  if (staged === undefined) return 0
  return (read ^ staged) & WORD
}

/**
 * Every bit the rule enumerates — the outer bound on what a masked write may
 * claim.
 *
 * Takes `independent_bits`, every group's `bits`, and every LABELLED bit.
 * PV bit groups may carry `bits: null` where the map does not enumerate them
 * (see `isExclusiveGroup` in pvRules); when nothing is enumerated the labels
 * ARE the enumeration, because a labelled bit is a bit the rules file
 * describes. Reserved bits are outside the mask and survive a write untouched,
 * which is the whole point of `write: "read_modify_write"`.
 */
export function ownedMaskOf(address: number): number {
  const r = rule(address)
  let mask = 0
  for (const b of r.independent_bits ?? []) mask |= 1 << b
  for (const g of r.bit_groups ?? []) {
    for (const b of g.bits ?? []) mask |= 1 << b
  }
  for (const b of Object.keys(labelledBits(r))) mask |= 1 << Number(b)
  return mask & WORD
}

/** True when the rules file says this register needs a read-modify-write. */
export const isReadModifyWrite = (address: number): boolean =>
  ruleFor(SCOPE, address)?.write === 'read_modify_write'

/*
 * ------------------------------------------------------------------
 * The switches.
 * ------------------------------------------------------------------
 *
 * Built LAZILY, by function rather than as module constants.
 *
 * The rules file is data another process corrects — it gained 3312 while this
 * screen was being written. A module-level `bitNamed()` call would make an
 * absent or renamed label a hard IMPORT failure that takes the whole SETTINGS
 * tab down rather than one screen. `protectionSwitches()` is called from the
 * view inside a try, so a missing rule shows as a named error on this panel —
 * which is also the only honest thing to show, because the alternative is a
 * toggle whose direction nobody can vouch for.
 */

/**
 * The five ACTIVE-LOW protections of 3312, in bit order.
 *
 * Grouped and drawn together because they share one rule: every one of them is
 * stored backwards. A reader who learns that once at the top of the list does
 * not have to re-check it five times.
 */
export function protectionSwitches(): PvProtectSwitch[] {
  return [
    {
      address: SPECIAL_CONTROL_02,
      bit: bitNamed(SPECIAL_CONTROL_02, 'Relay Protection'),
      label: 'Relay protection',
      inverted: true,
      description:
        'Checks the grid relay can open and close before connecting. Turning it off is a factory diagnostic, not a fix for a relay fault.',
      evidence:
        'BIT02: Relay protection function settings — 0 = protection enable, 1 = protection is not enabled. Default 0.',
    },
    {
      address: SPECIAL_CONTROL_02,
      bit: bitNamed(SPECIAL_CONTROL_02, 'Leakage Current Protection'),
      label: 'Leakage current protection (I-leak)',
      inverted: true,
      description: `Trips on residual current to earth. The trip level is a separate register, ${LEAKAGE_LIMIT}, which stays set and keeps showing a healthy number while this is off.`,
      evidence:
        'BIT03: Leakage current protection function setting — 0 = protection enable, 1 = protection is not enabled. Default 0.',
    },
    {
      address: SPECIAL_CONTROL_02,
      bit: bitNamed(SPECIAL_CONTROL_02, 'Grounding Protection'),
      label: 'Grounding protection (PV-G)',
      inverted: true,
      description: `Earth-fault detection on the array. The PV insulation impedance threshold that goes with it is a separate register, ${INSULATION_LIMIT}, which stays set and keeps showing a healthy number while this is off.`,
      evidence:
        'BIT04: Grounding protection function setting — 0 = protection enable, 1 = protection is not enabled. Default 0.',
    },
    {
      address: SPECIAL_CONTROL_02,
      bit: bitNamed(SPECIAL_CONTROL_02, 'Grid Disturbance 02'),
      label: 'Grid disturbance protection 02',
      inverted: true,
      description:
        'Wave-by-wave current limiting against a distorted grid.',
      evidence:
        'BIT05: Grid Disturbance 02 setting — 0 = grid disturbance protection enabled (wave-by-wave current limiting enable); 1 = the grid disturbance protection is closed. Default 1.',
      caution:
        'This bit DEFAULTS TO 1, unlike every other protection in the word. Out of the box this protection is OFF, so "Disabled" here is the factory state and not necessarily something anyone did.',
    },
    {
      address: SPECIAL_CONTROL_02,
      bit: bitNamed(SPECIAL_CONTROL_02, 'Grid Current Sampling AD'),
      label: 'Grid current sampling AD protection (IgADCheckPro)',
      inverted: true,
      description:
        'Catches an anomaly in the grid-current measurement chain itself — the inverter checking its own sensing before it trusts it.',
      evidence:
        'BIT06: Grid Current Sampling AD Anomaly Protection (IgADCheckPro) — 0 = enable, 1 = disable.',
      caution:
        'The rules file records a SECOND, firmware-dependent reading of this same bit — "grid current DC component protection enable" with the OPPOSITE sense — and calls it the least trustworthy bit in the word. Read it back after any change and confirm against the inverter before relying on it.',
    },
  ]
}

/**
 * The switches of 3312 that are NOT protections and NOT inverted.
 *
 * Drawn apart from the block above so the active-low rule is not generalised
 * onto them. These are MPPT and wiring facts, 1 = enabled, ordinary way round.
 */
export function functionSwitches(): PvProtectSwitch[] {
  return [
    {
      address: SPECIAL_CONTROL_02,
      bit: bitNamed(SPECIAL_CONTROL_02, 'Constant Voltage MPPT'),
      label: 'Constant-voltage MPPT mode',
      inverted: false,
      description:
        'Pins the MPPT to a fixed voltage taken from register 3313 instead of tracking it. A commissioning tool, not a protection — and it needs 3313 set alongside it.',
      evidence:
        'BIT00: constant voltage Mppt mode enable control bit — 0 = disable, 1 = enable. Default 0. NOT inverted.',
    },
    {
      address: SPECIAL_CONTROL_02,
      bit: bitNamed(SPECIAL_CONTROL_02, 'Multi-channel MPPT Parallel'),
      label: 'Multi-channel MPPT parallel',
      inverted: false,
      description:
        'On = the MPPT inputs are paralleled onto one array. Off = each tracks its own. A wiring fact — set it to match how the strings are actually landed.',
      evidence:
        'BIT01: Multi-channel Mppt parallel enable control bit — 0 = Mppt runs independently for each channel, 1 = Mppt runs in parallel. Default 0. NOT inverted.',
    },
  ]
}

/** Every switch this screen owns, in the order it draws them. */
export function allSwitches(): PvProtectSwitch[] {
  return [...protectionSwitches(), ...functionSwitches()]
}

/**
 * A numeric or enum row.
 *
 * `armedBy` is what lets the view print each level directly under its switch
 * rather than in a block of numbers at the bottom, so it is obvious the number
 * does nothing while the switch above it is off — which is exactly the trap
 * the rules file names as this pair's `gotcha`.
 */
export interface PvLevelRow {
  address: number
  label: string
  description: string
  /** Label of the switch that has to be on for this number to matter. */
  armedBy?: string
}

export const LEVEL_ROWS: PvLevelRow[] = [
  {
    address: LEAKAGE_LIMIT,
    label: 'Leakage current trip level',
    description:
      'Range 50-800 mA, default 240 mA. Raising it makes the inverter tolerate more residual current before it trips.',
    armedBy: 'Leakage current protection (I-leak)',
  },
  {
    address: INSULATION_LIMIT,
    label: 'PV insulation impedance threshold (PV ISO)',
    description:
      'Range 20-1000 kOhm, default 200 kOhm. Below this the inverter refuses to start. LOWERING it makes the inverter accept a worse-insulated array — that is a way of ignoring an insulation fault, not a way of fixing one.',
    armedBy: 'Grounding protection (PV-G)',
  },
]

/**
 * The plain registers this screen also carries, drawn after the bit word.
 *
 * The grid filter is here rather than on a tuning screen because it decides
 * what the disturbance protections above actually see. AFCI is here because a
 * fitter looking for "every protection" will look for arc fault, and it is NOT
 * a bit of 3312 however many cloud pages list it there.
 */
export const PLAIN_ROWS: PvLevelRow[] = [
  {
    address: GRID_FILTER,
    label: 'Grid filter NO.',
    description:
      'Range 0-7. No document says what any individual index does, so the app offers the number and invents no names for the eight positions. Write down the value before changing it — there is nothing to look up to get back.',
  },
  {
    address: AFCI_ONOFF,
    label: 'AFCI (arc fault) protection',
    description: `Master arc-fault switch, and NOT inverted — 1 is on, the ordinary way round. It is a register of its own, not a bit of ${SPECIAL_CONTROL_02}. On a new AFCI detection board it instead enables the per-branch switches in 3247; query 3149 first to know which board is fitted.`,
  },
  {
    address: AFCI_LEVEL,
    label: 'AFCI sensitivity level',
    description:
      'Range 0-7, default 0. Only does anything while AFCI above is on.',
  },
]

/** Every address this screen reads, for the range-button row's highlight. */
export const ADDRESSES: number[] = [
  SPECIAL_CONTROL_02,
  ...LEVEL_ROWS.map((r) => r.address),
  ...PLAIN_ROWS.map((r) => r.address),
].sort((a, b) => a - b)

/** The gospel record for a settings-space address, or undefined. */
export const registerAt = (address: number) => settingsByAddress.get(address)

/**
 * The `?` text shown on every inverted row.
 *
 * Written out rather than summarised because the consequence of getting it
 * backwards is a machine running with its earth-leakage protection off while
 * the screen that turned it off said "Enabled".
 */
export const ACTIVE_LOW_HELP = [
  `This switch is stored ACTIVE-LOW in register ${SPECIAL_CONTROL_02}.`,
  `In the register, the bit SET (1) means the protection is DISABLED, and the bit CLEAR (0) means it is ENABLED. That is backwards from every other switch in the app.`,
  `This screen shows you the PROTECTION, not the bit. "Enabled" here always means the protection is active and the machine is protected, whichever way the underlying bit happens to sit.`,
  `SolisCloud shows the RAW BIT instead, labelled Enable/Disable against the bit value. Reading the two screens side by side, they will look like they disagree. They do not — this one has done the inversion for you.`,
  `The raw word is printed on each row as "raw ${SPECIAL_CONTROL_02} = 0x....", spelled out as raw so it cannot be mistaken for the state, and you can still check it against SolisCloud or against a Modbus capture.`,
  `Not every switch in this word is backwards. The two MPPT switches below — constant-voltage MPPT and multi-channel MPPT parallel — sit in the SAME register and are stored the ordinary way round, 1 = enabled. Polarity is a property of the individual bit, not of the register and not of the inverter.`,
].join('\n\n')

/** The `?` text for the two MPPT rows, whose polarity is normal. */
export const NORMAL_POLARITY_HELP = [
  `This switch is in ${SPECIAL_CONTROL_02} alongside the protections above, but it is NOT inverted.`,
  `The map states it plainly: 0 = disabled, 1 = enabled. The ordinary way round.`,
  `It is drawn apart from the active-low block for exactly that reason. Do not carry the inversion across — the same word holds bits of both polarities.`,
].join('\n\n')
