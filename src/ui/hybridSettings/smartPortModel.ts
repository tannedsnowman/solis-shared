/**
 * The register maths behind the Smart Port screen.
 *
 * The screen has TWO unrelated features on it, and the whole reason this file
 * exists is that they are easy to confuse:
 *
 *   1. SMART PORT (43365) — what is physically bolted to the smart port.
 *   2. AC COUPLED ON GRID (44099) — a bank of PV inverters on the GRID side,
 *      nothing to do with the smart port at all.
 *
 * A fitter who mixes them up curtails the wrong thing, or configures a
 * generator that is not there. So the two halves never share a helper here,
 * and each register belongs to exactly one of them.
 *
 * 43365 is a BITFIELD, not an enum, even though the gospel hangs an
 * Enabled/Disabled `value_map` off it (harvested from Tauri, which shows it as
 * a switch). Bit numbers below are read out of the register DESCRIPTION and
 * the rules file, never typed as literals — a corrected document must break a
 * test here rather than a customer's site.
 */
import { byAddress, rulesByAddress } from '../../gospel/gospel'
import { first, group } from '../pv/captures'
import type { RegisterRule } from '../../settings/bitRules'
import { clearBit, isSet, ownedMask, setBit } from '../../settings/bitRules'

/* ── Half 1: the smart port itself ──────────────────────────────────── */

/** Generator Setting Switch — the bitfield that says what the port is. */
export const SMART_PORT = 43365
/** Energy Storage Function Control Word — holds the AC Coupling ENABLE bit. */
export const FUNCTION_CONTROL = 43483

/* Genset sub-settings. Only meaningful once the port is a genset input. */
export const GENSET_RATED_POWER = 43364
export const GENSET_CHARGE_POWER = 43369
export const GENSET_MODE = 43340
export const GENSET_ENABLE = 43363

/* ── Half 2: AC coupled on the grid port ────────────────────────────── */

/** The gate. Everything below it is hidden while this is off. */
export const AC_COUPLED_ON_GRID = 44099
export const GRID_TIED_INV_TOTAL_POWER = 44220 // U32, fn 16 — from the gospel
export const GRID_TIED_INV_COUNT = 44222
export const AC_COUPLING_MAX_EXPORT = 43989
export const AC_COUPLING_START_FREQ = 43287
/**
 * The SOC at which the hybrid lets the grid-side PV bank start.
 *
 * Belongs to THIS half, not to the smart-port 'AC Coupled' option — the
 * bank is on the grid side, and the battery state is what decides whether
 * there is room for its energy.
 */
export const AC_COUPLING_START_SOC = 43285
/** Max export power, duplicated onto this screen on purpose. See below. */
export const MAX_EXPORT_U16 = 43074
export const MAX_EXPORT_U32 = 44227

/**
 * Bit positions inside 43365, parsed out of the gospel description.
 *
 * The description is the only place the full layout lives: the rules file only
 * describes bits 0 and 1, because those are the two with a CONSTRAINT. Bits 2,
 * 3 and 4 are documented prose only. Parsing rather than transcribing means a
 * corrected document lands here for free — and a document that stops saying it
 * throws, instead of quietly selecting the wrong port.
 */
export interface SmartPortBits {
  /** Generator connection location, low half. */
  generatorLocationLow: number
  /** With Generator — the one that clashes with 43483. */
  withGenerator: number
  /** Generator enable signal. */
  generatorEnableSignal: number
  /** AC Coupling connection location (0 = generator port, 1 = backup port). */
  acCouplingLocation: number
  /** Generator connection location, high half — read WITH the low one. */
  generatorLocationHigh: number
}

/** Find "BITnn: <phrase>" in the register description and return nn. */
function bitFromDescription(description: string, phrase: RegExp): number {
  for (const m of description.matchAll(/BIT(\d\d):\s*([^]*?)(?=BIT\d\d:|$)/g)) {
    if (phrase.test(group(m, 2))) return Number(group(m, 1))
  }
  throw new Error(
    `Register ${SMART_PORT} description no longer describes ${phrase} — the layout changed and this screen must be re-read against the document.`,
  )
}

