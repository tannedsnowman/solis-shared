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
 * ONLY code 1. The gospel's own value map settles it: code 1 is "2Batt2DC -
 * Battery Independent", two packs each on their own DC port. Code 2 is
 * "1Batt2DC - Battery Shared" — ONE battery wired across two ports — and code
 * 3 is "1Batt1DC", one battery on one port. Both of those are single-battery
 * machines whatever the register's "Dual-Battery Connection Mode" name
 * suggests, and neither has a second pack to set limits for.
 *
 * An earlier version tested `!== 3` and so treated code 2 as dual. That put a
 * full set of battery 2 rows on a shared-battery install, where every one of
 * them writes a limit for a pack that is not there.
 *
 * AN UNREAD REGISTER IS NOT TWO BATTERIES. It is not one either — it is
 * unknown, and the honest thing to do with unknown is show nothing rather than
 * guess. The earlier reasoning was that hiding the rows might read as "this
 * firmware lacks them"; but they appear the instant 43802 is read, whereas a
 * screen of battery 2 settings on what is usually a single-battery machine is
 * the louder lie — and it invites an edit that `dropHiddenRowEdits` then has
 * to throw away the moment the read lands.
 */
export function hasTwoBatteries(connectionRaw: number | undefined): boolean {
  return connectionRaw === 1
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
  /**
   * A battery 2 row that SURVIVES "battery 2 follows battery 1" (43814).
   *
   * Follow mode makes battery 2's limits inert — the charge current, the SOC
   * thresholds and the protection voltages are all taken from battery 1, so
   * showing them invites an edit that writes to a register the firmware then
   * ignores. Those rows are hidden.
   *
   * WAKE-UP IS THE EXCEPTION, and it is a real one. Waking a pack whose BMS
   * has shut down is a per-pack act: battery 2 has its own voltage, its own
   * contactor and its own dead BMS, and follow mode does not change that. An
   * installer recovering a flat second pack needs 43858/43859/43813 whatever
   * 43814 says.
   *
   * Only meaningful on a row that is already `battery2`.
   */
  keepWhenFollowing?: boolean
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
      'Only 1 = 2Batt2DC is genuinely two packs, each on its own DC port, and only it shows the battery 2 rows. 2 = 1Batt2DC is ONE battery shared across two ports, and 3 = 1Batt1DC is one battery on one port — both hide them. Until this register has been read the battery 2 rows stay hidden.',
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
  /* THE SECOND CURRENT PAIR. 43012/43013 are the same two limits as
     43117/43118, exactly as 43014-43017 twin 43119-43122 on the voltage side,
     and with different ranges again (43012 starts at 50 A on LV, 43117 at 1 A).
     Both are shown for the same reason: which pair a firmware honours is a
     model question, and hiding one silently hides the register that matters. */
  {
    address: 43012,
    label: 'Max charge current (43012)',
    description:
      'The second charge current limit, at 43012 rather than 43117. LV hybrid 50.0-100.0 A (default 62.5 A); HV hybrid 5.0-100.0 A (default 25.0 A). Read the value back to see which pair this firmware moved.',
  },
  {
    address: 43013,
    label: 'Max discharge current (43013)',
    description:
      'The second discharge current limit, at 43013 rather than 43118. LV hybrid 50.0-100.0 A (default 62.5 A); HV hybrid 5.0-100.0 A (default 25.0 A).',
  },
  {
    address: 43116,
    label: 'Battery charge and discharge current',
    description:
      'One limit governing both directions, range 0 up to the unit rating. Older firmware exposes this instead of the separate charge and discharge pair.',
  },
  {
    address: 43342,
    label: 'Max grid charging current',
    description:
      'The ceiling on charging FROM THE GRID specifically, range 0-100 A, default 80 A. Capped in turn by the max charge current above — raising this past that does nothing.',
  },
  {
    address: 43862,
    label: 'PCS input limit battery current',
    description:
      'Charge-from-grid current ceiling while the PCS limiting mode is set to input limit. Range 0 A up to the model maximum, defaulting to it. Survives a power cut.',
  },
  {
    address: 43863,
    label: 'PCS output limit battery current',
    description:
      'Discharge-to-grid current ceiling while the PCS limiting mode is set to output limit. Range 0 A up to the model maximum, defaulting to it.',
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
    /* THE SWITCH THAT DOES THE HIDING MUST NOT HIDE ITSELF. Follow mode hides
       battery 2's limits, and 43814 is the register that turns it off again —
       hide it too and the setting is a one-way door with no control on screen
       to undo it. It still goes when 43802 says one battery, because then
       there is genuinely no second pack to follow anything. */
    keepWhenFollowing: true,
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
    keepWhenFollowing: true,
  },
  {
    address: 43859,
    label: 'Battery 2 wake-up time',
    description: 'Range 20-3600 s, default 20 s.',
    battery2: true,
    keepWhenFollowing: true,
  },
  {
    address: 43813,
    label: 'Battery 2 auto wake-up duration',
    description: 'Range 20-3600 s, default 180 s.',
    battery2: true,
    keepWhenFollowing: true,
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

  /* ------------------------------------------------- voltage thresholds
     TWO PARALLEL SETS, both shown, neither guessed at.

     43014-43017 and 43119-43122 are the same four thresholds twice over:
     over-voltage, under-voltage, float and equalise. Which pair a given
     firmware actually honours is a model question the gospel does not settle
     here — the ranges even differ (43119 is 40-48 V, 43015 is 40-46 V). So
     BOTH are on the screen, each labelled with its own address and range, and
     the installer reads the value back to see which one moved. Picking one set
     to show would silently hide the register that matters on half the fleet. */
  {
    address: 43014,
    label: 'Charge over-voltage threshold',
    description:
      'Charging stops above this battery voltage. LV hybrid 54.0-62.0 V (default 59.5 V); HV hybrid 500-999 V (default 556 V).',
  },
  {
    address: 43015,
    label: 'Discharge under-voltage threshold',
    description:
      'Discharging stops below this battery voltage. LV hybrid 40.0-46.0 V (default 46.0 V); HV hybrid 100-999 V (default 120 V).',
  },
  {
    address: 43016,
    label: 'Floating charge voltage threshold',
    description:
      'The holding voltage once bulk charging is done. LV hybrid 50.0-60.0 V (default 53.5 V); HV hybrid 100-999 V (default 550 V). Only honoured on User-defined and Lead-acid battery types.',
  },
  {
    address: 43017,
    label: 'Equalising charge voltage threshold',
    description:
      'The raised voltage an equalising charge climbs to. LV hybrid 54.0-60.0 V (default 56.5 V); HV hybrid 100-999 V (default 550 V). Only honoured on User-defined and Lead-acid battery types.',
  },
  {
    address: 43122,
    label: 'Battery over-voltage protection',
    description:
      'The second over-voltage limit, at 43122 rather than 43014. Range 54-62 V, default 59.5 V. Both exist in the map; read the value back to see which one this firmware moved.',
  },
  {
    address: 43119,
    label: 'Battery under-voltage protection',
    description:
      'The second under-voltage limit, at 43119 rather than 43015. Range 40-48 V, default 46 V, with a 2 V recovery hysteresis built in.',
  },
  {
    address: 43120,
    label: 'Battery floating charge voltage',
    description:
      'The second float setting, at 43120 rather than 43016. Range 50-58 V, default 53.5 V.',
  },
  {
    address: 43121,
    label: 'Battery equalising charge voltage',
    description:
      'The second equalise setting, at 43121 rather than 43017. Range 54-60 V, default 56.4 V.',
  },
  {
    address: 43020,
    label: 'Over-discharge voltage',
    description:
      'The voltage discharging is cut at, as opposed to the SOC. Lead-acid: S5 range 40.0-48.0 V, S6 range 40.0-52.0 V, default 44.5 V.',
  },
  {
    address: 43021,
    label: 'Forced charge voltage',
    description:
      'Below this voltage the inverter charges whatever the work mode says. Lead-acid: S5 range 40.0-48.0 V, S6 range 40.0-50.0 V, default 43.8 V.',
  },
  {
    address: 43676,
    label: 'Over-discharge full recovery voltage',
    description:
      'How far above the over-discharge voltage the pack must climb before discharging is allowed again. Range 2.0-7.0 V, default 3 V. For lead-acid and 48 V / 51.2 V lithium with no comms.',
  },
  {
    address: 43806,
    label: 'Battery 2 under-voltage protection',
    description: 'Battery 2 discharge cut-off voltage.',
    battery2: true,
  },
  {
    address: 43809,
    label: 'Battery 2 over-voltage protection',
    description: 'Battery 2 charge cut-off voltage.',
    battery2: true,
  },
  {
    address: 43807,
    label: 'Battery 2 floating charge voltage',
    description: 'Battery 2 holding voltage once bulk charging is done.',
    battery2: true,
  },
  {
    address: 43808,
    label: 'Battery 2 equalising charge voltage',
    description: 'Battery 2 equalising charge target voltage.',
    battery2: true,
  },

  /* ------------------------------------------------------ lead-acid only
     Every row below says "lead-acid" in the gospel's own description. They
     are gathered on their own tab because a lithium install should not have
     to scroll past an equalisation interval it can never use — but they stay
     in this one list, so ALL still shows the whole screen. */
  {
    address: 43333,
    label: 'Lead-acid equalisation enable',
    description:
      '0 = disable, 1 = enable, default 0. The master switch for the four equalisation settings below — with this off, they do nothing.',
  },
  {
    address: 43334,
    label: 'Lead-acid equalisation voltage',
    description: 'Range 55-59.5 V, default 57.6 V. The voltage an equalising charge holds.',
  },
  {
    address: 43335,
    label: 'Lead-acid equalisation time',
    description: 'Range 120-360 min, default 180 min. How long one equalising charge runs.',
  },
  {
    address: 43336,
    label: 'Lead-acid equalisation timeout',
    description:
      'Range 5-900 min, default 120 min. The cap on an equalising charge that never reaches its voltage.',
  },
  {
    address: 43337,
    label: 'Lead-acid equalisation interval',
    description: 'Range 20-180 days, default 30 days. How often an equalising charge is run.',
  },
  {
    address: 43338,
    label: 'Lead-acid equalisation now',
    description:
      '0 = disable, 1 = enable, default 0. Starts an equalising charge immediately. Requires the equalisation enable above to be switched on first — writing this alone does nothing.',
  },
  {
    address: 43332,
    label: 'Lead-acid discharge voltage',
    description:
      'Range 50-60 V, default 54 V. The voltage the battery switches to discharging at. Off-grid inverters.',
  },
  {
    address: 43339,
    label: 'Lead-acid equalisation current',
    description: 'Range 4.0-10.0 A, default 4.0 A. The current an equalising charge runs at.',
  },
  {
    address: 43022,
    label: 'Lead-acid temperature compensation coefficient',
    description:
      'Range 0-180 mV/degC, default 0. How far the charge voltage moves per degree away from 25 degC. Lead-acid only; 0 disables compensation.',
  },
  {
    address: 43025,
    label: 'Temperature compensation lower limit',
    description: 'Range 5-25 degC, default 5 degC. Lead-acid only.',
  },
  {
    address: 43026,
    label: 'Temperature compensation upper limit',
    description: 'Range 25-45 degC, default 45 degC. Lead-acid only.',
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

/**
 * Is battery 2 taking its settings from battery 1? (43814)
 *
 * ONLY the magic word counts. 43814 is not an on/off: the gospel says 0xAA55
 * means follow and "other values" mean do not. An unread register is therefore
 * NOT following — which is the safe way round, because it shows the battery 2
 * rows rather than hiding settings the installer may need.
 */
export function isFollowingBattery1(followRaw: number | undefined): boolean {
  return followRaw === FOLLOW_MAGIC
}

/**
 * The rows to RENDER, given 43802 (how many batteries) and 43814 (follow).
 *
 * TWO GATES, and they hide different amounts.
 *
 * 43802 = 3 is the hard one: there is no second battery, so every battery 2
 * row goes, wake-up included. Nothing about a pack that is not fitted is worth
 * showing.
 *
 * 43814 = 0xAA55 is the soft one: the second battery EXISTS, it is just taking
 * battery 1's numbers. Its limits are inert and would invite a write the
 * firmware ignores, so they go — but the wake-up rows stay, because waking a
 * dead pack is per-pack work that follow mode has no opinion about. See
 * `keepWhenFollowing`.
 *
 * The order matters: the hard gate is applied first, so a single-battery
 * machine hides wake-up 2 no matter what 43814 happens to read.
 */
export function rowsFor(
  connectionRaw: number | undefined,
  followRaw?: number | undefined,
): BatteryRow[] {
  if (!hasTwoBatteries(connectionRaw)) {
    return BATTERY_ROWS.filter((r) => !r.battery2)
  }
  if (!isFollowingBattery1(followRaw)) return BATTERY_ROWS
  return BATTERY_ROWS.filter((r) => !r.battery2 || r.keepWhenFollowing)
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
 * The battery 2 slots that follow mode hides — the limits, not the wake-up.
 *
 * Derived from the same rows the page renders, so a row added later lands on
 * the right side of the gate by its own flag rather than by a second list
 * somebody has to remember to update.
 */
export function followHiddenSlots(): string[] {
  return BATTERY_ROWS.filter((r) => r.battery2 && !r.keepWhenFollowing).map(
    slotOf,
  )
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
  followRaw?: number | undefined,
): { edits: Record<string, number>; dropped: string[] } {
  /* Which slots vanished, by the same two gates `rowsFor` uses. Declaring one
     battery drops everything battery 2; switching on follow drops only the
     limits, because the wake-up rows are still on screen and still sendable. */
  let hiddenSlots: string[]
  if (!hasTwoBatteries(connectionRaw)) hiddenSlots = battery2Slots()
  else if (isFollowingBattery1(followRaw)) hiddenSlots = followHiddenSlots()
  else return { edits, dropped: [] }

  const hidden = new Set(hiddenSlots)
  const dropped = Object.keys(edits).filter((slot) => hidden.has(slot))
  if (!dropped.length) return { edits, dropped: [] }

  const next = { ...edits }
  for (const slot of dropped) delete next[slot]
  return { edits: next, dropped }
}

/* ------------------------------------------------------------------ tabs */

/**
 * The tabs across the top of the Battery screen.
 *
 * BATTERY is the default, and it is deliberately SHORT: the handful of
 * settings SolisCloud puts on its own battery page, in that order. That is the
 * screen an installer already knows, and it is what they want ninety-nine
 * commissionings out of a hundred — battery model, how it is wired, the SOC
 * limits, the current limits, battery saving.
 *
 * The rest of the map lives on the other tabs. Those are OURS, not
 * SolisCloud's: the deep voltage thresholds, the wake-up block, the lead-acid
 * block. Each is a job somebody occasionally has to do, and none of them
 * belongs in the way of the common one.
 *
 * A LITTLE duplication, not blanket duplication. A row appears on a second tab
 * only where it genuinely belongs to both jobs — the SOC limits are on BATTERY
 * and on SOC, the current limits on BATTERY and on CURRENTS. Everything else
 * appears exactly once. Where a row does appear twice it is the same
 * `BatteryRow`, so `slotOf` gives it one staged edit and one Save; switching
 * tab mid-edit cannot lose it or send it twice.
 */
export type BatteryTabId =
  | 'battery'
  | 'soc'
  | 'volts'
  | 'currents'
  | 'wakeup'
  | 'leadAcid'

export const BATTERY_TABS: Array<{ id: BatteryTabId; label: string }> = [
  { id: 'battery', label: 'BATTERY' },
  { id: 'soc', label: 'SOC' },
  { id: 'volts', label: 'VOLTS' },
  { id: 'currents', label: 'CURRENTS' },
  { id: 'wakeup', label: 'WAKE-UP' },
  { id: 'leadAcid', label: 'LEAD-ACID' },
]

/**
 * The default tab, in SolisCloud's own order.
 *
 * AN EXPLICIT LIST, not "everything not moved elsewhere". That is the whole
 * point of this tab: it stays short because a row has to be PUT here, so a
 * register added to the map later lands on a lens and leaves the common screen
 * alone. The previous build had this tab default to everything, and fifty rows
 * is not a battery page.
 *
 * Battery saving is the one bit row here, and it is on SolisCloud's page too.
 */
const BATTERY_ADDRESSES = [
  43009, 43803, 43802, // what battery, and how it is wired
  43011, 43018, 43010, 43481, // the SOC limits
  43117, 43118, // the current limits
  43814, 43804, 43805, 43810, 43811, 43812, // battery 2's equivalents
]

/** Rows on the SOC tab: every state-of-charge threshold, and only those. */
const SOC_ADDRESSES = [
  43011, 43481, 43018, 43010, // battery 1
  43810, 43811, 43812, // battery 2
  43482, // healing
]

/**
 * Rows on the VOLTS tab: the battery voltage thresholds.
 *
 * NOT the wake-up voltages and NOT the lead-acid voltages — those are whole
 * jobs with their own tabs, and pulling one register out of each into here
 * just means finding half a job in two places. This tab is the protection and
 * charge-profile thresholds: over, under, float, equalise, and the discharge
 * floor.
 *
 * Both parallel threshold sets ARE here (43014-43017 and 43119-43122), paired
 * so the twins sit together. That duplication is in the register map itself,
 * not something this tab invented — see the rows for why neither is hidden.
 */
const VOLT_ADDRESSES = [
  43014, 43122, // charge over-voltage, twice over
  43015, 43119, // discharge under-voltage, twice over
  43016, 43120, // float, twice over
  43017, 43121, // equalise, twice over
  43020, 43021, 43676, // over-discharge, forced charge, recovery
  43806, 43809, 43807, 43808, // battery 2
]

/**
 * Rows on the CURRENTS tab: the battery current limits.
 *
 * No lead-acid equalisation current — that belongs to the lead-acid job and is
 * on that tab. Both parallel pairs are here (43117/43118 and 43012/43013) for
 * the same reason both voltage sets are.
 */
const CURRENT_ADDRESSES = [
  43117, 43118, // battery 1 charge / discharge
  43012, 43013, // the same two, twice over
  43116, // one limit governing both directions
  43342, 43862, 43863, // grid-charge and PCS ceilings
  43804, 43805, // battery 2
]

/**
 * Rows on the WAKE-UP tab: the whole job in one place.
 *
 * The bit switch that arms wake-up is here too, which is why `rowOnTab` asks
 * the bit rows before it consults any address list. These voltages appear
 * NOWHERE else — a wake-up threshold is not a protection threshold, and
 * putting it on VOLTS just splits one job across two tabs.
 */
const WAKEUP_ADDRESSES = [43348, 43349, 43376, 43858, 43859, 43813]

/**
 * Rows on the LEAD-ACID tab: the whole job in one place.
 *
 * Only registers the gospel's own description marks as lead-acid — the
 * equalisation block, its current, the discharge voltage, and temperature
 * compensation. They appear on no other tab: a lithium install has no use for
 * any of them, and an equalisation interval sitting on the VOLTS tab reads as
 * a setting worth changing.
 *
 * 43016 and 43017 are the exception and stay OFF this tab. The gospel does
 * name them "Only Support User-def and Lead-acid", but they are also the
 * ordinary float and equalise thresholds, and they have twins at 43120/43121
 * that are not lead-acid at all. Splitting a pair across two tabs hides the
 * fact that they are a pair, which is the one thing about them worth seeing.
 */
const LEAD_ACID_ADDRESSES = [
  43333, 43334, 43335, 43336, 43337, 43338, // equalisation block
  43339, // equalisation current
  43332, // lead-acid discharge voltage
  43022, 43025, 43026, // temperature compensation
]

/** Every tab's address list, so `rowOnTab` and the ordering cannot disagree. */
const TAB_ADDRESSES: Record<BatteryTabId, number[]> = {
  battery: BATTERY_ADDRESSES,
  soc: SOC_ADDRESSES,
  volts: VOLT_ADDRESSES,
  currents: CURRENT_ADDRESSES,
  wakeup: WAKEUP_ADDRESSES,
  leadAcid: LEAD_ACID_ADDRESSES,
}

/**
 * Is this row on that tab?
 *
 * EVERY tab consults a list now, the default one included. A register added to
 * the map appears on no tab until somebody puts it on one — which fails LOUDLY
 * (the row is missing) rather than silently (fifty-one rows on the front page).
 */
export function rowOnTab(row: BatteryRow, tab: BatteryTabId): boolean {
  /*
   * The three bit rows, each pinned to the tab whose job it belongs to.
   *
   * Bit rows cannot be placed by an address list: wake-up and healing BOTH
   * live in 43110, so listing that address would put each of them on the
   * other's tab as well.
   */
  if (row.bitLabel) {
    if (row.bitLabel === WAKEUP_BIT_LABEL) return tab === 'wakeup'
    if (row.bitLabel === HEALING_BIT_LABEL) return tab === 'soc'
    if (row.bitLabel === BATTERY_SAVING_BIT_LABEL) return tab === 'battery'
    return false
  }
  return TAB_ADDRESSES[tab].includes(row.address)
}

/**
 * The rows to RENDER, for a 43802 reading, a tab, and 43814.
 *
 * Rows follow THEIR TAB'S order, not the flat list's, because each address
 * list above is written in the order that tab wants to be read — VOLTS pairs
 * each threshold with its twin, BATTERY follows SolisCloud.
 *
 * A bit row LEADS its tab where it is the switch that arms everything under
 * it: wake-up on WAKE-UP, healing on SOC. Battery saving is the exception and
 * sits LAST on BATTERY — it arms nothing on that tab, it is just one more
 * setting, and SolisCloud puts it at the bottom of the page too.
 *
 * The battery-2 gates run first, so declaring a single battery — or switching
 * on follow — hides those rows on every tab at once. A tab left holding
 * nothing renders empty rather than disappearing; a tab vanishing under you as
 * you change an unrelated register is worse than a list that explains itself.
 */
export function rowsForTab(
  connectionRaw: number | undefined,
  tab: BatteryTabId,
  followRaw?: number | undefined,
): BatteryRow[] {
  const order = TAB_ADDRESSES[tab]
  const rank = (r: BatteryRow) => {
    if (r.bitLabel) {
      return r.bitLabel === BATTERY_SAVING_BIT_LABEL ? order.length + 1 : -1
    }
    const at = order.indexOf(r.address)
    return at === -1 ? order.length : at
  }
  return rowsFor(connectionRaw, followRaw)
    .filter((r) => rowOnTab(r, tab))
    .sort((a, b) => rank(a) - rank(b))
}

/**
 * Which tabs hold staged, unsent edits — for the dots on the tab strip.
 *
 * These tabs are LENSES, so a row carrying an unsent edit can be sitting on a
 * tab you are not looking at, or on no visible tab at all after the battery-2
 * gates close. Remote Control marks its tabs for exactly this reason and this
 * screen did not, which made an unsent edit on a hidden lens invisible.
 *
 * A staged value equal to the value already read is NOT an edit, and must not
 * light a dot — the row does not draw itself dirty for it either, and a dot
 * the row disagrees with is worse than no dot at all. The caller passes
 * `isEdited` because deciding that needs the store, which this file has no
 * business reading; the bit rows compare a MEANING, not a word.
 */
export function dirtyTabs(
  edits: Record<string, number>,
  connectionRaw: number | undefined,
  followRaw: number | undefined,
  isEdited: (row: BatteryRow, staged: number) => boolean,
): Set<BatteryTabId> {
  const out = new Set<BatteryTabId>()
  /* Only rows that still EXIST for this machine. A battery-2 edit that the
     gates have already dropped must not keep a dot burning. */
  const live = rowsFor(connectionRaw, followRaw)
  for (const row of live) {
    const staged = edits[slotOf(row)]
    if (staged === undefined) continue
    if (!isEdited(row, staged)) continue
    for (const t of BATTERY_TABS) {
      if (rowOnTab(row, t.id)) out.add(t.id)
    }
  }
  return out
}
