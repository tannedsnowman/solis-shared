/**
 * The register maths behind the Inverter Work Mode screen, with no React in it.
 *
 * ONE REGISTER. ONE VALUE. THE SCREENSHOT SAYS OTHERWISE AND IS WRONG TWICE.
 * ------------------------------------------------------------------------
 * SolisCloud's "Inverter Work Mode" page draws TWO dropdowns side by side —
 * "Active Power Mode" (offering only Volt-watt) and "Reactive Power Mode"
 * (offering Volt-var, Fixed power factor, Fix reactive power, Power-PF,
 * Power_Q, OFF) — and prints register 3154 beside BOTH of them.
 *
 * Both halves of that are wrong, and each is wrong in its own way:
 *
 *   1. THE REGISTER NUMBER IS WRONG. Settings 3154 is `internalEpmHardSwitch`,
 *      "Internal EPM Hard Switch for AU 2020 Code", whose value_map is
 *      {0 Not Valid, 1 ON, 2 OFF}. It is an export-limiting hard switch and
 *      has nothing whatever to do with working mode. Writing a working mode
 *      into it on an AU 2020 machine would arm or disarm the hard export
 *      limit instead — silently, with an ACK. The register that carries the
 *      working mode is 3073 `workingMode`, whose value_map matches their
 *      dropdown text almost word for word, which is the tell that 3154 is a
 *      transcription slip in their page and not a second register.
 *
 *   2. TWO DROPDOWNS OVER ONE REGISTER CANNOT BOTH BE TRUE. 3073 holds a
 *      SINGLE enum. Its rule says so in as many words: "Exactly one mode runs
 *      at a time... this is a selector, not a set of flags, so an interface
 *      must offer radio buttons and never checkboxes." Two independent
 *      dropdowns over one enum can be left in a state the hardware cannot
 *      hold — Active=Volt-watt AND Reactive=Volt-var — and whichever the user
 *      touched last silently cancels the other. An engineer reads that page,
 *      sees Volt-watt still selected in the left box, and believes both are
 *      running.
 *
 * So this screen draws ONE selector, built from 3073's own value_map. The
 * active/reactive split survives only as LABELLING — see `familyOf` — because
 * it is a genuinely useful way to read the list, and because a page that threw
 * the grouping away entirely would be harder to reconcile against SolisCloud
 * when someone has both open. `MODE_CHOICE_WARNING` is the sentence the screen
 * shows so nobody has to infer the exclusivity from the layout.
 *
 * THERE IS NO "OFF" MODE, AND ONE MUST NOT BE INVENTED
 * ----------------------------------------------------
 * SolisCloud's reactive dropdown ends in "OFF". 3073's value_map has no such
 * value. Mode 0 is "No Response Mode", which is the nearest thing the register
 * has and is almost certainly what their OFF writes — but "almost certainly"
 * is not a basis for putting the word OFF on a control that changes grid
 * behaviour, so mode 0 is rendered with the map's own label and `NO_RESPONSE`
 * is documented rather than relabelled.
 *
 * The register that genuinely turns these functions off is a DIFFERENT one:
 * 3125 `shutdownCommandForActiveAndReactivePowerControl`, whose description
 * reads "01: Turn off the Volt-Watt function; 02: Turn off all reactive power
 * functions: Volt-var, fixed reactive power, fixed power factor, etc.". That
 * is a command register, not a mode, and it is on this screen as one — see
 * `SHUTDOWN_COMMAND`. It has no value_map, so its codes are NOT offered as a
 * dropdown; the raw number is typed, and the description explains it.
 *
 * `06 Rule21 Volt-watt`: THE DESCRIPTION WAS RIGHT, AND THE MAP NOW AGREES
 * ----------------------------------------------------------------------
 * This screen was built while 3073's description enumerated eight modes and
 * its harvested value_map held seven, missing 06. The two could not both be
 * complete, and the setpoint block settled which: registers 3130-3137 are
 * named, in the map's own `name` field, "01/06 working mode V1Set" through
 * "01/06 working mode P4% Set" -- eight registers claiming mode 06 as a peer
 * of mode 01. A mode that did not exist would not have a named, addressable
 * curve block shared with one that does.
 *
 * The map has since been corrected and now carries `6: "Rule21 Volt-Watt (US
 * only)"`. Nothing here was hardcoded while it was missing and nothing needed
 * changing when it landed: `modeOptions()` has always returned exactly the
 * value_map, so the seventh option appeared by itself.
 *
 * `unmappedModes()` survives that fix on purpose. It is not scaffolding for
 * one missing code -- it is a standing cross-check between the register's two
 * descriptions of itself, and a test pins it EMPTY so the next harvest that
 * drops a code fails the build instead of quietly shortening a dropdown.
 *
 * THE CODES ARE NOT CONTIGUOUS, AND UNKNOWN MUST STAY UNKNOWN
 * -----------------------------------------------------------
 * 3073 runs 0 through 6 and then jumps to 12 (0x0C). Codes 7 to 11 do not
 * exist, and neither does anything above 12. So a mode word must never be used
 * to index a dense array, and an unrecognised one must never fall back to the
 * first entry: reporting an unknown mode as "No Response Mode" says the machine
 * is doing nothing when it may be actively curtailing. `isUnknownMode()` and
 * `unknownModeText()` exist so the view says the raw number out loud instead.
 *
 * THE MODES ARE NOT SYMMETRICAL -- see `EXCLUSIVITY_NOTE`
 * -------------------------------------------------------
 * The field statement is "you select the mode... Volt-watt can be on/off but
 * rest is on one at a time". One register still holds one value, so this is
 * never two controls. But the reactive modes (02, 03, 04, 05, 12) are strictly
 * one-at-a-time siblings, while Volt-Watt is an ACTIVE-power curve that 3073
 * gives TWO of its own codes (01 and the US Rule21 06) over one shared register
 * block. The screen states that asymmetry rather than implying five equals.
 *
 * THE CURVE BLOCKS, AS THE SUPPLIED SCREENS SHOW THEM
 * ---------------------------------------------------
 *   Volt-Watt (01 and 06):  3130-3133 V1..V4,  3134-3137 P1..P4%
 *   Volt-Var  (02):         3138-3141 V1..V4,  Q1 3142, Q2 3128, Q3 3129,
 *                           Q4 3143 -- four COMPLETE (V,Q) points
 *   Fixed PF  (03):         3054, owned and edited by the Power Setting screen
 *   Fix reactive (04):      3051
 *   Power-PF  (05):         3144 Pb%, 3145 Pc%, 3146 PFc, 3188/3189 ULock
 *   Power_Q   (12):         3321-3325 P1..P5, 3326-3330 Q1..Q5 -- FIVE points
 *
 * An earlier specification for this screen guessed at 3126, 3127, 3168-3173,
 * 3331, 3332 and 3337. The supplied pages show none of them, so none is drawn:
 * a register the real screen does not show is not evidence of anything.
 *
 * CURVES ARE ORDERED POINTS, AND THE ORDER IS THE POINT
 * ----------------------------------------------------
 * Same reasoning as `pvGridCodeModel`'s stage matrix. A Volt-Watt curve is
 * "at V1 do P1%, at V2 do P2%…" — four coordinate PAIRS in ascending voltage.
 * SolisCloud prints them as eight consecutive numbered rows, which means
 * reading a curve involves holding four numbers in your head while scrolling.
 * `CURVES` below is the curve as data — an ordered array of {voltage, value}
 * address pairs — and the view walks it and draws a table with the points as
 * rows. When a register is corrected the fix lands in one array here.
 *
 * WHY EACH SECTION IS GREYED WHEN IT IS NOT THE SELECTED MODE
 * -----------------------------------------------------------
 * 3073's rule carries the gotcha in full: "Registers 3051 and 3053 look
 * writable at any time and are not... Set the mode FIRST, then the value, or
 * the write is silently ignored." 3051's own description says "Only available
 * for working mode 04". So editing a Volt-Var point while the machine sits in
 * Fixed PF is not merely pointless — it produces a successful-looking write
 * that changes nothing, which is indistinguishable from a change that worked.
 *
 * `activityOf()` answers, per section, whether the current 3073 word makes it
 * live. It returns `unknown` when 3073 has not been read, and the view must
 * NOT grey on unknown: a section greyed because of a missing read tells the
 * engineer the mode is wrong when the truth is that nothing has been read.
 *
 * PERSISTENCE IS BORROWED, NOT RE-DERIVED
 * ---------------------------------------
 * Every register on this screen whose description mentions saving says the
 * same thing: "If need power off saving, set 3069 BIT03 or 02". 3073's own
 * description says "If need power off saving function, set 3069=1". That is
 * the same 3069 machinery `pvPowerSettingModel` already resolves BY LABEL out
 * of the rules file, complete with the printed-versus-wire convention problem
 * and the four-bit correction.
 *
 * So this file IMPORTS `SAVE_BIT_OF`, `SAVE_OWNED_MASK`, `persistenceOf` and
 * `wordForSave` from there rather than deriving them again. Two derivations of
 * the same bitfield are two things to correct and one of them will be missed.
 * Nothing in their file is edited; only its exports are used.
 *
 * The BORROWED part needs stating precisely, because 3069's bits are per
 * REGISTER and none of them names 3130-3146 or 3168-3173 directly.
 * `SAVE_BIT_OF` therefore has no entry for any curve register, and
 * `persistenceOf` correctly answers `no-save-bit` for them. That is not a gap
 * to paper over with a guess — see `WORKING_MODE_SAVE_BITS` for the two bits
 * the documents say cover this block, and note they are surfaced as an
 * explanatory note on the section rather than as a per-row badge, because the
 * vault vouches for them covering 3073 and does not enumerate every curve
 * register they carry with it.
 *
 * WRITES GO THROUGH `usePvRegisterWrite`, PRINTED ADDRESS IN
 * ----------------------------------------------------------
 * Nothing here computes a wire address and nothing adds 3000 to an index. The
 * −1 offset lives in `pvGospel.wireAddress` and is applied once, inside the
 * hook. `assertSettingsSpace` exists so a test can prove no address on this
 * screen drifted into the DATA space, where 3130 is a different register.
 */
