/**
 * The register maths behind PV Frequency Derating, with no React in it.
 *
 * THE MODE GATES EVERYTHING — read this first
 * ------------------------------------------
 * Register 3400 picks ONE frequency-derating mode, and that choice decides
 * which of the fourteen registers below it the inverter actually reads. This
 * is not a presentation detail; it is the whole subject. 3405 is the
 * over-frequency start point under modes 01/03/04/08/09/0A/0C/11/12/13/14 and
 * is INERT under 0E, where 3413 does that job instead. Two registers, one
 * meaning, and which one is live depends entirely on a third.
 *
 * SolisCloud draws four rows — the mode, then Fstart, Fstop and the response
 * delay, each prefixed "04-". That prefix is the only thing on the page
 * saying those three are mode 04's registers, and it is a label, not a
 * behaviour: the page shows them identically whatever 3400 reads. So an
 * installer commissioning a VDE4110 machine (mode 03) is invited to type into
 * an Fstop box the inverter will never consult, gets an ACK, and reasonably
 * concludes the setting took. It did. It just does nothing.
 *
 * This model refuses to draw a row as live when it is not. `rowsForMode()`
 * marks each row active or inactive against the mode currently read from
 * 3400, exactly as the Work Mode screen greys the curves that are not the
 * selected mode.
 *
 * WHERE THE MODE LISTS COME FROM — parsed, never typed
 * ---------------------------------------------------
 * The gospel `name` on each of these registers carries its own applicability
 * list. They read like:
 *
 *   "Overfrequency Derating Fstop Mode： 01H/09H (D02-03) 04H/14H(D08-09),08H(D14-15)"
 *
 * The `Mode：` prefix introduces the modes; the `(Dnn-nn)` groups are document
 * byte offsets and are noise here. `modesFor()` strips the parenthesised
 * groups and harvests the `NNH` tokens from what is left. That is a PARSE of
 * the map, not a transcription of it — a corrected name moves the gating
 * without an edit to this file, which is the only way "the map is the source"
 * actually holds.
 *
 * The parse has to survive PDF line-wrapping. The V19 extraction contains
 * "01H/03H/0AH/0CH/11H/12H/1 3H" — a space injected mid-token by the column
 * break. The token pattern therefore tolerates internal whitespace, which is
 * why `13H` is recovered rather than silently dropped. Dropping it would have
 * made the Hawaii mode look inapplicable to a register it governs.
 *
 * `H` is also a letter that starts real words in these names — "HystEna",
 * "HystEnable", "HystFrequency". The pattern rejects an `H` followed by a
 * lower-case letter for that reason. Without the guard, "0E Mode EN50549 -
 * ... HystEnable" yields a phantom mode.
 *
 * Two registers state their modes without the `Mode：` marker (3419 opens
 * "0EH/08H mode over-frequency load reduction"), so the parse falls back to
 * scanning the whole name. The fallback is safe because the token pattern is
 * narrow: 3400's own name, "Frequency Derating Mode", yields nothing.
 *
 * THE ENUM IS PROSE, AND IT IS INCOMPLETE — the honest part of this file
 * ---------------------------------------------------------------------
 * 3400 has `value_map: null`. There is no machine-readable enumeration for it
 * in the PV map at all. What exists is a `description` that states
 * "Range：00-14H Default 00" and then spells out seven modes in prose:
 * 00 No requirement, 01 Australia, 02 Reserved, 03 VDE4105/NTS631/VDE4110/
 * EN50438/Polish NC_RFG, 04 US Rule 21 and Brazil Act 140, 05 Brazil, 06
 * South Africa. The list stops at 06. The stated range does not.
 *
 * `modeOptions()` parses those seven out of the prose, and that is the
 * complete set of LABELLED modes this map can support. But the register names
 * above cite thirteen modes, ten of which the description never names:
 * 08H, 09H, 0AH, 0CH, 0DH, 0EH, 11H, 12H, 13H and 14H. Those are real — 0E is
 * plainly EN50549, since five registers say "EN50549" and "0EH" in the same
 * breath — but "plainly" is not a source, and this file does not invent a
 * label for a mode the map declines to name.
 *
 * So an undocumented mode is offered as `0DH` with `documented: false` and no
 * invented name. It is offered rather than hidden because the machine accepts
 * the whole 00-14H range and a screen that could not select 0E could not
 * commission an EN50549 site at all. It is MARKED rather than labelled
 * because guessing "0D = Italy" is exactly the failure mode the corrections
 * file exists to record. The screen says which modes it is guessing at; it
 * does not guess.
 *
 * WHY THE WHOLE FAMILY IS HERE, NOT JUST SolisCloud'S FOUR ROWS
 * ------------------------------------------------------------
 * SolisCloud shows mode 04's three registers. The map holds fourteen, in four
 * coherent groups. Showing three of fourteen and calling the page "Frequency
 * Derating Setting" is how 3413 ends up believed not to exist — which is the
 * same mistake that put six registers on the EPM screen SolisCloud does not
 * put on EPM.
 *
 * THIRTEEN OF THE FOURTEEN ARE READABLE. `pvSettingsMapper` covers offsets
 * 400-418, so 3400-3418 all fill. 3419 does NOT — it is one past the end of
 * the key table, so its reply word is received and discarded. It is drawn as
 * unreachable rather than as an empty box, via `isReachable()`. That is a
 * limit of THIS APP, not of the inverter: the register is documented and the
 * machine honours it.
 *
 * Grouped as the map groups them:
 *   OVER-FREQUENCY   3404 droop, 3405 Fstart, 3407 Fstop, 3408 hysteresis
 *                    enable, 3403 response time, 3418 response delay
 *   UNDER-FREQUENCY  3401 Fstart, 3402 droop, 3410 Fstop
 *   EN50549 (0E)     3413 f1, 3414 HystEnable, 3415 fstop, 3416 Tstop,
 *                    3417 droop  — a complete parallel set for one mode
 *   LOAD SHEDDING    3419 minimum power under 0E/08
 *
 * 3406, 3409, 3411 and 3412 are NOT in the map. The gaps are real gaps in the
 * document, not omissions here, and nothing is drawn for them.
 *
 * WHAT IS NOT SUBSTANTIATED
 * -------------------------
 * 3402's scale is `0` in the map with unit ".1%". A scale of zero would make
 * every reading zero, so it cannot be applied as written. `scaleFor()`
 * reports it as suspect rather than substituting a value: the description
 * says "1->0.01%", which argues for 0.01, but the unit says ".1%", which
 * argues for 0.1, and those differ by a factor of ten on a droop slope. The
 * screen shows the raw word and says the scale is unresolved, the same
 * refusal `pvGridCodeModel` makes for an unread precision flag.
 *
 * PRINTED ADDRESSES ONLY. `usePvRegisterWrite` performs the PV -1 and is the
 * only place it happens. Nothing here subtracts one.
 */
