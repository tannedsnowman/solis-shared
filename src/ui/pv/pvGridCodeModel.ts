/**
 * The grid protection threshold table, as data rather than as a screen.
 *
 * WHAT THIS SCREEN IS FOR
 * -----------------------
 * These are the trip points a grid-tied inverter disconnects on. SolisCloud
 * prints them as a flat list of thirty-odd rows — "OV-G-V 01", "OV-G-V-T 01",
 * "OV-G-V 02" — in register order, each with its own Read button. A
 * commissioning engineer does not check a trip LEVEL. They check a level
 * AND ITS TIME together, against a grid code table that is itself laid out as
 * a matrix: stage 1 trips at 253 V after 3 s, stage 2 at 275 V after 0.2 s.
 * Reading that off a flat list means scrolling between two rows that are
 * eight registers apart and holding one number in your head.
 *
 * So the layout here is the grid code's own layout: PROTECTION down the side,
 * STAGE across the top, and each cell carries the level and the time as one
 * unit. That is the entire justification for this file existing — everything
 * below is in service of making that table describable as data.
 *
 * THE MATRIX IS DATA, NOT JSX
 * ---------------------------
 * `STAGE_MATRIX` below is a table of (protection, stage) -> {level, time}
 * addresses. The view walks it and draws whatever it finds. That split is
 * deliberate: the map is known to be wrong in places (see the two corrections
 * documented below), and when it is corrected the fix belongs in one array
 * here, not scattered through cell components. A stage column that does not
 * exist for a protection is an explicit `null`, never an omitted entry —
 * see `CELL_MISSING`.
 *
 * THE PRECISION FLAG — the reason a hardcoded scale here would be dangerous
 * ------------------------------------------------------------------------
 * Stages 01 and 02 (3090-3105) carry `scale: 1.0` and `unit: '1'` in the
 * gospel, and that is NOT a missing scale — it is the truth. Their precision
 * is set at RUNTIME by register 3089, "Grid code accuracy set flag":
 *
 *   3089 low byte 0x00 -> volts 1 V,    time 0.1 s,  frequency 0.1 Hz
 *   3089 low byte 0x01 -> volts 0.1 V,  time 0.01 s, frequency 0.01 Hz
 *   3089 high byte 0x01 -> volts 0.1 V, time 0.02 s, frequency 0.01 Hz
 *                          (a "single rule" standard; the high byte is
 *                           read-only and overrides the low byte)
 *
 * The document says the host computer must read 3089 FIRST and interpret
 * every threshold through it. So the same raw word 2530 in 3090 is 2530 V at
 * one precision and 253.0 V at the other. Writing 253.0 V without reading
 * 3089 has a fifty-fifty chance of writing 2530 V into a live grid-tied
 * machine, and the inverter will ACK it.
 *
 * `precisionFrom()` is the only place that byte is decoded, and
 * `scaleForCell()` is the only place a stage-01/02 scale is produced. Until
 * 3089 has been read, `scaleForCell()` returns null and the view must show
 * the cell as unscaled — never guess.
 *
 * Stage 03 (3119-3122) is different and simpler: those registers carry REAL
 * fixed scales in the map (0.1 V, 10 ms) and do not depend on 3089 at all.
 * That asymmetry is genuine, not an import bug, so it is honoured per-cell
 * rather than smoothed over.
 *
 * TWO CORRECTIONS TO THE REGISTER LIST THIS SCREEN WAS SPECIFIED FROM
 * ------------------------------------------------------------------
 * 1. Stage 03 was given as "OV-G-V 03 = 3119, UN-G-V-T 03 = 3120,
 *    UN-G-V 03 = 3121, UN-G-V-T 03 = 3122" — UN-G-V-T twice, and nothing
 *    for OV-G-V-T. The gospel keys settle it: 3120 is `ovGVT03`, named
 *    "OV-G-V03-T". It is the OVER-voltage stage 3 trip time. 3122 is
 *    `unGVT03`. Corrected here.
 * 2. "UV-G-F 02 = 3104" — the gospel key is `unGF02`. UN-G-F 02, the
 *    under-frequency stage 2 level. A typo in the list, not in the map.
 *
 * WHY THIS FILE TRUSTS `key` AND NOT `name`
 * -----------------------------------------
 * 3095-3105 in the SETTINGS space carry names imported from the DATA space
 * and shifted by one: 3095 is named "Derating /Limiting Status", 3098 "Fault
 * info 3", 3104 "Warning info DSP". Those are the 0x04 registers at nearly
 * those addresses — PV printed addresses collide across spaces on 260
 * registers, and this run is part of the wreckage. The `key` field is
 * correct throughout (`unGVT01`, `ovGF01`, `unGF02`), and the legacy
 * `pvSettingsMapper` agrees with it on all 36 registers this screen touches.
 *
 * So labels here come from the MATRIX (protection + stage + level-or-time),
 * which is knowledge this file states once, and never from `name`. Rendering
 * the map's `name` would put "Fault info 3" on the over-frequency trip point.
 * `gospelName()` exposes the raw name anyway so a test can pin the damage and
 * so the view can show it where an engineer is cross-checking a capture.
 *
 * SETTINGS SPACE, ALWAYS
 * ----------------------
 * Every address here is reached through `byScopedAddress('settings', …)`.
 * 3090 in the DATA space is a different register. There is no bare-address
 * lookup in this file for that reason, and `assertSettingsSpace()` exists so
 * a test can prove no address in the matrix drifted into the data space.
 */