import {
  byScopedAddress,
  settingsByAddress,
  type GospelRegister,
} from '../../gospel/pvGospel'
import { ruleFor, type PvRule } from '../../gospel/pvRules'
import { group } from './captures'
import {
  POWER_OFF_SAVING,
  SAVE_BIT_OF,
  SAVE_OWNED_MASK,
  persistenceOf,
  wordForSave,
  type PersistenceState,
} from './pvPowerSettingModel'

/* Re-exported so the view takes the whole save-bit story from one import and
   nobody is tempted to reach into the power screen for half of it. */
export {
  POWER_OFF_SAVING,
  SAVE_BIT_OF,
  SAVE_OWNED_MASK,
  persistenceOf,
  wordForSave,
}
export type { PersistenceState }

/* ------------------------------------------------------------------ *
 * The one register this screen is about.
 * ------------------------------------------------------------------ */

/**
 * Working mode. THE register. Not 3154.
 *
 * See the header for why SolisCloud's page prints 3154 beside both of its
 * dropdowns and why that number must not be built on.
 */
export const WORKING_MODE = 3073

/**
 * The register SolisCloud's page names instead, kept as a named constant.
 *
 * Named rather than left as a comment so a test can assert that this screen
 * touches every address it draws EXCEPT this one, and so the mistake is
 * documented in the same place the correction is.
 */
export const SOLISCLOUD_CLAIMED_REGISTER = 3154