import {
  byScopedAddress,
  type GospelRegister,
} from '../../gospel/pvGospel'
import { ruleFor } from '../../gospel/pvRules'
import { group } from './captures'

/* ------------------------------------------------------------------ *
 * Addresses. PRINTED, always.
 * ------------------------------------------------------------------ */

/** The mode selector. Everything below it is gated on this word. */
export const DERATING_MODE = 3400

/** Over-frequency group. */
export const OF_RESPONSE_TIME = 3403
export const OF_DROOP = 3404
export const OF_FSTART = 3405
export const OF_FSTOP = 3407
export const OF_HYST_ENABLE = 3408
export const OF_RESPONSE_DELAY = 3418

/** Under-frequency ramping group. */
export const UF_FSTART = 3401
export const UF_DROOP = 3402
export const UF_FSTOP = 3410

/** EN50549 (mode 0E) parallel set. */
export const EN50549_F1 = 3413
export const EN50549_HYST_ENABLE = 3414
export const EN50549_FSTOP = 3415
export const EN50549_TSTOP = 3416
export const EN50549_DROOP = 3417

/** Over-frequency load shedding floor. */
export const LOAD_SHED_MIN_POWER = 3419

/**
 * Addresses the document does NOT describe, recorded so their absence reads
 * as a fact about the map rather than as an oversight here.
 *
 * A reader looking at 3405 then 3407 will ask where 3406 went. It is not in
 * the settings space at all — see the test that pins this.
 */
export const ABSENT_IN_MAP: readonly number[] = [3406, 3409, 3411, 3412]

/** The gospel record for a PV settings register, or null. */
export const settingReg = (address: number): GospelRegister | null =>
  byScopedAddress('settings', address)