import {
  byScopedAddress,
  settingsByAddress,
  type GospelRegister,
} from '../../gospel/pvGospel'
import { ruleFor, type PvRule } from '../../gospel/pvRules'

/* ------------------------------------------------------------------ *
 * The registers that set the context for everything else.
 * ------------------------------------------------------------------ */

/**
 * Grid Code — the standard the inverter is commissioned to.
 *
 * NOT 3054, which the specification for this screen named. 3054 is
 * `pfSetting02`, "Actual power factor adjustment", an S16 power-factor
 * value with no `value_map` at all. The register carrying the country
 * standards is 3068 `standardNumber`, whose `value_map` holds 31 entries
 * ('0' -> 'VDE 0126-1-1 (Germany)', '1' -> 'AS4777.2-2015 (Australia)', …).
 *
 * Those labels are read from the map at render time by `gridCodeOptions()`.
 * A hardcoded country list here would go stale the first time a firmware
 * adds a standard, and would silently mislabel the one the machine is
 * actually set to.
 */
export const GRID_CODE = 3068

/** Grid code accuracy set flag. Decides the scale of every stage-01/02 cell. */
export const PRECISION_FLAG = 3089

/* ------------------------------------------------------------------ *
 * The matrix
 * ------------------------------------------------------------------ */

/** A row of the matrix: one protection. */
export type ProtectionId = 'ovV' | 'unV' | 'ovF' | 'unF'

/** A column of the matrix: one trip stage. */
export type StageId = '01' | '02' | '03'

/** Which physical quantity a protection trips on. Decides its unit. */
export type Quantity = 'voltage' | 'frequency'

export interface Protection {
  id: ProtectionId
  /** Row label. The engineer's name for it, not the register's. */
  label: string
  /** The document's short code, e.g. 'OV-G-V'. Printed beside the label. */
  code: string
  quantity: Quantity
  /** Why this protection exists, for the row's `?`. */
  description: string
}