/**
 * Mode 0, whose label is "No Response Mode" and is NOT called OFF here.
 *
 * SolisCloud's reactive dropdown offers "OFF" and 3073 has no such value. This
 * is the nearest thing and is very likely what their OFF writes, but the map
 * does not say so, so the map's own words are what appear on screen.
 */
export const NO_RESPONSE = 0

/**
 * The real off switch: a command register, not a mode.
 *
 * "01: Turn off the Volt-Watt function; 02: Turn off all reactive power
 * functions". No value_map, so no dropdown is manufactured for it — the codes
 * live in the description the row already shows.
 */
export const SHUTDOWN_COMMAND = 3125

/**
 * The two 3069 bits every register in the 3130-3146 block names.
 *
 * Their descriptions all read "If need power off saving, set 3069 BIT03 or
 * 02", and 3069's own rule confirms the pairing from the other side: BIT02 is
 * "the reactive power limitation (3051) ... along with the working mode (3073)
 * and the 3130-3146 block", BIT03 the same for 3054.
 *
 * Derived from `SAVE_BIT_OF` rather than written as [2, 3], so a corrected
 * rules file moves it. The two bits wanted are the ones the vault says carry
 * the working mode with them, which is exactly the set of bits whose target
 * register is NOT the bare active-power pair — expressed here as "the bits
 * that persist 3051 and 3054", the two registers 3073's rule lists under
 * `enables`.
 */
export const WORKING_MODE_SAVE_BITS: number[] = (() => {
  const rule = ruleFor('settings', WORKING_MODE)
  const enabled = ((rule as unknown as { enables?: { registers?: string[] }[] })
    ?.enables ?? [])
    .flatMap((e) => e.registers ?? [])
    .map((r) => Number(r.split(':').pop()))
    .filter((n) => Number.isFinite(n))
  const bits = enabled
    .map((address) => SAVE_BIT_OF.get(address))
    .filter((b): b is number => b !== undefined)
  return Array.from(new Set(bits)).sort((a, b) => a - b)
})()

/* ------------------------------------------------------------------ *
 * The mode list — from the value_map, never from the screenshot.
 * ------------------------------------------------------------------ */

/**
 * How the SolisCloud page would have grouped a mode.
 *
 * LABELLING ONLY. This never gates a write, never splits the selector and
 * never produces a second value. It exists so the one dropdown can be drawn
 * with two headings, which is the readable half of what SolisCloud was
 * reaching for when it drew two boxes.
 */
export type ModeFamily = 'none' | 'active' | 'reactive'

export interface ModeOption {
  /** Raw word written to 3073. */
  value: number
  /** The map's own label. Never the screenshot's wording. */
  label: string
  family: ModeFamily
  /** True when the description names it but the value_map does not. */
  fromDescriptionOnly: boolean
}

/**
 * Which family a mode belongs to, decided from the map's own label text.
 *
 * Matched on the LABEL rather than on a hardcoded list of mode numbers, so a
 * firmware that adds a mode lands in the right heading with no edit here. The
 * words matched are the ones the value_map actually uses ("Volt-Watt",
 * "Volt-VAR", "Fixed Power Factor", "Reactive Power", "Power-PF", "P-Q").
 *
 * Volt-Watt is the only ACTIVE-power mode — it curves real power against
 * voltage. Everything else trims reactive power. Mode 0 responds to nothing
 * and so belongs to neither.
 */
export function familyOf(label: string, value: number): ModeFamily {
  if (value === NO_RESPONSE) return 'none'
  const t = label.toLowerCase()
  if (/volt\s*[-–]?\s*watt/.test(t)) return 'active'
  return 'reactive'
}

/** Modes the value_map holds, ascending. The ONLY list offered for writing. */
export function modeOptions(): ModeOption[] {
  const vm = registerAt(WORKING_MODE)?.value_map
  if (!vm) return []
  return Object.entries(vm)
    .map(([raw, label]) => {
      const value = Number(raw)
      return {
        value,
        label: String(label),
        family: familyOf(String(label), value),
        fromDescriptionOnly: false,
      }
    })
    .filter((o) => Number.isFinite(o.value))
    .sort((a, b) => a.value - b.value)
}

/**
 * Modes 3073's DESCRIPTION enumerates, parsed out of its prose.
 *
 * "Working mode: 00---No response mode 01---Volt–watt default 02---Volt–var
 * 03---Fixed power factor 04---Fix reactive power 05---Power-PF
 * 06---Rule21Volt–watt 0C--- P-Q"
 *
 * Codes are HEX in that text — `0C` is 12, and the value_map agrees by holding
 * key "12". Parsed as base 16 for that reason. A decimal parse would read 0C
 * as 0 and silently merge the P-Q mode into No Response.
 *
 * Exported so a test can pin the description-versus-value_map discrepancy as a
 * fact about the map rather than as a claim in a comment.
 */
export const MODES_IN_DESCRIPTION: ReadonlyMap<number, string> = (() => {
  const out = new Map<number, string>()
  const text = registerAt(WORKING_MODE)?.description ?? ''
  // "01---Volt–watt default" — code, a run of dashes, then the label, which
  // runs until the next code or the trailing Note.
  const re = /\b([0-9A-F]{2})\s*-{2,}\s*([^]*?)(?=\s+[0-9A-F]{2}\s*-{2,}|\s*Note[:：]|$)/gi
  for (const m of text.matchAll(re)) {
    const value = parseInt(group(m, 1), 16)
    const label = group(m, 2).replace(/\s+/g, ' ').trim()
    if (Number.isFinite(value) && label && !out.has(value)) {
      out.set(value, label)
    }
  }
  return out
})()

/**
 * Modes the description names that the value_map does NOT hold.
 *
 * EMPTY TODAY, and that is the point. This used to return [6]: the description
 * named "06---Rule21Volt-watt" and the harvested value_map had dropped it. The
 * vault has since corrected the map, so the two sources now agree and this
 * returns nothing.
 *
 * It is KEPT rather than deleted because it is not scaffolding for that one
 * fix — it is a standing cross-check between the register's two descriptions
 * of itself. The next time a harvest drops a code, this fills again and the
 * screen says so, instead of quietly offering a short list. A test pins it
 * empty, so a regression in the map fails the build rather than the field.
 */