export function smartPortBits(): SmartPortBits {
  const description = byAddress.get(SMART_PORT)?.description ?? ''
  // "Generator connection location" appears TWICE — bare for the low bit and
  // "(used in combination with BIT00)" for the high one. Order in the document
  // decides which is which, so match on the distinguishing tail.
  const all = [...description.matchAll(/BIT(\d\d):\s*([^]*?)(?=BIT\d\d:|$)/g)]
  const locations = all.filter((m) => /generator connection location/i.test(group(m, 2)))
  if (locations.length < 2) {
    throw new Error(
      `Register ${SMART_PORT} no longer documents both generator-location bits.`,
    )
  }
  const high = locations.find((m) => /combination/i.test(group(m, 2)))
  const low = locations.find((m) => m !== high)
  if (!high || !low) {
    throw new Error(`Register ${SMART_PORT} generator-location bits are ambiguous.`)
  }

  return {
    generatorLocationLow: Number(low[1]),
    generatorLocationHigh: Number(high[1]),
    withGenerator: bitFromDescription(description, /with generator/i),
    generatorEnableSignal: bitFromDescription(description, /generator enable signal/i),
    acCouplingLocation: bitFromDescription(description, /ac coupling connection location/i),
  }
}

/**
 * The AC Coupling ENABLE bit inside 43483, from the rules file's clash group.
 *
 * Taken from the group that names 43365 rather than from `independent_bits`,
 * because the group is the thing the constraint is written against.
 */
export function acCouplingEnableBit(): number {
  const rule = rulesByAddress[String(FUNCTION_CONTROL)] as RegisterRule | undefined
  const group = (rule?.bit_groups ?? []).find(
    (g) =>
      g.rule === 'mutually_exclusive_with_register' &&
      /generator/i.test(`${g.name} ${g.explain ?? ''}`),
  )
  if (!group || group.bits.length !== 1) {
    throw new Error(
      `Register ${FUNCTION_CONTROL} no longer carries a single-bit AC-coupling clash group.`,
    )
  }
  return first(group.bits)
}

/** Every bit of 43365 this screen is allowed to touch. */
export function smartPortOwnedMask(): number {
  const bits = smartPortBits()
  // The rules file only knows bits 0 and 1, so its own `ownedMask` is too
  // narrow to build a four-way selector with. Widen it by the bits the
  // description documents — still derived, never a literal.
  const rule = rulesByAddress[String(SMART_PORT)] as RegisterRule | undefined
  let mask = rule ? ownedMask(rule) : 0
  for (const b of [
    bits.generatorLocationLow,
    bits.withGenerator,
    bits.generatorEnableSignal,
    bits.acCouplingLocation,
    bits.generatorLocationHigh,
  ]) {
    mask |= 1 << b
  }
  return mask & 0xffff
}

/* ── What the port is wired to ──────────────────────────────────────── */

export type PortChoice = 'none' | 'genset' | 'smartLoad' | 'acCoupled'

export interface PortOption {
  id: PortChoice
  label: string
  hint: string
}

/**
 * The four things a fitter can pick.
 *
 * "Smart load output" is the port doing nothing generator-shaped: no
 * generator, no AC coupling on it. It is distinguished from "none" by the
 * smart-load enable on 43483, which is NOT this screen's register — so on this
 * screen the two write the same 43365 word and differ only in intent. Keeping
 * them separate options is deliberate: the fitter is telling us what is on the
 * cable, and a later screen reads that back.
 */
export const PORT_OPTIONS: PortOption[] = [
  {
    id: 'none',
    label: 'None',
    hint: 'Nothing is wired to the smart port.',
  },
  {
    id: 'genset',
    label: 'Genset input',
    hint: 'A generator feeds the smart port. The inverter may start and stop it.',
  },
  {
    id: 'smartLoad',
    label: 'Smart load output',
    hint: 'The port drives a load the inverter switches on when there is spare energy.',
  },
  {
    id: 'acCoupled',
    label: 'AC Coupled',
    hint: 'A PV inverter is wired to the smart port. This is NOT the grid-side PV bank below.',
  },
]

