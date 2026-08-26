/**
 * What the Battery screen decides, as pure functions.
 *
 * The page (`pages/Hybrid/Settings/BatterySetup.tsx`) is JSX and a handful of
 * tokens. Everything that can be WRONG WITHOUT LOOKING WRONG lives here so a
 * test can pin it: which bands exist, when the Battery 2 band disappears, what
 * happens to an edit staged in a band that then disappears, and which bit of
 * 43110 is wake-up.
 *
 * The bands are declared here rather than in the page for one reason: the
 * "drop the hidden band's edits" rule has to be able to ask which edit slots
 * the Battery 2 band owns. Deriving that from the very card the page renders
 * (via `editSlotsOf`) means a row added to the band is covered automatically;
 * a second hand-kept list of battery-2 addresses would drift the first time
 * someone added a row, and would drift silently — the symptom is a stale edit
 * surviving into WRITE ALL, which nothing on screen shows.
 */
import { CardSpec } from './GospelRows'
import { RegisterRule, applyBitChange } from '../../settings/bitRules'
import { editSlotsOf } from './tabModel'

/** Energy Storage Control Switch. Shared with the Storage Mode screen. */
export const STORAGE_CONTROL = 43110

/** Dual-Battery Connection Mode. */
export const CONNECTION_MODE = 43802

/**
 * "Battery 2 Type Setting Follows Battery 1" (43814).
 *
 * NOT an on/off. The gospel's description is explicit: 0xAA55 means follow,
 * "other values" mean do not follow, default 0. SolisCloud shows this as a
 * checkbox called "Apply Batt1 Parameter", which is where the temptation to
 * write 1 comes from — a 1 would land in "other values" and quietly mean the
 * opposite of what the box said.
 */
export const FOLLOW_MAGIC = 0xaa55

/**
 * Bit labels, matched against `hybrid_rules.json` rather than typed as bit
 * numbers. 43110's layout was already corrected once on field evidence
 * (Off-Grid moved into the work-mode selector on 2026-08-20); a page holding
 * literal 3 and 10 would not follow the next correction.
 */
export const WAKEUP_BIT_LABEL = 'Battery Wakeup'
export const HEALING_BIT_LABEL = 'Battery Healing'

/** Special Function Control Word 02. Holds battery saving on BIT02. */
export const SPECIAL_FUNCTION_02 = 43284

/**
 * The rules file spells the polarity out in the label, so the label is matched
 * on its prefix rather than reproduced here — see `bitOf`'s caller.
 *
 * BIT02 is ACTIVE-LOW: v3.5 p60 reads "0: enabled, 1: disabled", the opposite
 * of BIT00 and BIT01 in the same word. A screen that writes 1 to switch
 * battery saving on switches it off. Invert once, at the row, never again.
 */
export const BATTERY_SAVING_BIT_LABEL = 'Battery Saving'

/** Band titles, so the page and the tests agree on one spelling. */
export const BAND_SELECTION = 'SELECTION'
export const BAND_BATTERY_1 = 'BATTERY 1'
export const BAND_BATTERY_2 = 'BATTERY 2'
export const BAND_WAKE_UP = 'WAKE UP'
export const BAND_HEALING = 'HEALING'

/**
 * 43814's two codes.
 *
 * `overrideOptions`, not a `value_map`: the gospel record for 43814 has none —
 * the meaning is prose in its `description`. Delete this the day a `value_map`
 * lands, because a real map already outranks an override in `editorFor`.
 */
export const FOLLOW_BATTERY_1 = {
  address: 43814,
  label: 'Battery 2 follows battery 1',
  overrideOptions: [
    { value: 0, label: 'Do not follow — battery 2 writes take effect' },
    { value: FOLLOW_MAGIC, label: 'Follow battery 1 (0xAA55)' },
  ],
}

/**
 * The five bands, in reading order: what battery, then each battery's limits,
 * then the two behaviours that act on whichever battery is fitted.
 *
 * One card per band and one `RowsPane` column each — see the page for why this
 * is not five tabs.
 */