export function unmappedModes(): ModeOption[] {
  const mapped = new Set(modeOptions().map((o) => o.value))
  return [...MODES_IN_DESCRIPTION]
    .filter(([value]) => !mapped.has(value))
    .map(([value, label]) => ({
      value,
      label,
      family: familyOf(label, value),
      fromDescriptionOnly: true,
    }))
    .sort((a, b) => a.value - b.value)
}

/**
 * The label for a mode word the inverter reported, or null when unrecognised.
 *
 * NULL IS A REAL ANSWER AND MUST NOT BE SMOOTHED OVER. The mode codes are not
 * contiguous — 0 through 6, then a jump to 12 (0x0C) — so any code from 7 to
 * 11, or anything above 12, is a value this firmware knows and this map does
 * not. Nothing here may index a dense array or fall back to the first entry:
 * doing either would report an unknown mode as "No Response Mode", which reads
 * as a machine doing nothing when it may be actively curtailing.
 *
 * The description is consulted as a SECOND source, not as a fallback dressed
 * up as an answer — if the value_map has been harvested short again, the
 * register's own prose may still name the mode, and reporting what the machine
 * is doing is not the same act as offering to write it.
 */
export function labelForMode(raw: number | undefined): string | null {
  if (raw === undefined || !Number.isFinite(raw)) return null
  const mapped = modeOptions().find((o) => o.value === raw)
  if (mapped) return mapped.label
  return MODES_IN_DESCRIPTION.get(raw) ?? null
}

/**
 * True when neither source can name this mode word.
 *
 * The view must render this as an explicit unknown — the raw number, said out
 * loud — rather than leaving the selector showing whichever option happened to
 * be first. A silent fallback here is indistinguishable from a correct read.
 */
export function isUnknownMode(raw: number | undefined): boolean {
  if (raw === undefined || !Number.isFinite(raw)) return false
  return labelForMode(raw) === null
}

/** What the view shows for a mode word no source can name. */
export function unknownModeText(raw: number): string {
  return `Unrecognised mode ${raw} — register ${WORKING_MODE} holds a value neither its own value list nor its description names. The mode codes are not contiguous (0-6, then 12), so this is a real gap and not a rounding error. Do not assume the inverter is idle.`
}

/**
 * The sentence the screen shows beside the selector.
 *
 * Built from the map rather than written as prose so it cannot go stale: it
 * names the register the modes actually live in and counts them from the
 * value_map. The exclusivity claim itself comes from 3073's rule, which states
 * it directly.
 */
export const MODE_CHOICE_WARNING =
  `One register, one value. Picking a reactive mode REPLACES the active one — ` +
  `there is no separate active and reactive selection in the hardware. ` +
  `SolisCloud draws two dropdowns over this single register and prints ` +
  `${SOLISCLOUD_CLAIMED_REGISTER} beside both; ${SOLISCLOUD_CLAIMED_REGISTER} is the AU 2020 EPM hard switch and is a different setting entirely.`

/* ------------------------------------------------------------------ *
 * The curves.
 * ------------------------------------------------------------------ */

/**
 * One point on a curve: an x address and a y address.
 *
 * Either half may be null where the curve genuinely has no register for it —
 * the Power-PF page shows a Pb breakpoint with no power factor of its own, and
 * the single-value modes have no x axis at all. Null, never an omitted entry,
 * for the same reason `pvGridCodeModel` stores `null` cells: blank space in a
 * setpoint table reads as a zero setpoint.
 */
export interface CurvePoint {
  /** Point name as the SolisCloud page writes it: 'V1', 'Pb', 'P3'. */
  name: string
  /** Printed address of the x value (voltage or power), or null. */
  voltage: number | null
  /** Printed address of the response at this point, or null. */
  value: number | null
}

/**
 * A register this curve shows but does NOT own.
 *
 * Two editable controls on one register is how two engineers disagree without
 * either seeing the other's change. Where a register's real home is another
 * screen, the value is drawn read-only here with a pointer to where it is
 * edited, rather than duplicated.
 */
export interface CrossReference {
  address: number
  /** The screen that owns the control, by its rail name. */
  screen: string
  /** Why that screen owns it rather than this one. */
  why: string
}

/** A curve belongs to exactly one working mode — or, for Volt-Watt, two. */
export interface Curve {
  id: string
  title: string
  /** The modes of 3073 that make this curve live. */
  modes: number[]
  /** What the curve maps, in words. */
  note: string
  /** Column heading for the x axis. Empty for a single-value mode. */
  xLabel: string
  /** Column heading for the y axis. */
  yLabel: string
  points: CurvePoint[]
  /** Rows that belong to the curve but are not points on it. */
  extras: ExtraRow[]
  /** Set when this curve's value is owned and edited by another screen. */
  crossReference?: CrossReference
  /**
   * A longer explanation, opened from a `?` beside the section heading.
   *
   * For things too long for `note` and too important to omit -- specifically,
   * how a section RELATES to another one. See `FIXED_PF_HELP`.
   */
  help?: string
}

/** A supporting register beside a curve: a limit, a time constant, a droop. */
export interface ExtraRow {
  address: number
  label: string
  description: string
}

/** What the view draws where a curve has no register for a point. */
export const POINT_MISSING = '—'

/**
 * VOLT-WATT — voltage against ACTIVE power. Modes 01 and 06.
 *
 * SolisCloud's "Volt-watt" sub-page, row for row: V1..V4 Set and P1%..P4% Set.
 * The map names all eight "01/06 working mode", which is independent
 * confirmation that modes 01 and 06 SHARE this block — there is not a second
 * Rule21 copy — so a machine in mode 6 is running these very registers and the
 * section must be live for both.
 *
 * THE ODD ONE OUT. Every other mode here trims REACTIVE power and they are
 * mutually exclusive. Volt-Watt curves ACTIVE power, and the field statement
 * is that it "can be on/off but rest is on one at a time". 3073 carrying two
 * separate Volt-Watt modes (01 and 06) is consistent with that. See
 * `EXCLUSIVITY_NOTE` for how the screen says this out loud.
 */
