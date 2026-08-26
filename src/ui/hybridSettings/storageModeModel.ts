/**
 * The register maths behind the Storage Mode screen, with no React in it.
 *
 * The screen is chrome; THIS is the part that can silently cost a customer
 * their export. Keeping it pure means the proof (`storageModeModel.test.ts`)
 * does not have to go through a renderer to pin a bit number down.
 *
 * Not one bit position is written as a literal here. `bitRules.ts` already
 * reads them out of `hybridRules.json`, so a corrected rules file changes this
 * screen's behaviour without an edit — which is the only way the "field
 * correction wins over the document" precedence can actually hold.
 */
import {
  applyBitChange,
  clearBit,
  exclusiveBits,
  isSet,
  ownedMask,
  RegisterRule,
  setBit,
} from '../../settings/bitRules'
import { ruleFor } from '../settings/GospelRows'
import { first } from '../pv/captures'

/** Energy Storage Control Switch — the work-mode word. */
export const STORAGE_CONTROL = 43110

/** Energy Storage Function Control Word — export and grid-import limit. */
export const EXPORT_CONTROL = 43483

/** Max export power on the smaller models: U16, W, ×100, function 6. */
export const MAX_EXPORT_U16 = 43074

/** Max export power on 80–125 kW models and higher: U32, kW, ×0.001, fn 16. */
export const MAX_EXPORT_U32 = 44227

/** Export calibration, the same two-platform split as max export power. */
export const EXPORT_CAL_U16 = 43195
export const EXPORT_CAL_U32 = 44225

const rule = (address: number): RegisterRule => {
  const r = ruleFor(address)
  if (!r) throw new Error(`No rule for register ${address}; the gospel is the source`)
  return r
}

/**
 * The bit a named independent switch sits on, looked up by its rules-file
 * label rather than counted.
 *
 * Asking by label is what makes the active-low handling below survive a
 * renumbering: if 'Allow Export' ever moves, the lookup moves with it and the
 * inversion stays attached to the right bit.
 *
 * Matched on a PREFIX, the same way `protectSettingModel.bitNamed` does it.
 * The map is free to append the polarity to a label where a reader of the map
 * sees it -- 43483 BIT03 became "Allow Export (active-low: 1 = blocked)" -- and
 * an exact match would drop the row the moment someone documented a bit
 * properly, taking the inversion with it.
 */
function independentBitNamed(address: number, label: string): number {
  const labels = rule(address).independent_bit_labels ?? {}
  const found = Object.entries(labels).find(([, l]) => l.startsWith(label))
  if (!found) {
    throw new Error(
      `${address} has no independent bit labelled "${label}..." in the rules file`,
    )
  }
  return Number(found[0])
}

/**
 * 43483 BIT03. ACTIVE-LOW: 0 = export allowed, 1 = export BLOCKED.
 *
 * Proven on the wire, SN 1053050249120054, same machine both directions:
 *   0106A9DB0018  (0x18, bit3 = 1) with export DISABLED
 *   0106A9DB0010  (0x10, bit3 = 0) immediately after ENABLING export
 *
 * The inversion happens in `allowExportFromWord` / `wordForAllowExport` and
 * NOWHERE else. Invert a second time somewhere up in the UI and the screen
 * politely disables a customer's export while showing them "allowed".
 */
export const ALLOW_EXPORT_BIT = independentBitNamed(EXPORT_CONTROL, 'Allow Export')

/**
 * 43483 BIT07. Active-high, unlike its neighbour above: 0x90 (bit7 = 1) is the
 * limit ON, 0x10 (bit7 = 0) is OFF, confirmed on the wire.
 *
 * This is the peak-shaving SWITCH — it caps battery charging power so grid
 * import stays under a limit. It is NOT the 43110 peak-shaving WORK MODE, and
 * both are on this screen. See `PEAK_SHAVING_HELP`.
 */
export const GRID_IMPORT_LIMIT_BIT = independentBitNamed(
  EXPORT_CONTROL,
  'Grid Import Limit',
)

export interface ModeOption {
  bit: number
  label: string
}

/**
 * The four work modes, in rules-file order.
 *
 * `exclusiveBits` returns the members of the `exactly_one` group, so this
 * follows the data: bits 0/2/6/9 today, whatever the file says tomorrow.
 */