export const PROTECTIONS: Protection[] = [
  {
    id: 'ovV',
    label: 'Over voltage',
    code: 'OV-G-V',
    quantity: 'voltage',
    description:
      'Disconnects when grid voltage rises above the trip level for longer than the trip time. Stage 1 is the slow, close-in limit; stage 2 trips fast and far out.',
  },
  {
    id: 'unV',
    label: 'Under voltage',
    code: 'UN-G-V',
    quantity: 'voltage',
    description:
      'Disconnects when grid voltage falls below the trip level for longer than the trip time. Set too high, the inverter drops out on ordinary evening sag.',
  },
  {
    id: 'ovF',
    label: 'Over frequency',
    code: 'OV-G-F',
    quantity: 'frequency',
    description:
      'Disconnects on grid frequency above the trip level. Frequency thresholds are the anti-islanding backstop, so a wide setting here is not a harmless one.',
  },
  {
    id: 'unF',
    label: 'Under frequency',
    code: 'UN-G-F',
    quantity: 'frequency',
    description:
      'Disconnects on grid frequency below the trip level. Same anti-islanding role as over frequency.',
  },
]

export const STAGES: StageId[] = ['01', '02', '03']

/**
 * One cell: a trip level and the time it must be exceeded for.
 *
 * Both halves are optional because the map is not symmetric — stage 03 exists
 * for voltage only, and a future firmware could add a level with no time.
 * A cell where BOTH are null is not stored; the matrix stores `null` for the
 * whole cell instead, so "this combination does not exist" is one check in
 * the view rather than two.
 */
export interface Cell {
  /** Printed address of the trip level, or null when the map has none. */
  level: number | null
  /** Printed address of the trip time, or null when the map has none. */
  time: number | null
}

/**
 * The table. Rows are protections, columns are stages.
 *
 * A missing (protection, stage) pair is `null` — NOT an empty cell object and
 * NOT an omitted key. The view renders `null` as an explicit "—", because
 * blank space in a threshold table reads as zero, and a zero trip point is a
 * machine that never disconnects.
 *
 * Every address is a PRINTED address in the SETTINGS space. The −1 wire
 * offset belongs to `pvGospel.wireAddress` and is applied nowhere here.
 */
export const STAGE_MATRIX: Record<ProtectionId, Record<StageId, Cell | null>> =
  {
    ovV: {
      '01': { level: 3090, time: 3091 },
      '02': { level: 3092, time: 3093 },
      // 3120 is `ovGVT03` "OV-G-V03-T". The screen specification called it
      // UN-G-V-T 03; the map does not. See the header, correction 1.
      '03': { level: 3119, time: 3120 },
    },
    unV: {
      '01': { level: 3094, time: 3095 },
      '02': { level: 3096, time: 3097 },
      '03': { level: 3121, time: 3122 },
    },
    ovF: {
      '01': { level: 3098, time: 3099 },
      '02': { level: 3100, time: 3101 },
      // No stage 3 frequency registers exist anywhere in the settings space.
      // 3123 is `reserve`. Explicitly absent, not forgotten.
      '03': null,
    },
    unF: {
      // 3104 is `unGF02`, not `uvGF02`. See the header, correction 2.
      '01': { level: 3102, time: 3103 },
      '02': { level: 3104, time: 3105 },
      '03': null,
    },
  }

/** What a cell holds. Used to pick the unit and the scale. */
export type CellPart = 'level' | 'time'

/**
 * Every address the matrix names, in ascending order.
 *
 * Derived rather than listed, so a corrected matrix moves the read sweep with
 * it and cannot leave a cell that the screen draws but never reads.
 */
export const MATRIX_ADDRESSES: number[] = (() => {
  const out: number[] = []
  for (const p of PROTECTIONS) {
    for (const s of STAGES) {
      const cell = STAGE_MATRIX[p.id][s]
      if (!cell) continue
      if (cell.level !== null) out.push(cell.level)
      if (cell.time !== null) out.push(cell.time)
    }
  }
  return out.sort((a, b) => a - b)
})()

/* ------------------------------------------------------------------ *
 * The blocks below the matrix
 * ------------------------------------------------------------------ */

export interface SimpleRow {
  address: number
  label: string
  description?: string
}

export interface Block {
  title: string
  /** Line under the title: what this block is for. */
  note: string
  rows: SimpleRow[]
}