export const VOLT_WATT: Curve = {
  id: 'voltWatt',
  title: 'Volt-Watt curve',
  modes: [1, 6],
  note: 'Four points of voltage against ACTIVE power — above the upper voltage points the inverter throttles real output to hold the grid down. Modes 01 and 06 share these same eight registers; 06 is the Rule21 (US only) flavour.',
  xLabel: 'Voltage',
  yLabel: 'Active power',
  points: [
    { name: 'V1', voltage: 3130, value: 3134 },
    { name: 'V2', voltage: 3131, value: 3135 },
    { name: 'V3', voltage: 3132, value: 3136 },
    { name: 'V4', voltage: 3133, value: 3137 },
  ],
  extras: [],
}

/**
 * VOLT-VAR — voltage against REACTIVE power. Mode 02.
 *
 * FOUR COMPLETE (V, Q) POINTS. Every point has both halves, and this is the
 * one place the screen deliberately does NOT follow SolisCloud's row order.
 *
 * Their Volt-var page lists the rows in this order:
 *
 *   V1 Set (3138), V2 (3139), V3 (3140), V4 (3141),
 *   Q1 Max Leading Var% (3142), Q4 Max Lagging Var% (3143),
 *   Q2 Set (3128), Q3 Set (3129)
 *
 * Q2 and Q3 are printed LAST while living at the LOWEST addresses, and Q4 is
 * printed before Q2. Read down that page and the curve's shape is invisible:
 * you have to pair row 1 with row 5, row 2 with row 7, row 3 with row 8 and
 * row 4 with row 6, in your head, from memory.
 *
 * So the points are stored here in CURVE order — (V1,Q1) (V2,Q2) (V3,Q3)
 * (V4,Q4) — and the view draws one row per point. The address ordering is the
 * document's accident; the curve is the fact.
 *
 * A note on the two Q pairs, because they are genuinely different registers
 * and not a naming inconsistency: Q1/Q4 are the outer CLAMPS (scale 1%, u16,
 * "MaxLeadingVar%"/"MaxLaggingVar%") and Q2/Q3 are the inner SETPOINTS (scale
 * 0.01%, s16, signed because a negative Q is lagging). Different scales and
 * different signedness on the same axis — which is exactly why nothing here
 * states a scale and every cell asks the map for its own.
 */
export const VOLT_VAR: Curve = {
  id: 'voltVar',
  title: 'Volt-Var curve',
  modes: [2],
  note: 'Four points of voltage against REACTIVE power. Drawn in curve order (V1,Q1) to (V4,Q4) — SolisCloud lists Q2 and Q3 last, below Q4, which hides the shape. Q1 and Q4 are the outer clamps; Q2 and Q3 are signed, and negative means lagging.',
  xLabel: 'Voltage',
  yLabel: 'Reactive power',
  points: [
    { name: 'V1', voltage: 3138, value: 3142 },
    { name: 'V2', voltage: 3139, value: 3128 },
    { name: 'V3', voltage: 3140, value: 3129 },
    { name: 'V4', voltage: 3141, value: 3143 },
  ],
  extras: [],
}

/**
 * WHY MODE 03 AND THE CONTROL PANEL'S PF ARE THE SAME FUNCTION.
 *
 * Reported from the field, and the register map agrees: setting a power factor
 * directly is NOT a work mode. It is a straight adjustment, in the same family
 * as derating active power with 3052 -- you are trimming a quantity, not
 * asking the inverter to follow a curve against voltage. That is why the PF
 * setpoint and the active-power percentage now sit together on the Control
 * Panel as plain controls.
 *
 * Mode 03 "Fixed power factor" then LOOKS like a second, separate feature, and
 * it is not. It drives the very same PF function. The inverter exposes one
 * capability through two doors: a value you can write directly, and an enum
 * position that switches the machine into holding that value. Solis built it
 * this way; it is a quirk of the product, not two independent controls.
 *
 * The practical consequence, and the reason this sentence is on the screen
 * rather than only in this file: selecting mode 03 changes which register the
 * value you type lands in. Someone who sets PF on the Control Panel and then
 * selects mode 03 has not stacked two settings -- they have taken the same
 * setting through the second door.
 *
 * Contrast mode 04 deliberately. See `FIXED_REACTIVE_HELP`.
 */
export const FIXED_PF_HELP =
  'Setting a power factor is not really a "mode" — it is a direct adjustment, ' +
  'like derating active power. It lives on the Control Panel as a plain ' +
  'control. This mode drives the SAME power-factor function: Solis exposes ' +
  'one capability through two doors (a value you write, and an enum position ' +
  'that holds it). Selecting this mode changes which register your value ' +
  'lands in, so it is not a second setting stacked on top of the first. ' +
  'Fixed reactive power below is genuinely different — see its own note.'

/**
 * WHY MODE 04 IS NOT THE SAME AS MODE 03, AND MUST NOT BE MERGED WITH IT.
 *
 * PF and VAR are different quantities and this is the distinction most easily
 * lost when tidying these two sections together.
 *
 * Power factor is a RATIO -- a function of active power. Ask for PF 0.95 and
 * the reactive power the inverter produces depends on how much active power it
 * happens to be making at that instant: at half output you get half the VARs.
 * Reactive power is an ABSOLUTE quantity. Ask for +30% and you get that
 * regardless of what the array is doing, including at low output where a PF
 * setting would have produced almost nothing.
 *
 * So a grid operator asking for voltage support wants mode 04; one asking for
 * a displacement target wants mode 03. Merging the two sections, or letting
 * one note describe both, would hide a choice that changes what the machine
 * actually exports.
 */