export function modeOptions(): ModeOption[] {
  return exclusiveBits(rule(STORAGE_CONTROL)).map((b) => ({
    bit: b.bit,
    label: b.label,
  }))
}

/**
 * The single selected mode, or null when the word does not name exactly one.
 *
 * Null covers BOTH "no mode set" and "two modes set". Neither is snapped to a
 * nearest guess: this is a debug tool, and a word with two mode bits in it is
 * precisely the thing the user opened the tool to discover.
 */
export function activeMode(word: number): ModeOption | null {
  const on = modeOptions().filter((m) => isSet(word, m.bit))
  return on.length === 1 ? first(on) : null
}

/**
 * The word to write when the user picks a mode.
 *
 * `applyBitChange` clears the sibling modes (the `exactly_one` group) and also
 * clears any `mutually_exclusive` partner — which is how picking Peak-Shaving
 * turns Battery Reserve off. Everything outside those groups, notably grid
 * charge and battery wakeup, is left exactly as it was.
 */
export function wordForMode(word: number, bit: number): number {
  return applyBitChange(rule(STORAGE_CONTROL), word, bit, true)
}

/**
 * What picking this mode will silently switch off, in words.
 *
 * The rules file says Reserve Battery (BIT04) and Peak-Shaving (BIT09) cannot
 * both be on, and `wordForMode` duly clears one. Doing that without telling
 * anyone is how a battery reserve disappears and nobody knows when. The screen
 * renders these strings next to the mode row.
 */
export function conflictsOfMode(word: number, bit: number): string[] {
  const r = rule(STORAGE_CONTROL)
  const out: string[] = []
  for (const g of r.bit_groups ?? []) {
    if (g.rule !== 'mutually_exclusive' || !g.bits.includes(bit)) continue
    for (const other of g.bits) {
      if (other === bit || !isSet(word, other)) continue
      const label = g.bit_labels?.[String(other)] ?? `BIT${other}`
      out.push(`${label} will be turned off — the two cannot both be on.`)
    }
  }
  return out
}

/** Active-low read. See `ALLOW_EXPORT_BIT`. */
export function allowExportFromWord(word: number): boolean {
  return !isSet(word, ALLOW_EXPORT_BIT)
}

/** Active-low write: "allow" clears the bit. See `ALLOW_EXPORT_BIT`. */
export function wordForAllowExport(word: number, allow: boolean): number {
  return allow ? clearBit(word, ALLOW_EXPORT_BIT) : setBit(word, ALLOW_EXPORT_BIT)
}

/** Active-HIGH, unlike allow-export. See `GRID_IMPORT_LIMIT_BIT`. */
export function gridImportLimitFromWord(word: number): boolean {
  return isSet(word, GRID_IMPORT_LIMIT_BIT)
}

export function wordForGridImportLimit(word: number, on: boolean): number {
  return on
    ? setBit(word, GRID_IMPORT_LIMIT_BIT)
    : clearBit(word, GRID_IMPORT_LIMIT_BIT)
}

/** Every bit the rule describes — the mask a masked write is allowed to claim. */
export function ownedMaskOf(address: number): number {
  return ownedMask(rule(address))
}

/**
 * The `?` text for the peak-shaving group.
 *
 * Two unrelated features carry this name because Solis labels them both that
 * way on the device and in SolisCloud. Both appear on this screen, so without
 * this note a fitter will set one and expect the other's behaviour.
 */
export const PEAK_SHAVING_HELP = [
  `Two different features are called "peak shaving". Both are on this screen.`,
  `THIS ONE — ${EXPORT_CONTROL} BIT0${GRID_IMPORT_LIMIT_BIT}, "Grid Import Limit". It caps how hard the battery charges so that total grid import stays under the limit you set, backing off as house load rises and climbing again as load falls. Also known as "battery charge limit dependent on dynamic loads". It only ever limits CHARGING. It is not a work mode.`,
  `THE OTHER ONE — ${STORAGE_CONTROL} Peak-Shaving, the work mode in the row at the top of this screen. That one changes what the inverter is doing overall.`,
  `They are independent and may be on at the same time.`,
].join('\n\n')

/** Hint for 43488, whose real ceiling depends on the model. */
export const GRID_IMPORT_POWER_HINT =
  'No fixed maximum — the max is about 4× the rated power of the hybrid. Observed 0–200000 W on one model and 0–500000 W on another, so nothing is capped here; the inverter rejects a value it cannot take.'