/**
 * Recover, Startup and the two loose values.
 *
 * Kept as separate labelled blocks rather than folded into the matrix
 * because they are not trip points — they are the conditions for coming
 * BACK. Putting a recover window in the same grid as a trip threshold is how
 * SolisCloud's flat list makes them look interchangeable.
 *
 * Labels are stated here for the same reason the matrix states its own: the
 * map's `name` for these is trustworthy, but stating them keeps one voice
 * across the screen. Scales and units still come from the map.
 */
export const BLOCKS: Block[] = [
  {
    title: 'Recover',
    note: 'The window the grid must sit inside, for the recover time, before the inverter reconnects after a trip.',
    rows: [
      { address: 3108, label: 'Recover voltage upper limit' },
      { address: 3109, label: 'Recover voltage lower limit' },
      { address: 3110, label: 'Recover frequency upper limit' },
      { address: 3111, label: 'Recover frequency lower limit' },
      {
        address: 3107,
        label: 'Recover time',
        description:
          'How long the grid must stay inside the recover window before reconnecting. The map calls this register "Reconnect time".',
      },
    ],
  },
  {
    title: 'Startup',
    note: 'The window the grid must sit inside, for the startup time, before the inverter connects from cold.',
    rows: [
      { address: 3112, label: 'Startup voltage upper limit' },
      { address: 3113, label: 'Startup voltage lower limit' },
      { address: 3114, label: 'Startup frequency upper limit' },
      { address: 3115, label: 'Startup frequency lower limit' },
      { address: 3106, label: 'Startup time' },
    ],
  },
  {
    title: 'Other',
    note: 'Two limits that are neither a trip stage nor a reconnect condition.',
    rows: [
      {
        address: 3147,
        label: '10 minute voltage',
        description:
          'The 10-minute rolling mean voltage limit several European codes require alongside the instantaneous trip stages.',
      },
      {
        address: 3148,
        label: 'Power ramp rate',
        description:
          'How fast output may climb back after a reconnect, as a percentage of rated power per minute.',
      },
    ],
  },
]

/** Every address the blocks name, ascending. */
export const BLOCK_ADDRESSES: number[] = BLOCKS.flatMap((b) =>
  b.rows.map((r) => r.address),
).sort((a, b) => a - b)

/**
 * Everything this screen reads: context, matrix, blocks.
 *
 * Derived from the tables above so the read sweep cannot fall out of step
 * with what is drawn.
 */
export const ALL_ADDRESSES: number[] = Array.from(
  new Set([GRID_CODE, PRECISION_FLAG, ...MATRIX_ADDRESSES, ...BLOCK_ADDRESSES]),
).sort((a, b) => a - b)

/* ------------------------------------------------------------------ *
 * The gospel, reached only through the settings scope
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
 * Exposed for cross-checking against a capture and for the test that pins the
 * shifted names on 3095-3105. NEVER use it as a row label — see the header.
 */
export function gospelName(address: number): string | null {
  return registerAt(address)?.name ?? null
}

/**
 * The rule for a settings register, or undefined.
 *
 * Wrapped so this screen names the scope exactly once. Rules for these
 * registers may not exist yet — most PV registers have none, which means
 * "write it plainly" — so every caller must cope with undefined.
 */
export function gridRuleFor(address: number): PvRule | undefined {
  return ruleFor('settings', address)
}

/** True when the rules file marks this register unwritable. */
export function isReadOnly(address: number): boolean {
  return (gridRuleFor(address)?.write as string | undefined) === 'read_only'
}

/**
 * Every matrix address really is in the settings space.
 *
 * Exists so a test can prove it. PV addresses collide across spaces, so a
 * cell that quietly resolved against the data space would draw a plausible
 * number from an entirely different register.
 */
export function assertSettingsSpace(addresses: number[]): number[] {
  return addresses.filter((a) => !settingsByAddress.has(a))
}

/* ------------------------------------------------------------------ *
 * Grid Code — labels from the map, never from here
 * ------------------------------------------------------------------ */

export interface CodeOption {
  value: number
  label: string
}

/**
 * The grid standards this firmware offers, straight out of the map.
 *
 * Sorted by value so the list order matches the enum the inverter reports,
 * which is what a screenshot from SolisCloud will be indexed by.
 */