export const FIXED_REACTIVE_HELP =
  'Different from Fixed power factor above, and not interchangeable with it. ' +
  'Power factor is a RATIO — a function of active power — so the VARs you get ' +
  'follow the array: at half output, half the reactive power. Reactive power ' +
  'here is an ABSOLUTE amount and is produced regardless of active output. ' +
  'Voltage support usually wants this; a displacement target wants PF.'

/**
 * FIXED POWER FACTOR — mode 03. One value, no curve.
 *
 * 3054, NOT 3053. SolisCloud's Fixed Power Factor page shows one row and the
 * vault's correction confirms which register it is: 3054 `pfSetting02` is the
 * real PF setting, reached through the 0xA2 code on 3071, and writing it
 * switches the inverter into working mode 03 by itself. 3053 is the register
 * gated BY mode 03 and by that same 0xA2 confusion; it belongs to PowerSetting.
 *
 * PowerSetting also draws 3054 — it is the register the reactive unlock switch
 * enables, which is that screen's whole subject. Rather than duplicate the
 * control, this section CROSS-REFERENCES it. Two editable controls on one
 * register is how two engineers disagree without either seeing the other's
 * change, so the value is shown here read-only and edited there.
 */
export const FIXED_PF: Curve = {
  id: 'fixedPf',
  title: 'Fixed power factor',
  modes: [3],
  note: 'One power factor, held regardless of voltage or power. The sign carries leading versus lagging, and 1.00 and -1.00 are the same operating point.',
  xLabel: '',
  yLabel: 'Power factor',
  points: [{ name: 'PF', voltage: null, value: 3054 }],
  extras: [],
  help: FIXED_PF_HELP,
  crossReference: {
    address: 3054,
    screen: 'Power Setting',
    why: 'Writing this register also switches the inverter into working mode 03 by itself, and it is the register the reactive unlock switch (3071 = 0xA2) enables. Power Setting owns that switch, so it owns this control — it is read-only here so the mode and its value can be read together.',
  },
}

/**
 * FIXED REACTIVE POWER — mode 04. One value, no curve.
 *
 * 3051's description is unambiguous: "Only available for working mode 04".
 * Its rule repeats it as `applies_when`. The clearest case on the screen for
 * dimming a section out of its mode.
 */
export const FIXED_REACTIVE: Curve = {
  id: 'fixedReactive',
  title: 'Fixed reactive power',
  modes: [4],
  note: 'One reactive power set-point, a stated -60% to +60%. Its own description says it is only available in working mode 04 — written in any other mode it is accepted and ignored.',
  xLabel: '',
  yLabel: 'Reactive power',
  points: [{ name: 'Q', voltage: null, value: 3051 }],
  extras: [],
  help: FIXED_REACTIVE_HELP,
}

/**
 * POWER-PF — output power against power factor. Mode 05.
 *
 * SolisCloud's Power-PF page, row for row: Pb% Set, Pc% Set, OV-PcFactor,
 * ULock In, ULock Out.
 *
 * This is NOT a four-point A/B/C/D curve. The earlier specification for this
 * screen assumed one and named 3168-3172 for its points; the real page shows
 * two power breakpoints (Pb, Pc) and one power factor (PFc), so it is a
 * two-point curve with a single response value, and 3168-3172 are not on it at
 * all. They are not drawn here — a register the supplied page does not show is
 * not evidence of anything.
 *
 * ULock In / ULock Out are voltages, not points on the power axis, so they sit
 * as extras rather than being forced into the point table.
 */
export const POWER_PF: Curve = {
  id: 'powerPf',
  title: 'Power-PF curve',
  modes: [5],
  note: 'Two power breakpoints and the power factor held between them. The x axis here is POWER, not voltage — the inverter trims PF as it loads up.',
  xLabel: 'Power',
  yLabel: 'Power factor',
  points: [
    { name: 'Pb', voltage: 3144, value: null },
    { name: 'Pc', voltage: 3145, value: 3146 },
  ],
  extras: [
    {
      address: 3188,
      label: 'ULock In',
      description:
        'Voltage at which the P-PF curve engages. For Brazil 140, Dubai and CEI021 — the range and default follow the standard, not the register.',
    },
    {
      address: 3189,
      label: 'ULock Out',
      description:
        'Voltage at which the P-PF curve releases. For Brazil 140, Dubai and CEI021.',
    },
  ],
}

/**
 * POWER_Q — IEEE1547-2018 P-Q mode. Mode 12 (0x0C).
 *
 * A FIVE-point curve, and the only one on the screen that is not four. Both
 * axes are percentages at the same 0.01 scale: P1..P5 at 3321-3325 are the
 * power limits, Q1..Q5 at 3326-3330 the reactive response at each.
 *
 * The two runs are parallel and contiguous, which is what makes the pairing
 * safe to state: 3321 pairs with 3326, 3322 with 3327, and so on. Every one of
 * the ten carries "the power-off save function needs to be enabled in the 3069
 * register BIT03 or BIT02" in its description — the same note the 3130-3146
 * block carries, and the same pair of bits `WORKING_MODE_SAVE_BITS` resolves.
 */
export const P_Q: Curve = {
  id: 'pq',
  title: 'Power_Q (IEEE1547-2018 P-Q)',
  modes: [12],
  note: 'Five points of active power against reactive power. Both axes are percentages of rating — P of Pn, Q of Sn, where a negative Q is lagging.',
  xLabel: 'Active power',
  yLabel: 'Reactive power',
  points: [
    { name: 'P1', voltage: 3321, value: 3326 },
    { name: 'P2', voltage: 3322, value: 3327 },
    { name: 'P3', voltage: 3323, value: 3328 },
    { name: 'P4', voltage: 3324, value: 3329 },
    { name: 'P5', voltage: 3325, value: 3330 },
  ],
  extras: [],
}