/**
 * Can this app actually READ the register?
 *
 * This app files a PV settings reply word only if `pvSettingsMapper` has a
 * key for that register. Thirteen of the fourteen here do. 3419 does NOT —
 * the mapper stops at offset 418, and 3419 would be offset 419.
 *
 * So 3419's reply word is received and discarded, and a row drawn for it
 * would say "not read" forever no matter how many times the button is
 * pressed. Rather than let it sit there poisoning the reader's trust in the
 * twelve rows around it that work, the row is drawn as unreachable with the
 * reason stated — the same choice `pvFanControlModel` made, and for the same
 * reason.
 *
 * Answered from the mapper at RUNTIME rather than written down, so extending
 * the key table turns the row on with no edit here, and dropping a key turns
 * a working row into an honest one instead of a broken one.
 *
 * THE KEY TABLE IS THE CALLER'S, NOT OURS. Which keys an app files a reply
 * under is a property of that app's transport, and the two apps need not
 * agree: a register unreachable in the extension's legacy key table may be
 * perfectly readable in SolisConnect. Hard-coding one app's table here would
 * draw the other app's working rows as unreachable. So the caller passes its
 * own key set -- `pvSettingsMapper` in the extension -- and the question is
 * answered against that.
 */
export function isReachable(
  address: number,
  keys: Readonly<Record<string, unknown>> | ReadonlySet<string>,
): boolean {
  const key = settingReg(address)?.key
  if (key === undefined) return false
  return keys instanceof Set ? keys.has(key) : key in keys
}

/* ------------------------------------------------------------------ *
 * Mode parsing — the gate
 * ------------------------------------------------------------------ */

/**
 * One mode code, normalised to the form the documents print: `04H`, `0EH`.
 *
 * Kept as the printed STRING rather than a number because that is how every
 * name, every description and every SolisCloud row label writes it, and a
 * screen that says "mode 14" when the document says "14H" invites someone to
 * read it as decimal fourteen. The numeric value is available through
 * `modeValue()` when a write needs it.
 */
export type ModeCode = string

/**
 * A hex mode token: one or two hex digits then `H`.
 *
 * Two guards earn their place, both proven in the test:
 *
 *  - `\s*` INSIDE the token, because the PDF extraction wraps mid-token and
 *    produces "1 3H" for 13H.
 *  - `(?![A-Za-z])` after the H, because "HystEna" and "HystEnable" would
 *    otherwise contribute a phantom mode from their leading letters.
 */
const MODE_TOKEN = /([0-9A-Fa-f])\s*([0-9A-Fa-f])?\s*H(?![A-Za-z])/g

/** `0e` / `0 EH` / `EH` -> `0EH`. */
const normaliseMode = (a: string, b?: string): ModeCode => {
  const digits = (b === undefined ? a : a + b).toUpperCase()
  return `${digits.padStart(2, '0')}H`
}

/** The numeric value of a mode code. `0EH` -> 14. */
export function modeValue(code: ModeCode): number {
  return parseInt(code.replace(/H$/i, ''), 16)
}

/** A numeric mode word as its printed code. 14 -> `0EH`. */
export function modeCode(value: number): ModeCode {
  return `${value.toString(16).toUpperCase().padStart(2, '0')}H`
}

/**
 * The modes a register's gospel `name` says it applies to.
 *
 * Empty when the name names none — which for 3400 itself is correct, since
 * the mode selector is not gated by a mode.
 *
 * The `(Dnn-nn)` groups are stripped BEFORE the scan. They are document byte
 * offsets, and `(D02-03)` contains no mode token, but `(B9_D54-55)` on 3419
 * does not either — stripping them is belt and braces against a future name
 * whose offsets could be misread as modes.
 */
export function modesFor(address: number): ModeCode[] {
  const name = settingReg(address)?.name
  if (!name) return []

  /* Both bracket families: the documents mix ASCII and full-width. */
  const stripped = name.replace(/\([^)]*\)/g, ' ').replace(/（[^）]*）/g, ' ')

  /*
   * Prefer the text after `Mode：`, which is where the list belongs. Fall
   * back to the whole name for the two registers that state their modes
   * without the marker (3419 opens "0EH/08H mode ..."). The fallback is safe
   * only because MODE_TOKEN is narrow enough that an ordinary name yields
   * nothing — pinned in the test against 3400.
   */
  const marker = stripped.search(/Mode\s*[：:]/)
  const scanned = marker >= 0 ? stripped.slice(marker) : stripped

  const seen = new Set<ModeCode>()
  for (const m of scanned.matchAll(MODE_TOKEN)) {
    seen.add(normaliseMode(group(m, 1), group(m, 2)))
  }
  return [...seen].sort((a, b) => modeValue(a) - modeValue(b))
}