/**
 * Read the current word back into one of the four choices.
 *
 * Only "With Generator" is a hard signal: it is the one bit whose meaning the
 * document states without qualification. Anything else reads as `none` — the
 * screen shows what it can prove rather than inventing a selection.
 */
export function choiceFromWord(word: number | undefined): PortChoice | null {
  if (word === undefined) return null
  const bits = smartPortBits()
  if (isSet(word, bits.withGenerator)) return 'genset'
  if (isSet(word, bits.acCouplingLocation)) return 'acCoupled'
  return 'none'
}

/**
 * The 43365 word for a chosen option, keeping every bit the screen does not own.
 *
 * Masked read-modify-write: the caller hands the merge to `useRegisterWrite`
 * with `smartPortOwnedMask()`, so reserved bits and anything a newer firmware
 * added survive untouched.
 */
export function wordForChoice(word: number, choice: PortChoice): number {
  const bits = smartPortBits()
  let next = word

  // Start from a clean slate across the bits this selector owns, then set only
  // what the choice needs. Leaving a stale bit behind is the failure this
  // guards: a port switched from genset to AC coupled that keeps "With
  // Generator" set is an invalid configuration the inverter will still ACK.
  next = clearBit(next, bits.withGenerator)
  next = clearBit(next, bits.generatorEnableSignal)
  next = clearBit(next, bits.acCouplingLocation)
  next = clearBit(next, bits.generatorLocationLow)
  next = clearBit(next, bits.generatorLocationHigh)

  if (choice === 'genset') {
    next = setBit(next, bits.withGenerator)
    next = setBit(next, bits.generatorEnableSignal)
    // BIT04=0, BIT00=0 is "generator port (Smart port)" — the smart-port case,
    // which is what this half of the screen is about.
  } else if (choice === 'acCoupled') {
    // BIT03 = 0 is the generator port, which IS the smart port. Explicitly
    // cleared above; setting nothing here is the correct word.
  }

  return next & 0xffff
}

/* ── The constraint that must never be resolved silently ────────────── */

export interface PortConflict {
  /** Short line for the row. */
  message: string
  /** The longer "why" from the rules file. */
  explain: string
  /** The register the fitter has to go and change. */
  otherRegister: number
}

/**
 * "With Generator" and "AC Coupling enable" cannot both be on.
 *
 * Reported, never fixed. The two registers belong to different screens and to
 * different physical decisions; picking one for the fitter would silently undo
 * a choice they made somewhere else. So the screen shows the clash and refuses
 * to stage the write.
 */
export function conflictForChoice(
  choice: PortChoice,
  functionControlWord: number | undefined,
): PortConflict | null {
  if (choice !== 'genset') return null
  if (functionControlWord === undefined) return null
  const bit = acCouplingEnableBit()
  if (!isSet(functionControlWord, bit)) return null

  const rule = rulesByAddress[String(SMART_PORT)] as RegisterRule | undefined
  const group = (rule?.bit_groups ?? []).find(
    (g) => g.rule === 'mutually_exclusive_with_register',
  )
  return {
    message: `AC Coupling is enabled on ${FUNCTION_CONTROL}. Turn it off before choosing a genset.`,
    explain:
      group?.explain ??
      'With Generator and AC Coupling enable share the same physical port.',
    otherRegister: FUNCTION_CONTROL,
  }
}

/* ── Half 2's gate ──────────────────────────────────────────────────── */

/**
 * Is the grid-side PV bank switched on?
 *
 * 44099 has no `value_map` in the gospel, so the codes are not documented.
 * Non-zero is treated as enabled, which is the only reading every Solis
 * enable register has ever had.
 */
export const acCoupledOnGridEnabled = (word: number | undefined): boolean =>
  word !== undefined && word !== 0

/**
 * Registers inside the grid-side group, in screen order.
 *
 * Kept as data because the group is HIDDEN when 44099 is off — and a hidden
 * row's staged edit must still be written. The list is what the writer walks;
 * the renderer walks a filtered view of it. Sharing one list is what keeps the
 * two from drifting apart.
 */