export function gridCodeOptions(): CodeOption[] {
  const vm = registerAt(GRID_CODE)?.value_map
  if (!vm) return []
  return Object.entries(vm)
    .map(([value, label]) => ({ value: Number(value), label: String(label) }))
    .filter((o) => Number.isFinite(o.value))
    .sort((a, b) => a.value - b.value)
}

/** The label for a raw grid-code word, or null when the map has none. */
export function gridCodeLabel(raw: number | undefined): string | null {
  if (raw === undefined) return null
  return gridCodeOptions().find((o) => o.value === raw)?.label ?? null
}

/* ------------------------------------------------------------------ *
 * Precision — the runtime scale for stages 01 and 02
 * ------------------------------------------------------------------ */

/**
 * The three precisions the accuracy flag selects between.
 *
 * `voltage` and `frequency` are the multipliers a raw word is scaled BY;
 * `time` likewise, in seconds. So raw 2530 at `voltage: 0.1` is 253.0 V.
 */
export interface Precision {
  /** How 3089 produced this, for the screen to explain itself. */
  source: 'low-byte-0' | 'low-byte-1' | 'high-byte-single-rule'
  voltage: number
  frequency: number
  time: number
  /** Plain-English summary for the header. */
  summary: string
}

/**
 * Decode the accuracy flag.
 *
 * The HIGH byte wins. The document calls it the unmodifiable half: when
 * 3089 reads 0x01xx the machine is on a single-rule standard whose precision
 * is fixed at 0.1 V / 0.02 s / 0.01 Hz regardless of what the low byte says.
 * Checking the low byte first would report 0.1 s time precision on a
 * standard that actually uses 0.02 s — a factor of five on every trip time
 * on the screen.
 *
 * Returns null for an unread flag, never a default. There is no safe default
 * here: the two low-byte answers differ by a factor of ten on voltage, and
 * guessing wrong writes 2530 V where 253.0 V was meant.
 */
export function precisionFrom(raw: number | undefined): Precision | null {
  if (raw === undefined || !Number.isFinite(raw)) return null
  const high = (raw >> 8) & 0xff
  const low = raw & 0xff

  if (high === 0x01) {
    return {
      source: 'high-byte-single-rule',
      voltage: 0.1,
      frequency: 0.01,
      time: 0.02,
      summary:
        'Single-rule standard: 0.1 V, 0.02 s, 0.01 Hz. Fixed by the inverter and not changeable here.',
    }
  }
  if (low === 0x01) {
    return {
      source: 'low-byte-1',
      voltage: 0.1,
      frequency: 0.01,
      time: 0.01,
      summary: 'High precision: 0.1 V, 0.01 s, 0.01 Hz.',
    }
  }
  return {
    source: 'low-byte-0',
    voltage: 1,
    frequency: 0.1,
    time: 0.1,
    summary: 'Low precision: 1 V, 0.1 s, 0.1 Hz.',
  }
}

/**
 * True when this address takes its scale from the map rather than from 3089.
 *
 * Stage 03 (3119-3122) carries real scales — 0.1 V and 10 ms. Everything the
 * matrix holds outside that run is precision-flag driven. Decided by asking
 * the MAP whether it states a unit, not by listing addresses, so a corrected
 * map that finally gives 3090 a real scale starts being honoured with no
 * edit here.
 *
 * The map writes `unit: '1'` (and `units: ''`) on exactly the registers whose
 * precision 3089 owns; a register with a genuine scale says `0.1V` or `10ms`.
 */
export function hasFixedScale(address: number): boolean {
  const reg = registerAt(address)
  if (!reg) return false
  const unit = String((reg as any).unit ?? '').trim()
  // A real unit names a quantity. '1' and '' name nothing.
  return unit !== '' && unit !== '1'
}

/**
 * The multiplier to turn a raw word into a displayed value, or null.
 *
 * Null means "not yet knowable" — the cell depends on 3089 and 3089 has not
 * been read. The view must show the raw word and disable editing rather than
 * substitute a 1, because a silent 1 is the wrong-by-ten failure this whole
 * file exists to prevent.
 */