/**
 * Is this register live under the mode currently in 3400?
 *
 * `null` mode means 3400 has not been read. That is NOT "inactive" — it is
 * "unknown", and the screen must say so rather than greying every row and
 * implying the inverter is doing nothing. A register whose name lists no
 * modes at all is always active: it is not gated.
 */
export function isActiveUnder(
  address: number,
  mode: ModeCode | null,
): boolean | null {
  const modes = modesFor(address)
  if (modes.length === 0) return true
  if (mode === null) return null
  return modes.includes(mode)
}

/* ------------------------------------------------------------------ *
 * The mode enumeration, parsed out of 3400's prose description
 * ------------------------------------------------------------------ */

export interface ModeOption {
  /** Printed form, `04H`. */
  code: ModeCode
  /** Numeric word written to 3400. */
  value: number
  /**
   * The document's own words, or null when the description never names it.
   *
   * Null is load-bearing: it is the difference between a mode this map
   * describes and one it merely admits exists. Never filled in by guessing.
   */
  label: string | null
  /** False when the description does not name this mode. */
  documented: boolean
  /** True when some register's name cites this mode as gating it. */
  cited: boolean
}

/**
 * 3400's stated range, parsed from its description. Null when unstated.
 *
 * BOTH ENDS ARE HEX. The description writes "Range：00-14H" — one trailing
 * `H` covering the pair, in the same style as every mode token on this
 * screen. Reading `14` as decimal twenty is a real and silent error: it
 * yields a 0-20 span that OMITS 0AH, 0CH, 0DH and 0EH — the EN50549 mode
 * five registers on this very screen are gated by — while inventing decimal
 * 10 and 13 as `10H` and `13H`. The generated options were wrong in exactly
 * that way before the test below pinned it.
 */
export function modeRange(): { min: number; max: number } | null {
  const d = settingReg(DERATING_MODE)?.description
  if (!d) return null
  const m = d.match(/Range\s*[：:]\s*([0-9A-Fa-f]{1,2})\s*-+\s*([0-9A-Fa-f]{1,2})\s*H/)
  if (!m) return null
  return { min: parseInt(group(m, 1), 16), max: parseInt(group(m, 2), 16) }
}

/** 3400's stated default, parsed from its description. Null when unstated. */
export function modeDefault(): number | null {
  const d = settingReg(DERATING_MODE)?.description
  const m = d?.match(/Default\s*([0-9A-Fa-f]{1,2})\s*H?/)
  return m ? parseInt(group(m, 1), 16) : null
}

/**
 * The modes the description actually names, as `value -> label`.
 *
 * The prose runs them together — "00---No requirement 01---Australia
 * requirement ... 02--- Reserved。" — so each entry is taken as everything up
 * to the next `NN---`. Trailing full-width punctuation and the dangling
 * opening bracket from "（00---" are trimmed; nothing else is rewritten.
 */
