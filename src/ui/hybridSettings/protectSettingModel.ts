/**
 * The register maths behind the Protect Setting screen, with no React in it.
 *
 * WHY THIS SCREEN IS DANGEROUS
 * ----------------------------
 * Five of the eight switches in 43249 are ACTIVE-LOW: the bit SET means the
 * protection is DISABLED. Relay, I-leak, PV Iso, Grid Interference and Grid
 * Interference 02 all work that way; MPPT Parallel, IgFollow and DC Component
 * do not. SolisCloud's own Protect Setting page prints the raw bits, so a
 * fitter reading "1" there believes a protection is ON at the moment it is off.
 *
 * This screen shows the PROTECTION, not the bit. `protectionOn()` and
 * `wordForProtection()` are the only two places the inversion happens. Invert
 * a second time up in the UI and the screen will cheerfully report "Enabled"
 * while leakage-current protection is disabled on a live machine.
 *
 * As with Storage Mode, not one bit position is a literal here. `bitRules.ts`
 * reads them out of `hybridRules.json`, so a corrected rules file changes this
 * screen without an edit — which is the only way "field correction wins over
 * the document" can actually hold.
 */
import {
  clearBit,
  isSet,
  ownedMask,
  RegisterRule,
  setBit,
} from '../../settings/bitRules'
import { ruleFor } from '../settings/GospelRows'

/** Special Settings — the protection bit word. */
export const SPECIAL_SETTINGS = 43249

/** Leakage current protection trip level, mA. The level for BIT03. */
export const ILEAK_LIM = 43245

/** PV isolation protection threshold, kOhm. The level for BIT04. */
export const RISO_LIM = 43246

/** AFCI (arc fault) master switch. A register of its own, not a bit of 43249. */
export const AFCI_ONOFF = 43076

/** AFCI per-string detection enables, BIT00..BIT09 = PV1..PV10. */
export const AFCI_DETECTION = 43624

const rule = (address: number): RegisterRule => {
  const r = ruleFor(address)
  if (!r) throw new Error(`No rule for register ${address}; the gospel is the source`)
  return r
}

/**
 * The bit a named switch sits on, looked up by its rules-file label rather
 * than counted.
 *
 * Asking by label is what makes the inversion below survive a renumbering: if
 * 'Relay Protection' ever moves, the lookup moves with it and the active-low
 * handling stays attached to the right bit.
 */
function bitNamed(address: number, startsWith: string): number {
  const labels = rule(address).independent_bit_labels ?? {}
  const found = Object.entries(labels).find(([, l]) => l.startsWith(startsWith))
  if (!found) {
    throw new Error(
      `${address} has no independent bit labelled "${startsWith}..." in the rules file`,
    )
  }
  return Number(found[0])
}

/**
 * One switch on this screen.
 *
 * `inverted` is the whole point of the file. It is not a display preference —
 * it decides which way a write goes, so it lives beside the bit rather than in
 * the JSX.
 */
export interface ProtectSwitch {
  bit: number
  label: string
  /** ACTIVE-LOW: the bit SET means this protection is OFF. */
  inverted: boolean
  description: string
}

/*
 * The five inverted bits, by their rules-file label prefix.
 *
 * Matched on a prefix because the map's labels carry the polarity in the name
 * — "Relay Protection (0=Enable, 1=Disable)" — and that suffix is exactly the
 * thing this screen exists to stop a human from having to parse.
 */
export const RELAY_BIT = bitNamed(SPECIAL_SETTINGS, 'Relay Protection')
export const ILEAK_BIT = bitNamed(SPECIAL_SETTINGS, 'I-leak Protection')
export const PV_ISO_BIT = bitNamed(SPECIAL_SETTINGS, 'PV Iso Protection')
export const GRID_INTF_BIT = bitNamed(SPECIAL_SETTINGS, 'Grid Interference (')
export const GRID_INTF_02_BIT = bitNamed(SPECIAL_SETTINGS, 'Grid Interference 02')

/** The three that behave normally. */
export const MPPT_PARALLEL_BIT = bitNamed(SPECIAL_SETTINGS, 'MPPT Parallel')
export const IG_FOLLOW_BIT = bitNamed(SPECIAL_SETTINGS, 'IgFollow')
export const DC_COMPONENT_BIT = bitNamed(SPECIAL_SETTINGS, 'DC Component')

/**
 * The protections, drawn first and together.
 *
 * Grouped ahead of the three non-protection switches because they are what the
 * screen is for and because they share one rule — every one of them is
 * active-low. A reader who learns that once at the top of the list does not
 * have to re-check it five times.
 */
export const PROTECTION_SWITCHES: ProtectSwitch[] = [
  {
    bit: RELAY_BIT,
    label: 'Relay protection',
    inverted: true,
    description:
      'Checks the grid relay can open and close before connecting. Turning it off is a factory diagnostic, not a fix for a relay fault.',
  },
  {
    bit: ILEAK_BIT,
    label: 'Leakage current protection',
    inverted: true,
    description: `Trips on residual current to earth. The trip level is a separate register, ${ILEAK_LIM}, which stays set but does nothing while this is off.`,
  },
  {
    bit: PV_ISO_BIT,
    label: 'PV isolation protection',
    inverted: true,
    description: `Checks array insulation resistance to earth before starting. The threshold is a separate register, ${RISO_LIM}, which stays set but does nothing while this is off.`,
  },
  {
    bit: GRID_INTF_BIT,
    label: 'Grid interference protection',
    inverted: true,
    description:
      'Rejects a grid whose waveform is too distorted to sync to safely.',
  },
  {
    bit: GRID_INTF_02_BIT,
    label: 'Grid interference protection 02',
    inverted: true,
    description:
      'The second, independent interference check. Separate from the one above; both may be on.',
  },
]