export const BANDS: CardSpec[] = [
  {
    title: BAND_SELECTION,
    note: '43009 · 43802–43803',
    rows: [
      { address: 43009, label: 'Battery model' },
      { address: 43803, label: 'Battery 2 model' },
      { address: 43802, label: 'Battery connection method' },
    ],
  },
  {
    title: BAND_BATTERY_1,
    note: '43010–43018 · 43117–43118 · 43481',
    rows: [
      { address: 43117, label: 'Max charge current' },
      { address: 43118, label: 'Max discharge current' },
      { address: 43011, label: 'Over-discharge SOC' },
      { address: 43481, label: 'Over-discharge recovery SOC' },
      { address: 43018, label: 'Force-charge SOC' },
      { address: 43010, label: 'Max charge SOC' },
      /* Battery saving used to be edited here as a whole word, because 43284
         had no bitfield rule. It has one now, so it is a bit row rendered
         beside this card — writing the word would clear PV-only load and
         fan low-noise mode along with it. */
    ],
  },
  {
    title: BAND_BATTERY_2,
    note: '43804–43812 · 43814',
    rows: [
      FOLLOW_BATTERY_1,
      { address: 43804, label: 'Max charge current' },
      { address: 43805, label: 'Max discharge current' },
      { address: 43810, label: 'Over-discharge SOC' },
      { address: 43811, label: 'Over-discharge recovery SOC' },
      { address: 43812, label: 'Force-charge SOC' },
    ],
  },
  {
    title: BAND_WAKE_UP,
    note: '43348–43349 · 43376 · 43858–43859 · 43813',
    rows: [
      { address: 43348, label: 'Wake-up voltage' },
      { address: 43349, label: 'Wake-up time' },
      { address: 43376, label: 'Auto wake-up duration' },
      { address: 43858, label: 'Battery 2 wake-up voltage' },
      { address: 43859, label: 'Battery 2 wake-up time' },
      { address: 43813, label: 'Battery 2 auto wake-up duration' },
    ],
  },
  {
    title: BAND_HEALING,
    note: '43482',
    rows: [{ address: 43482, label: 'Healing SOC' }],
  },
]

/**
 * Does this machine have two batteries?
 *
 * Only code 3 (1Batt1DC) means one. Codes 1 and 2 are both dual-battery
 * topologies — 1 gives each battery its own DC port, 2 shares one battery
 * across two ports. Anything else, including an unread register, is treated as
 * two: showing a band that turns out to be irrelevant costs a scroll, whereas
 * hiding the battery-2 settings on a dual-battery machine reads as "this
 * firmware doesn't have them".
 */
export function hasTwoBatteries(connectionRaw: number | undefined): boolean {
  return connectionRaw !== 3
}

/** The bands to RENDER for a given 43802 reading. */
export function bandsFor(connectionRaw: number | undefined): CardSpec[] {
  return hasTwoBatteries(connectionRaw)
    ? BANDS
    : BANDS.filter((b) => b.title !== BAND_BATTERY_2)
}

/**
 * Edits that survive the Battery 2 band disappearing.
 *
 * ONE behaviour, chosen deliberately: a staged battery-2 edit is DROPPED the
 * moment the user declares there is only one battery, and the dropped slots
 * are returned so the page can say so. The alternative — keeping it hidden —
 * means WRITE ALL later sends a current limit for a battery the user just told
 * us is not fitted, with nothing on screen having mentioned it. That is the
 * silent failure this whole screen is trying to avoid.
 *
 * Returns the ORIGINAL object when nothing was dropped, so a re-render caused
 * by an identity change cannot loop.
 */
export function dropHiddenEdits(
  edits: Record<string, number>,
  connectionRaw: number | undefined,
): { edits: Record<string, number>; dropped: string[] } {
  if (hasTwoBatteries(connectionRaw)) return { edits, dropped: [] }

  const hidden = new Set(
    editSlotsOf(BANDS.filter((b) => b.title === BAND_BATTERY_2)),
  )
  const dropped = Object.keys(edits).filter((slot) => hidden.has(slot))
  if (!dropped.length) return { edits, dropped: [] }

  const next = { ...edits }
  for (const slot of dropped) delete next[slot]
  return { edits: next, dropped }
}