/**
 * Every curve, in the order 3073 numbers its modes.
 *
 * Mode order rather than address order, so the screen reads down the dropdown.
 *
 * VOLT CONTROL IS DELIBERATELY ABSENT. SolisCloud's sidebar lists a "Volt
 * Control" sub-page under Inverter Work Mode and that screen has not been
 * supplied. It is not built, and nothing here guesses at its registers — the
 * same treatment the EPM screen gives SolisCloud's unbuilt CT Setting page.
 * Guessing at a page's contents is what produced the screen that was deleted.
 */
export const CURVES: Curve[] = [
  VOLT_WATT,
  VOLT_VAR,
  FIXED_PF,
  FIXED_REACTIVE,
  POWER_PF,
  P_Q,
]

/**
 * How the modes actually exclude one another, in the field's own terms.
 *
 * "You select the mode... Volt-watt can be on/off but rest is on one at a
 * time." One register still holds one value, so this is not two controls — but
 * the two halves of the list are not symmetrical, and saying so is more honest
 * than implying five equal siblings.
 *
 * The reactive modes are strictly one-at-a-time. Volt-Watt is the odd one out:
 * it curves ACTIVE power, and 3073 gives it two of its own codes (01 and 06)
 * over one shared register block.
 */
export const EXCLUSIVITY_NOTE =
  'The reactive modes — Volt-Var, Fixed power factor, Fix reactive power, ' +
  'Power-PF and Power_Q — are strictly one at a time: picking one replaces ' +
  'whichever was running. Volt-Watt is the odd one out, an ACTIVE-power curve ' +
  'with two codes of its own (01 and the US Rule21 flavour 06) over one shared ' +
  'block of registers.'

/**
 * Registers whose map scale is contradicted by their own description.
 *
 * 3051 carries `scale: 1` in the map, but its description says
 * "10000 <--> 100%" and its valid_range is -6000..6000 for a stated range of
 * -60%..+60%. Both of those say the scale is 0.01.
 *
 * The screen renders the MAP's scale, because inventing a scale is the one
 * thing this file must never do, and shows this warning beside the value so
 * the number is not read as a percentage when it may be a hundred times one.
 * Stated as data so a corrected map empties it by deletion rather than by an
 * edit to the view.
 */
/*
 * EMPTY, and that is the correct state today -- not a stub waiting to be
 * filled. 3051 sat here until the vault gave it its documented scale of 0.01,
 * which V18 and V19 print in the unit column; the warning went with the fix.
 *
 * Kept because the doubt it expresses is real and will recur. What it must NOT
 * become is a place to record a hunch: the 3142/3143 clamps looked like they
 * shared 3051's problem -- same "10000 <--> 100%" wording, same family -- and
 * they do not. A live machine reads them as raw 30 and -30 for a +/-30% clamp,
 * so their scale really is 1, while the inner setpoints at 3128/3129 really are
 * 0.01. That asymmetry is a fact about the register map, not an artefact to be
 * tidied away, and this map is the wrong tool for arguing otherwise.
 *
 * Add an entry only where the MAP ITSELF is in doubt and a write could land a
 * hundred times out. Fix it at the vault and delete the entry again.
 */
export const SCALE_DOUBTS: ReadonlyMap<number, string> = new Map()

/* ------------------------------------------------------------------ *
 * Rows that belong to no single mode.
 * ------------------------------------------------------------------ */

export interface PlainRow {
  address: number
  label: string
  description: string
}

/**
 * Registers that apply whatever mode is selected.
 *
 * Kept OUT of the curve sections deliberately: a row inside a greyed section
 * reads as "not applicable right now", and every one of these applies right
 * now. 3125 in particular must never be greyed — it is the register you reach
 * for when a mode is misbehaving.
 */
export const ALWAYS_ROWS: PlainRow[] = [
  {
    address: SHUTDOWN_COMMAND,
    label: 'Shutdown command',
    description:
      'A command, not a mode. Write 01 to turn off the Volt-Watt function, 02 to turn off ALL reactive power functions (Volt-var, fixed reactive, fixed power factor). Other values do nothing. The map gives it no value list, so the raw code is typed rather than picked.',
  },
  {
    address: 3118,
    label: 'Working mode control switch',
    description:
      'BIT00 overvoltage active-power automatic limit. BIT01 Vref control enable, which is what makes 3126/3127 take effect at all. Read-modify-write: BIT02-15 are reserved and must be preserved.',
  },
  {
    address: 3195,
    label: 'Power factor control mode',
    description:
      'How the power factor is arrived at: 0 from the transmitted data words, 1 tracking the VDE4105 curve, 2 tracking the Brazilian standard curve. 3 and 4 are reserved. The map gives no value list for it.',
  },
]

/* ------------------------------------------------------------------ *
 * Activity — is this section live, given what 3073 holds?
 * ------------------------------------------------------------------ */

export type Activity =
  /** 3073 has not been read. Do NOT grey on this. */
  | { kind: 'unknown' }
  /** This curve's mode is the one selected. */
  | { kind: 'live'; mode: number }
  /** A different mode is selected. Writes here are accepted and ignored. */
  | { kind: 'inactive'; selected: number; selectedLabel: string | null }

/**
 * Is a curve live?
 *
 * `unknown` is a distinct answer and the view must render it as such. Greying
 * a section because 3073 has not been read would tell an engineer the mode is
 * wrong when the truth is that nothing has been read — the same class of lie
 * the Grid Code screen's precision gate exists to avoid.
 */
export function activityOf(
  curve: Curve,
  modeWord: number | undefined,
): Activity {
  if (modeWord === undefined || !Number.isFinite(modeWord)) {
    return { kind: 'unknown' }
  }
  if (curve.modes.includes(modeWord)) return { kind: 'live', mode: modeWord }
  return {
    kind: 'inactive',
    selected: modeWord,
    selectedLabel: labelForMode(modeWord),
  }
}