/** The switches in 43249 that are NOT protections and NOT inverted. */
export const FUNCTION_SWITCHES: ProtectSwitch[] = [
  {
    bit: MPPT_PARALLEL_BIT,
    label: 'MPPT parallel',
    inverted: false,
    description:
      'On = the MPPT inputs are paralleled onto one array. Off = each tracks its own. A wiring fact, not a protection — set it to match how the strings are actually landed.',
  },
  {
    bit: IG_FOLLOW_BIT,
    label: 'IgFollow',
    inverted: false,
    description:
      'Faster grid-off response. On = the inverter follows grid current more aggressively when the grid drops.',
  },
  {
    bit: DC_COMPONENT_BIT,
    label: 'DC component switch',
    inverted: false,
    description:
      'DC injection monitoring on the AC side. Required by most grid codes.',
  },
]

/** Every switch this screen owns, in the order it draws them. */
export const ALL_SWITCHES: ProtectSwitch[] = [
  ...PROTECTION_SWITCHES,
  ...FUNCTION_SWITCHES,
]

/**
 * Is this switch ON, as a human means it?
 *
 * For an inverted bit "on" means the protection is ACTIVE, which is the bit
 * CLEAR. This is one of only two places the inversion is allowed to happen.
 */
export function protectionOn(word: number, sw: ProtectSwitch): boolean {
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
  sw: ProtectSwitch,
  on: boolean,
): number {
  const bitShouldBeSet = sw.inverted ? !on : on
  return bitShouldBeSet ? setBit(word, sw.bit) : clearBit(word, sw.bit)
}

/** Every bit the rule describes — the mask a masked write is allowed to claim. */
export function ownedMaskOf(address: number): number {
  return ownedMask(rule(address))
}

/**
 * The bits that differ between the word as read and the word as staged.
 *
 * This is the mask a write on THIS screen should claim, and it is narrower
 * than `ownedMaskOf` on purpose.
 *
 * `mergeForWrite` protects the bits OUTSIDE the mask by taking them from a
 * fresh read. All eight protections are inside 43249's rule mask, so claiming
 * the whole mask means a page that was read ten minutes ago writes ten-minute-
 * old values for all eight — and re-reading first changes nothing, because the
 * stale word wins inside the mask anyway. Another engineer's change to any of
 * the other seven switches would be silently reverted by someone toggling one.
 *
 * Claiming only the bits the user actually moved makes the re-read do the job
 * it looks like it is doing: every switch nobody touched comes from the device
 * as it is right now.
 *
 * Returns 0 when nothing was staged, which correctly writes the word back
 * unchanged rather than asserting anything about it.
 */
export function changedMask(read: number, staged: number | undefined): number {
  if (staged === undefined) return 0
  return (read ^ staged) & 0xffff
}

/**
 * The `?` text for the whole screen, shown on every inverted row.
 *
 * Written out rather than summarised because the consequence of getting it
 * backwards is a machine running with its earth-leakage protection off while
 * the screen that turned it off said "Enabled".
 */
export const ACTIVE_LOW_HELP = [
  `This switch is stored ACTIVE-LOW in register ${SPECIAL_SETTINGS}.`,
  `In the register, the bit SET (1) means the protection is DISABLED, and the bit CLEAR (0) means it is ENABLED. That is backwards from every other switch in the app.`,
  `This screen shows you the PROTECTION, not the bit. "On" here always means the protection is active and the machine is protected, whichever way the underlying bit happens to sit.`,
  `SolisCloud's own Protect Setting page shows the RAW BIT instead, labelled "Enable"/"Disable" against the bit value. Reading the two screens side by side, they will look like they disagree. They do not — this one has done the inversion for you.`,
  `The raw word is printed under each row so you can check it against SolisCloud or against a Modbus capture.`,
].join('\n\n')

/** The `?` text for the AFCI rows, which are not part of 43249 at all. */
export const AFCI_HELP = [
  `AFCI (arc fault) is NOT a bit of ${SPECIAL_SETTINGS}, despite SolisCloud's Protect Setting page listing "AFCI Protect" and "AFCI level" against that address.`,
  `The gospel map puts the master switch at ${AFCI_ONOFF} and the per-string detection enables at ${AFCI_DETECTION}. Those are the registers this screen writes.`,
  `${AFCI_DETECTION} is a bit word: BIT00 is PV1, BIT01 is PV2, up to BIT09 for PV10. A string with no panels on it should be left off, or it will report arc faults on an open input.`,
  `Neither register is inverted. 1 means enabled, the ordinary way round.`,
].join('\n\n')

/** Prose for the two trip-level registers, which are plain numbers. */
export const LEVEL_ROWS: Array<{
  address: number
  label: string
  description: string
}> = [
  {
    address: ILEAK_LIM,
    label: 'Leakage current trip level',
    description:
      'Range 50–800 mA, default 240 mA. Only does anything while leakage current protection above is on.',
  },
  {
    address: RISO_LIM,
    label: 'PV isolation threshold',
    description:
      'Range 20–1000 kOhm, default 200 kOhm. Below this the inverter refuses to start. Only does anything while PV isolation protection above is on.',
  },
]