/**
 * The bit a rule gives a named switch, or null when it does not name it.
 *
 * Null, never a fallback number: an unfound label means the rules file was
 * reshaped, and rendering a disabled row is honest where writing bit 3 on a
 * guess is not.
 */
export function bitOf(rule: RegisterRule | undefined, label: string): number | null {
  if (!rule) return null
  const from = (labels?: Record<string, string>): number | null => {
    const want = label.trim().toLowerCase()
    for (const [bit, name] of Object.entries(labels ?? {})) {
      /* Prefix, not equality: a rules label may carry a parenthesised note
         after the name — "Battery Saving (active-low: 1 = disabled)" — and the
         polarity belongs in the data where a reader of the map can see it.
         Matching the whole string would drop the row the moment someone
         documents a bit properly. */
      const got = name.trim().toLowerCase()
      if (got === want || got.startsWith(`${want} (`)) return Number(bit)
    }
    return null
  }
  const independent = from(rule.independent_bit_labels)
  if (independent !== null) return independent
  for (const g of rule.bit_groups ?? []) {
    const inGroup = from(g.bit_labels)
    if (inGroup !== null) return inGroup
  }
  return null
}

/**
 * The whole word to write when one named bit is flipped.
 *
 * Delegates to `applyBitChange` so the register's own exclusivity rules apply;
 * the actual preservation of unowned bits happens later, in `useRegisterWrite`,
 * via `ownedMask` + `mergeForWrite`. Both layers matter — this one keeps the
 * bits the rule DOES describe, that one keeps the bits it does not.
 */
export function wordForBit(
  rule: RegisterRule,
  word: number,
  bit: number,
  turnOn: boolean,
): number {
  return applyBitChange(rule, word, bit, turnOn)
}

/* ------------------------------------------------ the one-column row list */

/**
 * A row on the one-column Battery screen.
 *
 * Value rows and bit rows are ONE type rather than two, because the screen
 * renders them in one flat list in installer order. Splitting the type would
 * push the list back into "value rows here, bit rows there" — which is the
 * grouping-by-register mistake this redesign exists to undo.
 */
export interface BatteryRow {
  /** Absolute register. For a bit row, the word the bit lives in. */
  address: number
  label: string
  /**
   * The line under the row: the range note, or what the bit does. Every row
   * has one — that full-width line is the reason the layout is one column.
   */
  description: string
  /** Bit rows name their switch; `bitOf` resolves it against the rules file. */
  bitLabel?: string
  /** True when the bit reads backwards: 0 on the wire means ON to the user. */
  activeLow?: boolean
  /** Options for a register the gospel has no `value_map` for. */
  overrideOptions?: Array<{ value: number; label: string }>
  /** Rows that disappear when 43802 reads 3. */
  battery2?: boolean
}

/**
 * Where battery 2's model list comes from.
 *
 * 43803 has no `value_map` of its own — the gospel documents it as "see
 * Appendix 6: Battery Numbering", which is the same numbering 43009 carries.
 * Borrowing 43009's map is therefore reading the gospel, not inventing a
 * table. A hand-written list here would drift the day a battery is added, and
 * drift SILENTLY, because an unlabelled code still renders as a number.
 */
export const BATTERY_2_MODEL_SOURCE = 43009

/**
 * The screen, top to bottom, in the order an installer works.
 *
 * GROUPED BY JOB, NOT BY REGISTER. Wake-up and healing live in 43110 and
 * saving lives in 43284 — words shared with the Storage Mode screen. They are
 * here anyway, because this is where somebody setting up a battery looks for
 * them. `ownedMask` already lets one bit be written from any screen, so
 * nothing forces bits that share a word onto the same page.
 *
 * NO SUB-HEADINGS. The list is flat; the rail is the only navigation.
 */