export function scaleForCell(
  address: number,
  part: CellPart,
  quantity: Quantity,
  precision: Precision | null,
): number | null {
  if (hasFixedScale(address)) {
    const scale = registerAt(address)?.scale
    return typeof scale === 'number' && scale > 0 ? scale : null
  }
  if (!precision) return null
  if (part === 'time') return precision.time
  return quantity === 'voltage' ? precision.voltage : precision.frequency
}

/**
 * The unit shown beside a cell's value.
 *
 * Fixed-scale registers carry their unit in the map (`0.1V` -> V, `10ms` ->
 * ms); the map's `units` field already holds the bare symbol, so it is
 * preferred. Precision-driven cells get the SI unit for their part, because
 * their magnitude is decided by 3089 and stating '0.1V' there would be a
 * claim this file cannot make.
 */
export function unitFor(
  address: number,
  part: CellPart,
  quantity: Quantity,
): string {
  if (hasFixedScale(address)) {
    const reg = registerAt(address)
    const units = String((reg as any).units ?? '').trim()
    if (units) return units
  }
  if (part === 'time') return 's'
  return quantity === 'voltage' ? 'V' : 'Hz'
}

/**
 * Decimal places to show, derived from the scale.
 *
 * A scale of 0.01 needs two places; a scale of 10 (the `10ms` stage-03 times)
 * needs none. Derived rather than declared so a corrected scale carries its
 * own formatting.
 */
export function decimalsFor(scale: number | null): number {
  if (!scale || scale >= 1) return 0
  return Math.min(4, Math.max(0, Math.round(-Math.log10(scale))))
}

/** Raw word -> the number a human reads. Null scale means "unknown". */
export function toDisplay(raw: number, scale: number | null): number {
  if (!scale) return raw
  return raw * scale
}

/**
 * The number a human typed -> the raw word to write.
 *
 * Rounded, not truncated: at 0.01 precision a typed 50.05 becomes 5004.999…
 * in floating point, and truncating writes 5004 — one count low, silently,
 * on a frequency trip point.
 */
export function toRaw(shown: number, scale: number | null): number {
  if (!scale) return Math.round(shown)
  return Math.round(shown / scale)
}

/**
 * Format a cell's value for display, or null when it cannot be known yet.
 *
 * Returns null — not '0', not '—' — so the view decides how to render an
 * unknown. A model that returned a string here would make "unread" and
 * "genuinely zero" indistinguishable at the call site.
 */
export function formatValue(
  raw: number | undefined,
  scale: number | null,
): string | null {
  if (raw === undefined || !Number.isFinite(raw)) return null
  return toDisplay(raw, scale).toFixed(decimalsFor(scale))
}

/** What the view renders where a (protection, stage) pair does not exist. */
export const CELL_MISSING = '—'

/**
 * The cell at a coordinate, or null when the combination does not exist.
 *
 * A named accessor rather than an index, so the view never writes
 * `STAGE_MATRIX[p][s]!` and never has to know that `null` is possible.
 */
export function cellAt(
  protection: ProtectionId,
  stage: StageId,
): Cell | null {
  return STAGE_MATRIX[protection]?.[stage] ?? null
}

/** The protection a row id names. */
export function protectionById(id: ProtectionId): Protection | undefined {
  return PROTECTIONS.find((p) => p.id === id)
}

/**
 * The label for one half of one cell, e.g. 'Over voltage stage 02 time'.
 *
 * Built from the matrix coordinates rather than read from the map, because
 * the map's names for this run are wrong (see the header). This is what goes
 * in the write console and in a cell's tooltip.
 */
export function cellLabel(
  protection: ProtectionId,
  stage: StageId,
  part: CellPart,
): string {
  const p = protectionById(protection)
  const base = p ? p.label : protection
  return `${base} stage ${stage} ${part === 'time' ? 'time' : 'level'}`
}