export const AC_COUPLED_GROUP: number[] = [
  GRID_TIED_INV_COUNT,
  GRID_TIED_INV_TOTAL_POWER,
  AC_COUPLING_MAX_EXPORT,
  AC_COUPLING_START_FREQ,
  AC_COUPLING_START_SOC,
  MAX_EXPORT_U16,
  MAX_EXPORT_U32,
]


/* ------------------------------------------------- the screen's own rows -- */

/*
 * Moved here from `SmartPort.tsx` so the rail's search index can read them
 * without importing the SCREEN — see the note in `settingsIndex.ts`. An index
 * that imports a .tsx closes a module cycle through the settings tab and
 * blanked the whole settings page at load.
 */

/* ── The rows this screen can draw ──────────────────────────────────── */

/**
 * One gospel-backed numeric/enum row.
 *
 * `label` overrides the gospel name where the installer's word for a setting
 * is not the document's — "Frequency shift start" for 43287, whose real name
 * is "AC Coupling Start Frequency". `description` is written by hand for every
 * row, because the plan requires one and the gospel's descriptions are often
 * empty or are raw bit tables.
 */
export interface RegRow {
  address: number
  label: string
  description: string
}

export const GENSET_ROWS: RegRow[] = [
  {
    address: GENSET_RATED_POWER,
    label: 'Genset rated power',
    description:
      'The size of the generator on the smart port, in kW. Set it to the name-plate rating.',
  },
  {
    address: GENSET_CHARGE_POWER,
    label: 'Generator charging power',
    description:
      'How much of the generator output may charge the battery, in kW. 0 to the model maximum.',
  },
  {
    address: GENSET_MODE,
    label: 'Generator mode',
    description:
      'BIT00 picks manual or automatic start. BIT01 turns generator charging on or off.',
  },
  {
    address: GENSET_ENABLE,
    label: 'Generator start / stop (manual mode)',
    description:
      'Starts or stops the generator by hand. The inverter clears it back to stop on its own.',
  },
]

export const AC_COUPLED_ROWS: RegRow[] = [
  {
    address: GRID_TIED_INV_COUNT,
    label: 'Number of grid-tied INVs',
    description: 'How many PV inverters are in the bank on the grid side.',
  },
  {
    address: GRID_TIED_INV_TOTAL_POWER,
    label: 'Total rated power of grid-tied INVs',
    description:
      'Add up the name-plate kW of every PV inverter in the bank. 32-bit, written with function 16.',
  },
  {
    address: AC_COUPLING_MAX_EXPORT,
    label: 'AC coupling max export control',
    description:
      'Switches the curtailing of the grid-side PV bank. Belongs to this feature, not to the smart port.',
  },
  {
    // The installer calls this "Frequency shift start Hz"; the gospel calls it
    // "AC Coupling Start Frequency" (43287, 0.01 Hz). Same setpoint.
    address: AC_COUPLING_START_FREQ,
    label: 'Frequency shift start',
    description:
      'The hybrid raises the frequency from here to make the PV bank back off. 0.01 Hz steps.',
  },
  {
    address: AC_COUPLING_START_SOC,
    label: 'AC coupling start SOC',
    description:
      'Battery SOC at which the grid-side PV bank may start. 0 to (stop SOC − 10%).',
  },
  /**
   * Max export power, duplicated onto this screen deliberately.
   *
   * It is the number the PV bank gets curtailed to, so it belongs beside the
   * bank as well as on Storage Mode. BOTH registers are always shown and the
   * model number is never sniffed: 43074 is the setting on smaller machines,
   * 44227 the plant-level one on 80–125 kW and above. Showing one and guessing
   * wrong writes a register the inverter does not use, ACKs, and looks like it
   * worked.
   */
  {
    address: MAX_EXPORT_U16,
    label: 'Max export power — smaller models (16-bit)',
    description:
      'The PV bank is curtailed to this. Set this one on smaller machines; both rows are always shown.',
  },
  {
    address: MAX_EXPORT_U32,
    label: 'Max export power — 80–125 kW and above (32-bit)',
    description:
      'The same setpoint on plant-scale machines. 32-bit, written with function 16.',
  },
]