export const BATTERY_ROWS: BatteryRow[] = [
  {
    address: 43009,
    label: 'Battery model',
    description:
      'Battery make and model. Codes come from the gospel value map; the shifted Tauri list is rejected.',
  },
  {
    address: 43803,
    label: 'Battery 2 model',
    description:
      'Same numbering as battery 1 (Appendix 6). Dual-battery models only.',
    battery2: true,
  },
  {
    address: 43802,
    label: 'Battery connection method',
    description:
      '1 = 2Batt2DC, two batteries on independent ports. 2 = 1Batt2DC, one battery shared across two ports. 3 = 1Batt1DC, single battery on one port, which hides the battery 2 rows below.',
  },

  {
    address: 43117,
    label: 'Max charge current',
    description:
      'Battery 1 charge current ceiling. Range 0 A up to the maximum this unit supports; S6 allows 0, older series start at 1 A.',
  },
  {
    address: 43118,
    label: 'Max discharge current',
    description:
      'Battery 1 discharge current ceiling. Range 0 A up to the maximum this unit supports.',
  },
  {
    address: 43011,
    label: 'Over-discharge SOC',
    description:
      'Discharging stops once battery 1 falls to this state of charge.',
  },
  {
    address: 43481,
    label: 'Over-discharge recovery SOC',
    description:
      'Range 1-20 %, default 1 %. Discharging resumes once SOC climbs above the over-discharge SOC plus this hysteresis.',
  },
  {
    address: 43018,
    label: 'Force-charge SOC',
    description:
      'Below this state of charge the inverter charges the battery whatever the work mode says.',
  },
  {
    address: 43010,
    label: 'Max charge SOC',
    description: 'Charging stops once battery 1 reaches this state of charge.',
  },

  {
    address: 43814,
    label: 'Battery 2 follows battery 1',
    description:
      'A magic word, NOT an on/off: 0xAA55 means follow, and makes writes to the battery 2 registers inert. Any other value means do not follow. Writing 1 would land in "other values" and mean the opposite of what the label says.',
    overrideOptions: FOLLOW_BATTERY_1.overrideOptions,
    battery2: true,
  },
  {
    address: 43804,
    label: 'Battery 2 max charge current',
    description:
      'Battery 2 charge current ceiling, up to the maximum this unit supports.',
    battery2: true,
  },
  {
    address: 43805,
    label: 'Battery 2 max discharge current',
    description:
      'Battery 2 discharge current ceiling, up to the maximum this unit supports.',
    battery2: true,
  },
  {
    address: 43810,
    label: 'Battery 2 over-discharge SOC',
    description:
      'Discharging stops once battery 2 falls to this state of charge.',
    battery2: true,
  },
  {
    address: 43811,
    label: 'Battery 2 over-discharge recovery SOC',
    description:
      'Hysteresis above the battery 2 over-discharge SOC before discharging resumes.',
    battery2: true,
  },
  {
    address: 43812,
    label: 'Battery 2 force-charge SOC',
    description:
      'Below this state of charge battery 2 is charged whatever the work mode says.',
    battery2: true,
  },

  {
    address: STORAGE_CONTROL,
    label: 'Battery wake-up',
    bitLabel: WAKEUP_BIT_LABEL,
    description:
      'Bit switch inside 43110. Lets the inverter pulse a battery whose BMS has shut down on low voltage, so it can be charged back up instead of needing a manual reset.',
  },
  {
    address: 43348,
    label: 'Wake-up voltage',
    description:
      'Wake-up starts below this battery voltage. Low-voltage 40-60 V (default 40 V); single-phase HV 120-500 V; three-phase HV 120-600 V (default 120 V).',
  },
  {
    address: 43349,
    label: 'Wake-up time',
    description:
      'Range 20-3600 s, default 20 s. How long the wake-up pulse runs.',
  },
  {
    address: 43376,
    label: 'Auto wake-up duration',
    description:
      'Range 20-3600 s on most S6 models (20-300 s on the single-phase HV 11.4 kW US models), default 180 s.',
  },
  {
    address: 43858,
    label: 'Battery 2 wake-up voltage',
    description:
      'Same ranges as battery 1: low-voltage 40-60 V, high-voltage 120-500/600 V.',
    battery2: true,
  },
  {
    address: 43859,
    label: 'Battery 2 wake-up time',
    description: 'Range 20-3600 s, default 20 s.',
    battery2: true,
  },
  {
    address: 43813,
    label: 'Battery 2 auto wake-up duration',
    description: 'Range 20-3600 s, default 180 s.',
    battery2: true,
  },

  {
    address: STORAGE_CONTROL,
    label: 'Battery healing',
    bitLabel: HEALING_BIT_LABEL,
    description:
      'Bit switch inside 43110. Periodically charges the pack up to the healing SOC below, so the BMS can re-balance its cells and re-learn their capacity.',
  },
  {
    address: 43482,
    label: 'Healing SOC',
    description:
      'Range 80-100 %, default 100 %. The state of charge a healing cycle charges up to.',
  },

  {
    address: SPECIAL_FUNCTION_02,
    label: 'Battery saving',
    bitLabel: BATTERY_SAVING_BIT_LABEL,
    activeLow: true,
    description:
      'Bit switch inside 43284, and ACTIVE-LOW on the wire: 0 = enabled, 1 = disabled. The toggle reads the way you expect; the inversion happens once. Shares its word with PV-only load and fan low-noise mode, so the write is read-modify-write.',
  },
]