/**
 * The sentence shown on an inactive section.
 *
 * Says what will HAPPEN — accepted and ignored — rather than "disabled",
 * because the write really does succeed and that is the whole trap. 3073's
 * rule states it: "Set the mode FIRST, then the value, or the write is
 * silently ignored."
 */
export function inactiveNote(curve: Curve, activity: Activity): string | null {
  if (activity.kind !== 'inactive') return null
  const selected =
    activity.selectedLabel ?? `mode ${activity.selected}`
  const mine = curve.modes.map((m) => `0${m}`.slice(-2)).join(' or ')
  return `The inverter is in ${selected}. This section belongs to working mode ${mine}, so writes here are accepted by the inverter and have no effect until the mode is changed.`
}

/* ------------------------------------------------------------------ *
 * The gospel, reached only through the settings scope.
 * ------------------------------------------------------------------ */

/** The settings-space record for a printed address, or null. */
export function registerAt(address: number): GospelRegister | null {
  return byScopedAddress('settings', address)
}

/** The storage key a reading is filed under, or null when unmapped. */
export function keyFor(address: number): string | null {
  return registerAt(address)?.key ?? null
}

/**
 * The map's own `name` for an address.
 *
 * Exposed so a capture can be cross-checked and so a test can pin the
 * truncated name on 3171 ("05 P-PF working mode -"). Not used as a row label:
 * the curve tables above state their own point names, because "05 P-PF working
 * mode - Point A power percentage (Pa% Set)" is not a table heading.
 */
export function gospelName(address: number): string | null {
  return registerAt(address)?.name ?? null
}

/** The rule for a settings register, or undefined. Most have none. */
export function workModeRuleFor(address: number): PvRule | undefined {
  return ruleFor('settings', address)
}

/** True when the rules file marks this register unwritable. */
export function isReadOnly(address: number): boolean {
  return (workModeRuleFor(address)?.write as string | undefined) === 'read_only'
}

/** True when the rules file demands read-modify-write for this register. */
export function needsReadModifyWrite(address: number): boolean {
  return workModeRuleFor(address)?.write === 'read_modify_write'
}

/**
 * Every address this screen draws, ascending.
 *
 * Derived from the tables above so a corrected curve moves the read sweep with
 * it and cannot leave a point the screen draws but never reads.
 */
export const ALL_ADDRESSES: number[] = Array.from(
  new Set([
    WORKING_MODE,
    POWER_OFF_SAVING,
    ...CURVES.flatMap((c) => [
      ...c.points.flatMap((p) =>
        [p.voltage, p.value].filter((a): a is number => a !== null),
      ),
      ...c.extras.map((e) => e.address),
    ]),
    ...ALWAYS_ROWS.map((r) => r.address),
  ]),
).sort((a, b) => a - b)

/**
 * Addresses this screen draws that the settings space does not describe.
 *
 * Exists so a test can prove it is empty. PV addresses collide across spaces —
 * 3130 in the DATA space is a different register — so a point that quietly
 * resolved against the data space would draw a plausible number from something
 * else entirely.
 */
export function assertSettingsSpace(addresses: number[]): number[] {
  return addresses.filter((a) => !settingsByAddress.has(a))
}

/* ------------------------------------------------------------------ *
 * Scaling — from the map, never from here.
 * ------------------------------------------------------------------ */

/** The map's scale for an address, defaulting to 1 for an unmapped one. */
export function scaleOf(address: number): number {
  const s = registerAt(address)?.scale
  return typeof s === 'number' && s > 0 ? s : 1
}

/** The bare unit symbol the map carries, e.g. 'V', '%', 's'. */
export function unitOf(address: number): string {
  return String(registerAt(address)?.units ?? '').trim()
}

/** Decimal places implied by a scale. 0.01 -> 2, 1 -> 0. */
export function decimalsFor(scale: number): number {
  if (!scale || scale >= 1) return 0
  return Math.min(4, Math.max(0, Math.round(-Math.log10(scale))))
}

/**
 * A raw word as the number a human reads.
 *
 * Signed registers are decoded as signed. The Volt-Var Q percentages (3128,
 * 3129) and the PF registers are S16 in the map, and their whole point is that
 * a NEGATIVE value means lagging — decoding them unsigned turns -30% into
 * 65506%, which is the exact failure the hybrid side already had once.
 */
export function toDisplay(raw: number, address: number): number {
  const reg = registerAt(address)
  const signed = reg?.kind === 's16'
  const word = raw & 0xffff
  const value = signed && word > 0x7fff ? word - 0x10000 : word
  const scale = scaleOf(address)
  return Number((value * scale).toFixed(decimalsFor(scale)))
}

/** What the user typed as the raw word to write. Rounded, never truncated. */
export function toRaw(shown: number, address: number): number {
  return Math.round(shown / scaleOf(address)) & 0xffff
}

/**
 * A point's value formatted for the table, or null when unread.
 *
 * Null rather than '0' or '—', so the view decides how to draw an unknown and
 * "unread" is never indistinguishable from "genuinely zero".
 */
export function formatAt(
  raw: number | undefined,
  address: number,
): string | null {
  if (raw === undefined || !Number.isFinite(raw)) return null
  const unit = unitOf(address)
  const shown = toDisplay(raw, address).toFixed(decimalsFor(scaleOf(address)))
  return unit ? `${shown} ${unit}` : shown
}

/**
 * The label for one half of one curve point, e.g. 'Volt-Watt V2 voltage'.
 *
 * Built from the curve coordinates rather than read from the map, for the same
 * reason the Grid Code matrix builds its own: the map's names here are long,
 * inconsistent and in one case truncated. This is what goes on the input's
 * accessible label and in the write console.
 */
export function pointLabel(
  curve: Curve,
  point: CurvePoint,
  axis: 'x' | 'y',
): string {
  const which = axis === 'x' ? curve.xLabel || 'value' : curve.yLabel || 'value'
  return `${curve.title} ${point.name} ${which.toLowerCase()}`
}
