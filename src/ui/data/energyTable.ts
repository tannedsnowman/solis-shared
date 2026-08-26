/**
 * The energy table: one togglable row per category.
 *
 * Charge and discharge are SEPARATE ROWS, as are import and export, because
 * they are separate registers. Merging them into one cell would force a
 * "11.3 / 93.3" format that cannot carry a register number per half.
 *
 * A period the inverter does not publish renders as a dash with no register,
 * never as 0 -- the battery has no month or year counter at all, and neither
 * does the grid import/export pair. Rendering 0 there would tell a user their
 * battery did nothing this month, when the truth is the inverter simply never
 * reports a monthly figure for that quantity.
 *
 * Every address below was checked against `src/mapper/generated/hybrid.json`
 * directly (see the task report for the full register-by-register table):
 *   - BATT CHG:    today 33163, yesterday 33164, total 33161 -- u16/u16/u32,
 *     scale 0.1/0.1/1, units kWh. No month or year register exists.
 *   - BATT DCHG:   today 33167, yesterday 33168, total 33165 -- same shape.
 *     No month or year register exists.
 *   - GRID IMPORT: today 33171, yesterday 33172, total 33169 -- same shape.
 *     No month or year register exists.
 *   - GRID EXPORT: today 33175, yesterday 33176, total 33173 -- same shape.
 *     No month or year register exists.
 *   - LOAD:        today 33586, yesterday 33587, month 33584, year 33582,
 *     total 33580 -- full five-period set, u16/u16/u32/u32/u32, kWh.
 *   - PV:          today 33035, yesterday 33036, month 33033, year 33037,
 *     total 33029 -- full five-period set. Note 33033 is named "Last month"
 *     in the gospel (it is the completed-month figure, the same shape as
 *     every other "month" counter in this table) and 33037 is "This year".
 *   - BACKUP LOAD: today 33596, yesterday 33597, month 33594, year 33592,
 *     total 33590 -- full five-period set, kWh.
 *   - GENERATOR:   today 33531, yesterday 34444, month 34442, year 34440,
 *     total 33532 -- full five-period set, kWh.
 *   - SMART LOAD:  today 34413, yesterday 34439, month 34437, year 34435,
 *     total 34411 -- full five-period set. 34439/34437/34435 carry empty
 *     units in the gospel (a blank `units` field on those three records),
 *     which does not affect this table since kWh formatting comes from
 *     `decodeAddress`, not a hand-written unit string.
 *
 * None of these 37 registers decode to an enum or bitfield (no `value_map`,
 * no `bit_flags` on any of them in the gospel), so there is no
 * `stripCell`-style unit-append hazard here -- checked directly, not assumed.
 */
import { decodeAddress, NO_READING } from "./decode";
import { RawReader } from './rawReader';
import { PhaseCell } from "./phaseTable";

export interface EnergyCategory {
  key: string;
  label: string;
  today?: number;
  yesterday?: number;
  month?: number;
  year?: number;
  total?: number;
}

export interface EnergyRow {
  key: string;
  label: string;
  cells: PhaseCell[];
}

export interface EnergyTableModel {
  columns: string[];
  rows: EnergyRow[];
  addresses: number[];
}

/**
 * The nine energy categories, in fixed display order. `energyTable` filters
 * this list rather than the caller's `enabled` array, so the order on screen
 * never depends on the order categories were toggled on.
 */
export const ENERGY_CATEGORIES: EnergyCategory[] = [
  { key: "battChg", label: "BATT CHG", today: 33163, yesterday: 33164, total: 33161 },
  { key: "battDchg", label: "BATT DCHG", today: 33167, yesterday: 33168, total: 33165 },
  { key: "gridImport", label: "GRID IMPORT", today: 33171, yesterday: 33172, total: 33169 },
  { key: "gridExport", label: "GRID EXPORT", today: 33175, yesterday: 33176, total: 33173 },
  { key: "load", label: "LOAD", today: 33586, yesterday: 33587, month: 33584, year: 33582, total: 33580 },
  { key: "pv", label: "PV", today: 33035, yesterday: 33036, month: 33033, year: 33037, total: 33029 },
  { key: "backupLoad", label: "BACKUP LOAD", today: 33596, yesterday: 33597, month: 33594, year: 33592, total: 33590 },
  { key: "generator", label: "GENERATOR", today: 33531, yesterday: 34444, month: 34442, year: 34440, total: 33532 },
  { key: "smartLoad", label: "SMART LOAD", today: 34413, yesterday: 34439, month: 34437, year: 34435, total: 34411 },
];

/** Default set shown before a user has toggled anything. */
export const DEFAULT_ENERGY_CATEGORIES: string[] = [
  "battChg",
  "battDchg",
  "gridImport",
  "gridExport",
  "load",
  "pv",
];

/** localStorage key holding the user's chosen category list. */
export const ENERGY_CATEGORIES_STORAGE_KEY = "hybridEnergyCategories";

const PERIODS: Array<keyof EnergyCategory> = [
  "today",
  "yesterday",
  "month",
  "year",
  "total",
];

/** A period with no register is a dash with no register -- not a zero. */
function periodCell(read: RawReader, address?: number): PhaseCell {
  if (address === undefined) return { text: NO_READING, reg: "" };
  const d = decodeAddress(address, read.at(address));
  return { text: d.missing ? NO_READING : d.text, reg: String(address) };
}

export function energyTable(
  read: RawReader,
  enabled: string[],
): EnergyTableModel {
  const chosen = ENERGY_CATEGORIES.filter((c) => enabled.includes(c.key));
  const addresses: number[] = [];
  const rows = chosen.map((c) => {
    const cells = PERIODS.map((p) => {
      const a = c[p] as number | undefined;
      if (a !== undefined) addresses.push(a);
      return periodCell(read, a);
    });
    return { key: c.key, label: c.label, cells };
  });
  return {
    columns: ["TODAY", "YESTERDAY", "MONTH", "YEAR", "TOTAL"],
    rows,
    addresses,
  };
}