/** The rows to RENDER for a given 43802 reading. See `hasTwoBatteries`. */
export function rowsFor(connectionRaw: number | undefined): BatteryRow[] {
  return hasTwoBatteries(connectionRaw)
    ? BATTERY_ROWS
    : BATTERY_ROWS.filter((r) => !r.battery2)
}

/**
 * Every register the screen reads, including the rows that can be hidden.
 *
 * Built from ALL rows, never from `rowsFor(...)`: 43802 cannot be known to
 * read 3 until the block holding it has been fetched, so the range row has to
 * ask for the battery 2 block regardless of what is on screen.
 */
export function batteryAddresses(): number[] {
  return Array.from(new Set(BATTERY_ROWS.map((r) => r.address))).sort(
    (a, b) => a - b,
  )
}

/**
 * The edit slot a row stages into.
 *
 * NOT just the address. 43110 carries TWO rows on this screen — battery
 * wake-up and battery healing — because the screen is grouped by job and both
 * switches belong beside the battery. Keying edits by address alone would give
 * them one shared slot: staging wake-up would light healing up as dirty, and
 * saving healing would send the wake-up row's word. Both rows still write the
 * same register, and `ownedMask` still decides which bits each one may touch;
 * only the STAGING is separated here.
 */
export function slotOf(row: BatteryRow): string {
  return row.bitLabel ? `${row.address}:${row.bitLabel}` : String(row.address)
}

/**
 * The edit slots the battery 2 rows own, in the one-column list.
 *
 * Derived from the rows the page actually renders, so a battery 2 row added
 * later is covered automatically. A second hand-kept list of addresses would
 * drift the first time somebody added a row, and drift silently — the symptom
 * is a stale battery 2 edit surviving a switch to 1Batt1DC, which nothing on
 * screen shows.
 */
export function battery2Slots(): string[] {
  return BATTERY_ROWS.filter((r) => r.battery2).map(slotOf)
}

/**
 * Edits that survive the battery 2 rows disappearing, for the one-column list.
 *
 * Same rule and same reasoning as `dropHiddenEdits` — a staged battery 2 edit
 * is DROPPED the moment the user declares a single battery, and the dropped
 * slots come back so the page can say so. Keeping it hidden would mean a later
 * Save sends a limit for a battery the user just said is not fitted.
 *
 * Returns the ORIGINAL object when nothing was dropped, so a re-render caused
 * by an identity change cannot loop.
 */
export function dropHiddenRowEdits(
  edits: Record<string, number>,
  connectionRaw: number | undefined,
): { edits: Record<string, number>; dropped: string[] } {
  if (hasTwoBatteries(connectionRaw)) return { edits, dropped: [] }

  const hidden = new Set(battery2Slots())
  const dropped = Object.keys(edits).filter((slot) => hidden.has(slot))
  if (!dropped.length) return { edits, dropped: [] }

  const next = { ...edits }
  for (const slot of dropped) delete next[slot]
  return { edits: next, dropped }
}