/* ------------------------------------------------- the screen's own rows -- */

/*
 * The rows below used to live in `StorageMode.tsx`.
 *
 * They moved here so the rail's search index can read them without importing
 * the SCREEN. Importing the .tsx created a cycle — the settings tab imports
 * the index, the index imported the screen, and the screen's module graph
 * reaches the tab — which left `SETTINGS_INDEX` undefined at module-init time
 * and blanked the whole settings page with a ReferenceError. A pure model file
 * has no such loop, and this is where the register maths belongs anyway.
 */

/** Battery reserve target. */
export const BATTERY_RESERVE_SOC = 43024
/** Peak SOC and max grid import power — the peak-shaving parameters. */
export const PEAK_SOC = 43487

/**
 * The Battery Reserve function's own grid-charge ceiling.
 *
 * Moved here from the Parallel screen. The map calls it "Grid charge power
 * limit for battery reserve function", and the switch that arms it (43110
 * BIT04) and its SOC target (43024) are both on THIS screen -- the parallel
 * system only changes its lower limit, which does not make it a parallel
 * setting.
 */
export const RESERVE_GRID_CHARGE_LIMIT = 43394
export const GRID_IMPORT_POWER = 43488

/**
 * Unbalance output — 43073 BIT06, NOT the whole of 43073.
 *
 * The register is a bit word: BIT04 EPM switch, BIT05 FailSafe, BIT06 power
 * control mode, BIT08/09 external EPM, BIT13 meter-vs-CT. An earlier build
 * drew it as a plain number input, which would have written a bare 0 or 1 and
 * cleared the EPM and FailSafe bits in one go — the exact failure the gospel's
 * revision note on this register warns about. It is a masked toggle on BIT06.
 */
export const UNBALANCE_CONTROL = 43073

export interface NumberSpec {
  address: number
  label: string
  description: string
}

export const NUMBER_ROWS: Record<number, NumberSpec> = {
  [BATTERY_RESERVE_SOC]: {
    address: BATTERY_RESERVE_SOC,
    label: 'Batt reserved',
    description:
      'The state of charge the battery reserve holds back for a power cut. Only does anything while the Battery reserve switch above is on.',
  },
  [GRID_IMPORT_POWER]: {
    address: GRID_IMPORT_POWER,
    label: 'Max grid import power',
    description: GRID_IMPORT_POWER_HINT,
  },
  [RESERVE_GRID_CHARGE_LIMIT]: {
    address: RESERVE_GRID_CHARGE_LIMIT,
    label: 'Battery-reserve grid charge limit',
    description:
      'Ceiling on charging the battery reserve from the grid, in watts. Only does anything while the Battery reserve switch above is on. Lower limit 1000 W on a parallel system, up to the total rated power.',
  },
  [PEAK_SOC]: {
    address: PEAK_SOC,
    label: 'Peak SOC',
    description:
      'The state of charge the grid-import limit charges the battery up to. Part of the peak-shaving switch above, not of the work mode.',
  },
  [MAX_EXPORT_U16]: {
    address: MAX_EXPORT_U16,
    label: 'Max export power · smaller models · 16-bit',
    description:
      'The export ceiling on the smaller platform, in watts. Shown alongside 44227 because the screen never sniffs the model — set the one that is yours; the other will refuse.',
  },
  [MAX_EXPORT_U32]: {
    address: MAX_EXPORT_U32,
    label: 'Max export power · 80–125 kW models and higher · 32-bit',
    description:
      'The export ceiling on 80–125 kW models and higher, in kW. A 32-bit register, so it is written with function 16 as two words.',
  },
  [EXPORT_CAL_U16]: {
    address: EXPORT_CAL_U16,
    label: 'Export calibration · smaller models · 16-bit',
    description:
      'Trims the measured export so the meter and the inverter agree, on the smaller platform.',
  },
  [EXPORT_CAL_U32]: {
    address: EXPORT_CAL_U32,
    label: 'Export calibration · 80–125 kW models and higher · 32-bit',
    description:
      'The same trim on 80–125 kW models and higher. Written 32-bit even though the map still calls it u16 — see WIDTH_OVERRIDES.',
  },
}