function documentedModes(): Map<number, string> {
  const out = new Map<number, string>()
  const d = settingReg(DERATING_MODE)?.description
  if (!d) return out
  const re = /(\d{2})-{2,}\s*([\s\S]*?)(?=\s*\d{2}-{2,}|\s*$)/g
  for (const m of d.matchAll(re)) {
    const label = group(m, 2)
      .replace(/\s+/g, ' ')
      .replace(/[（(]\s*$/, '')
      .replace(/[。、,\s]+$/, '')
      .trim()
    if (label) out.set(parseInt(group(m, 1), 16), label)
  }
  return out
}

/** Every mode any register on this screen cites as gating it. */
export function citedModes(): ModeCode[] {
  const seen = new Set<ModeCode>()
  for (const address of GATED_ADDRESSES) {
    for (const code of modesFor(address)) seen.add(code)
  }
  return [...seen].sort((a, b) => modeValue(a) - modeValue(b))
}

/**
 * Every mode the screen offers, in numeric order.
 *
 * The union of three sources, in decreasing authority:
 *   1. the modes the description NAMES (labelled, documented)
 *   2. the modes register names CITE (unlabelled, but proven to exist by the
 *      fact that a register declares itself gated by them)
 *   3. the stated 00-14H range, so a mode neither named nor cited is still
 *      selectable on a machine whose firmware has one
 *
 * A mode from source 2 or 3 gets no invented label. See the file header.
 */
export function modeOptions(): ModeOption[] {
  const documented = documentedModes()
  const cited = new Set(citedModes().map(modeValue))
  const range = modeRange()

  const values = new Set<number>([...documented.keys(), ...cited])
  if (range) {
    for (let v = range.min; v <= range.max; v++) values.add(v)
  }

  return [...values]
    .sort((a, b) => a - b)
    .map((value) => ({
      code: modeCode(value),
      value,
      label: documented.get(value) ?? null,
      documented: documented.has(value),
      cited: cited.has(value),
    }))
}

/** The option for a raw word, or null when it is outside everything known. */
export function modeOptionFor(raw: number | undefined): ModeOption | null {
  if (raw === undefined) return null
  return modeOptions().find((o) => o.value === raw) ?? null
}

/**
 * What to show for the current mode: its label, or its code when unnamed.
 *
 * Never blank for an in-range word. "Mode 0EH (not named in this map)" is a
 * usable fact; an empty box is not.
 */
export function modeSummary(raw: number | undefined): string | null {
  if (raw === undefined) return null
  const option = modeOptionFor(raw)
  if (!option) return `${modeCode(raw)} — outside the documented range`
  if (option.label) return `${option.code} — ${option.label}`
  return `${option.code} — not named in this map`
}

/* ------------------------------------------------------------------ *
 * Scale, unit and the one register whose scale is unusable
 * ------------------------------------------------------------------ */

/**
 * The scale to apply, or null when the map's scale cannot be used.
 *
 * Null happens for exactly one register today: 3402's scale is `0`, which
 * would render every reading as zero and write every value as zero. See the
 * header for why it is refused rather than corrected. A null scale means the
 * screen shows the RAW word and disables the editor — the same refusal
 * `pvGridCodeModel` makes when the precision flag is unread.
 */
export function scaleFor(address: number): number | null {
  const scale = settingReg(address)?.scale
  if (typeof scale !== 'number' || !Number.isFinite(scale)) return null
  if (scale === 0) return null
  return scale
}

/** The map's unit for a register, trimmed. Empty string when it has none. */
export function unitFor(address: number): string {
  return String(settingReg(address)?.units ?? '').trim()
}

/** Decimals implied by a scale. 0.01 -> 2, 1 -> 0. */
export function decimalsFor(scale: number | null): number {
  if (scale === null || scale >= 1) return 0
  return Math.max(0, Math.round(-Math.log10(scale)))
}

/** A raw word as its scaled, fixed-decimal string. Null when unusable. */
export function formatValue(
  raw: number | undefined,
  scale: number | null,
): string | null {
  if (raw === undefined) return null
  if (scale === null) return String(raw)
  return (raw * scale).toFixed(decimalsFor(scale))
}

/** A typed value back to the raw word. Identity when the scale is unusable. */
export function toRaw(value: number, scale: number | null): number {
  if (scale === null) return Math.round(value)
  return Math.round(value / scale)
}

/**
 * The rules file says this register cannot be written.
 *
 * The cast matches `pvGridCodeModel.isReadOnly` and is deliberate:
 * `PvWriteMode` does not currently include `'read_only'`, so the comparison
 * is a type error without it. The check is kept rather than dropped because
 * the RULES FILE is the authority on writability and may gain the mode
 * without the union being updated in the same change — and the failure that
 * protects against is an editable box over a register the machine will
 * refuse.
 */
export function isReadOnly(address: number): boolean {
  return (
    (ruleFor('settings', address)?.write as string | undefined) === 'read_only'
  )
}

/* ------------------------------------------------------------------ *
 * The rows, grouped as the map groups them
 * ------------------------------------------------------------------ */

export interface DeratingRow {
  address: number
  /**
   * The short label this screen shows.
   *
   * The gospel `name` cannot be used directly: it is a name with an
   * applicability list welded onto it ("Overfrequency Derating Fstop Mode：
   * 01H/09H (D02-03) 04H/14H..."), and printing that as a row label puts the
   * gating in the one place the reader cannot act on it. The list is parsed
   * out and shown as the row's own mode chips instead; this is the name with
   * that tail removed, derived rather than retyped.
   */
  label: string
  /** The full gospel name, for the tooltip. */
  gospelName: string
  /** Modes this row is live under. Empty means ungated. */
  modes: ModeCode[]
}

export interface DeratingGroup {
  id: string
  title: string
  note: string
  rows: DeratingRow[]
}

/**
 * A row label: the gospel name with its `Mode：…` tail cut off.
 *
 * Everything from `Mode：` onward is the applicability list, which the row
 * renders as chips. What remains is the register's actual name. The trailing
 * separator characters the cut can leave behind ("Overfrequency Derating_ ")
 * are trimmed.
 */
export function rowLabel(address: number): string {
  const name = settingReg(address)?.name ?? String(address)
  const marker = name.search(/Mode\s*[：:]/)
  const head = marker >= 0 ? name.slice(0, marker) : name
  return head.replace(/[\s_\-–—]+$/, '').trim() || String(address)
}

/** One row, assembled from the map. */
function row(address: number): DeratingRow {
  return {
    address,
    label: rowLabel(address),
    gospelName: settingReg(address)?.name ?? '',
    modes: modesFor(address),
  }
}

/**
 * The four groups, in commissioning order.
 *
 * Over-frequency first because it is what SolisCloud's page is about and what
 * every mode in the enumeration mentions. Under-frequency second — only three
 * modes ramp on under-frequency at all. EN50549 third as a self-contained set
 * for one mode. Load shedding last: it is a floor on the derate, not a
 * threshold that starts one.
 */
export const DERATING_GROUPS: readonly DeratingGroup[] = [
  {
    id: 'over',
    title: 'Over-frequency derating',
    note: 'Power is reduced as frequency rises. Fstart begins the derate; the droop sets how steeply.',
    rows: [
      row(OF_FSTART),
      row(OF_FSTOP),
      row(OF_DROOP),
      row(OF_HYST_ENABLE),
      row(OF_RESPONSE_TIME),
      row(OF_RESPONSE_DELAY),
    ],
  },
  {
    id: 'under',
    title: 'Under-frequency ramping',
    note: 'The mirror of the above: power is raised back as frequency falls. Only a few modes ramp at all.',
    rows: [row(UF_FSTART), row(UF_FSTOP), row(UF_DROOP)],
  },
  {
    id: 'en50549',
    title: 'EN50549 set (mode 0EH)',
    note: 'A complete parallel set of over-frequency registers used only by mode 0EH. Under any other mode the group above is the live one.',
    rows: [
      row(EN50549_F1),
      row(EN50549_FSTOP),
      row(EN50549_HYST_ENABLE),
      row(EN50549_TSTOP),
      row(EN50549_DROOP),
    ],
  },
  {
    id: 'shed',
    title: 'Over-frequency load shedding',
    note: 'The floor the derate will not go below.',
    rows: [row(LOAD_SHED_MIN_POWER)],
  },
]

/** Every gated address, in the order the groups draw them. */
export const GATED_ADDRESSES: readonly number[] = DERATING_GROUPS.flatMap((g) =>
  g.rows.map((r) => r.address),
)

/** Every address this screen reads, mode selector included. */
export const ALL_ADDRESSES: readonly number[] = [
  DERATING_MODE,
  ...GATED_ADDRESSES,
]

/**
 * The groups with each row resolved against the current mode.
 *
 * `active: null` means 3400 is unread and applicability is UNKNOWN. The
 * screen draws that differently from a known-inactive row, because "we have
 * not looked" and "this does nothing" are different things to tell someone
 * about to change a grid protection setting.
 */
export interface ResolvedRow extends DeratingRow {
  active: boolean | null
}

export interface ResolvedGroup extends Omit<DeratingGroup, 'rows'> {
  rows: ResolvedRow[]
  /** True when no row in this group is live under the current mode. */
  dormant: boolean
}

export function rowsForMode(mode: ModeCode | null): ResolvedGroup[] {
  return DERATING_GROUPS.map((group) => {
    const rows = group.rows.map((r) => ({
      ...r,
      active: isActiveUnder(r.address, mode),
    }))
    return {
      ...group,
      rows,
      dormant: mode !== null && rows.every((r) => r.active === false),
    }
  })
}

/** How many rows the current mode actually makes live. */
export function activeCount(mode: ModeCode | null): number {
  if (mode === null) return 0
  return GATED_ADDRESSES.filter((a) => isActiveUnder(a, mode) === true).length
}
