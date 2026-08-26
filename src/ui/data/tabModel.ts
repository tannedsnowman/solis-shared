/**
 * The port of `DCLogic.data()` and `DCLogic.extras()` from
 * `docs/superpowers/designs/Detail Panels.dc.html`.
 *
 * The design's sample data is replaced, panel for panel, by real readings
 * decoded through the gospel. Layout, ordering, colours and column counts are
 * unchanged.
 *
 * Nothing here hard-codes a scale, a unit, an enum table or a bit label. Every
 * one of those comes out of the gospel record, so 65 registers already render
 * a label, 39 render a bit list, and the rest start doing so the moment the
 * enum/bitfield task lands more.
 */
import { byAddress, GospelRegister } from '../../gospel/gospel';
import { group, slot } from '../pv/captures';
import {
  decodeAddress,
  decodeSplitWord,
  Decoded,
  NO_READING,
  SPLIT_WORD_PAIRS,
  toHexWord,
} from "./decode";
import { RawReader } from './rawReader';
import { C } from "./panelStyles";

export type TabKey =
  | "grid"
  | "battery"
  | "batteryAll"
  | "pv"
  | "device"
  | "deviceAll"
  | "dispatch"
  | "faults";

export const TAB_DEFS: Array<[TabKey, string]> = [
  ["grid", "GRID METER"],
  ["battery", "BATTERY"],
  ["pv", "PV"],
  ["device", "DEVICE"],
  ["faults", "FAULTS"],
];

export interface Kpi {
  label: string;
  value: string;
  unit: string;
  sub: string;
  color?: string;
}

export interface MatrixCol {
  label: string;
  reg?: string;
}

export interface MatrixCell {
  text: string;
  color?: string;
  strong?: boolean;
  /**
   * This value was CALCULATED, not read from a register.
   *
   * Rendered in italics by `DataPanel` so a derived number can never be
   * mistaken for a measurement. Set it wherever a cell is arithmetic over
   * other registers — see `pvTabModel.ts`, where a PV inverter's per-phase
   * power has no register of its own and must be derived.
   */
  calc?: boolean;
}

export interface DetailRow {
  label: string;
  reg: string;
  value: string;
  color?: string;
  /** `revision_note` from the gospel. Surfaced as a title tooltip. */
  note?: string;
  /** Calculated, not read. Rendered in italics. See `MatrixCell.calc`. */
  calc?: boolean;
}

export interface DetailBlock {
  title: string;
  rows: DetailRow[];
}

export interface BarItem {
  label: string;
  value: string;
  pct: number;
  color?: string;
  /** Calculated, not read. Rendered in italics. See `MatrixCell.calc`. */
  calc?: boolean;
}

export interface BarPanel {
  title: string;
  note: string;
  bars: BarItem[];
}

export interface TabModel {
  regRange: string;
  /**
   * Every absolute address this panel reads.
   *
   * The range-button row above uses it to shade the blocks that actually feed
   * the panel on screen, so it is obvious which button to press to populate
   * it. Collected rather than derived from `regRange`, because a panel's
   * registers are not always one contiguous span — GRID METER draws mostly
   * from 33250+ but also reads 33171, 33091 and 43098.
   */
  addresses: number[];
  kpis: Kpi[];
  matrixTitle: string;
  matrixNote: string;
  matrixCols: MatrixCol[];
  matrixRows: MatrixCell[][];
  blocks: DetailBlock[];
  extra: BarPanel;
}

/* ── small shared helpers ──────────────────────────────────────────── */

/**
 * Drop the bars that could not be drawn.
 *
 * `bar` returns null for a reading the device never sent, or one with no
 * published full-scale to draw it against. Removing them here is what keeps
 * an unread value from rendering as an empty track that reads as a real 0.
 */
function compact(items: Array<BarItem | null>): BarItem[] {
  return items.filter((b): b is BarItem => b !== null);
}

/**
 * Decode one of the two split-word power readings.
 *
 * `decodeSplitWord` needs both halves, and BOTH addresses must be recorded on
 * the model so the range-button hint shades each block — the halves are
 * 1 196 registers apart, so a user who fetched only the low block would
 * otherwise have no way to know why the value reads "--".
 */
export function splitWordAt(read: RawReader, lowAddress: number): Decoded {
  const highAddress = SPLIT_WORD_PAIRS[lowAddress];
  if (highAddress === undefined) {
    throw new Error(
      `${lowAddress} is not the low half of a split word -- ` +
        'splitWordAt was called with an address SPLIT_WORD_PAIRS does not pair',
    );
  }
  return decodeSplitWord(lowAddress, read.at(lowAddress), read.at(highAddress));
}

/** A detail row for a split-word reading, labelled with both addresses. */
export function splitWordRow(
  read: RawReader,
  lowAddress: number,
  label: string,
  opts: { text?: (d: Decoded) => string } = {},
): DetailRow {
  const d = splitWordAt(read, lowAddress);
  const value = opts.text
    ? opts.text(d)
    : d.missing
      ? NO_READING
      : d.units
        ? `${d.text} ${d.units}`
        : d.text;
  return {
    label,
    reg: `${lowAddress}+${SPLIT_WORD_PAIRS[lowAddress]}`,
    value,
    color: d.missing ? C.dim : undefined,
    note: noteFor(lowAddress),
  };
}

/** A dimmed em dash, as the design renders an absent reading. */
const gone: MatrixCell = { text: NO_READING, color: C.dim };

/**
 * A "% of rated" cell.
 *
 * Both halves must be real: the reading AND the rating it is measured
 * against. If the device has not published its rating there is no percentage
 * to state, so the cell reads "--" rather than inventing a denominator.
 */
function pctCell(d: Decoded, rating: number): MatrixCell {
  const pct = pctOf(d, rating);
  return pct === null ? gone : { text: `${pct.toFixed(0)} %` };
}

/** A matrix cell from a decode: dimmed when there is no reading. */
function cell(
  d: Decoded,
  opts: { color?: string; strong?: boolean } = {},
): MatrixCell {
  if (d.missing) return gone;
  return { text: d.text, color: opts.color, strong: opts.strong };
}

/** Green when charging into the system, red when flowing out. */
export function signColor(value: number | null): string | undefined {
  if (value === null || value === 0) return undefined;
  return value > 0 ? C.green : C.red;
}

/** The design writes power with a space as the thousands separator. */
export function groupThousands(text: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(text);
  if (!m) return text;
  const grouped = group(m, 2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${m[1]}${grouped}${m[3] ?? ""}`;
}

/**
 * Power written at a magnitude a human can read.
 *
 * A 30 kW hybrid reports watts, and watts are the right unit for it. But the
 * SAME registers on a commercial or parallel-block install carry numbers in
 * the millions, and "1 116 740 960 W" is a wall of digits nobody can size at
 * a glance. So the unit is chosen from the magnitude:
 *
 *   < 1 000 000 W  ->  watts, unchanged, grouped in threes
 *   >= 1 000 000 W ->  megawatts to 3 dp
 *
 * The threshold is deliberately at MW, not kW. Dropping to kW at 1 000 W
 * would rewrite every ordinary domestic reading and lose the resolution the
 * rest of the panel is built around; the problem being solved here is only
 * the rightfully-enormous end of the range.
 *
 * `missing` is preserved: a register that was never read still reads "--",
 * never "0.000 MW".
 */
export function autoPower(d: Decoded): { text: string; units: string } {
  if (d.missing || d.value === null) return { text: NO_READING, units: '' };
  const units = d.units || 'W';
  // Only real power units auto-scale. A voltage of 1 000 000 would be a fault
  // reading, not a megavolt, and renaming its unit would hide that.
  if (units !== 'W' || Math.abs(d.value) < 1_000_000) {
    return { text: groupThousands(d.text), units };
  }
  return { text: (d.value / 1_000_000).toFixed(3), units: 'MW' };
}

/** `autoPower` as one string, unit included — what a detail row wants. */
export function autoPowerText(d: Decoded): string {
  const { text, units } = autoPower(d);
  if (text === NO_READING) return NO_READING;
  return units ? `${text} ${units}` : text;
}

/** Signed power, with the leading + the design shows on export/charge. */
export function signedPower(d: Decoded): string {
  if (d.missing || d.value === null) return NO_READING;
  const body = groupThousands(d.text.replace(/^-/, ""));
  if (d.value > 0) return `+${body}`;
  if (d.value < 0) return `-${body}`;
  return body;
}

/** W -> kW with 2dp, the KPI scale the design uses for power. */
export function kw(d: Decoded, signed = false): string {
  if (d.missing || d.value === null) return NO_READING;
  const v = d.value / 1000;
  const t = v.toFixed(2);
  return signed && v > 0 ? `+${t}` : t;
}

/**
 * Percentage of a rating, for the bar fills.
 *
 * Returns null — not 0 — when there is nothing to draw, because a 0 % bar and
 * an unread bar look identical and 0 is a real reading. A null tells the
 * caller to drop the bar rather than draw an empty track.
 */
export function pctOf(d: Decoded, rating: number): number | null {
  if (d.missing || d.value === null || !rating) return null;
  return (Math.abs(d.value) / rating) * 100;
}

/** Percentage across an explicit window, for cell-voltage style bars. */
export function pctBetween(d: Decoded, lo: number, hi: number): number | null {
  if (d.missing || d.value === null || hi === lo) return null;
  return ((d.value - lo) / (hi - lo)) * 100;
}

/** `revision_note` for an address, so a row can carry its own history. */
export function noteFor(address: number): string | undefined {
  return byAddress.get(address)?.revision_note ?? undefined;
}

/** The gospel's own name for an address, used where a label is generic. */
export function nameFor(address: number): string | undefined {
  return byAddress.get(address)?.name;
}

/**
 * A detail row straight from an address.
 *
 * The label defaults to the gospel `name`, the value to the decoded text with
 * its units, and the tooltip to `revision_note`.
 */
export function row(
  read: RawReader,
  address: number,
  label: string,
  opts: { color?: string; text?: (d: Decoded) => string } = {},
): DetailRow {
  const d = decodeAddress(address, read.at(address));
  const text = opts.text
    ? opts.text(d)
    : d.missing
      ? NO_READING
      : d.units && d.label === null && !d.bits.length
        ? `${d.text} ${d.units}`
        : d.text;
  return {
    label,
    reg: String(address),
    value: text,
    color: d.missing ? C.dim : opts.color,
    note: noteFor(address),
  };
}

/** A literal row for something the map does not hold (a computed pair). */
export function literalRow(
  label: string,
  reg: string,
  value: string,
  color?: string,
): DetailRow {
  return { label, reg, value, color };
}

/* ── fault accounting, shared by the device bar and the FAULTS tab ─── */

/** Every register the map marks as a fault or warning word. */
export const FAULT_WORDS = [
  33116, 33117, 33118, 33119, 33120, 33124, 33125,
] as const;

export const BATTERY_FAULT_WORDS = [33145, 33146] as const;

export const WARNING_WORDS = [33339] as const;

/**
 * The extended fault block, 34394-34402.
 *
 * Nine more 16-bit fault words the original seven do not reach — the map gives
 * all nine full bit_flags, so they decode to labels exactly as 33116 does.
 * 34403-34406 exist too but carry no bit_flags in the map, so they are shown
 * as raw words in the matrix rather than counted as faults; counting a word we
 * cannot name would inflate the total with anonymous bits.
 */
export const EXT_FAULT_WORDS = [
  34394, 34395, 34396, 34397, 34398, 34399, 34400, 34401, 34402,
] as const;

/**
 * The SPH (off-grid/generator cabinet) fault pair.
 *
 * Separate from the inverter's own words because an installation without an
 * SPH cabinet never reads them, and a missing word must not read as "clear".
 */
export const SPH_FAULT_WORDS = [34260, 34261] as const;

/**
 * Bit-flag words that report STATE rather than a fault.
 *
 * Counted apart from the fault words on purpose: "Self-Use" set in 33132 or
 * "Grid-Connected" in 33121 is the inverter working normally, and folding
 * those bits into a fault total would report a healthy device as faulty.
 */
export const STATE_WORDS = [
  33121, 33122, 33132, 33097, 33190, 33463, 33248,
] as const;

/**
 * Derate and restriction bits — 33463.
 *
 * Neither fault nor plain state: the inverter is running but deliberately
 * holding power back. Surfaced on its own so a "why is it only making 2 kW"
 * question has somewhere to be answered.
 */
export const DERATE_WORD = 33463;

/** Count the set, non-Reserve bits across a set of flag words. */
export function countFlags(
  read: RawReader,
  addresses: readonly number[],
): number {
  let n = 0;
  for (const a of addresses) {
    const d = decodeAddress(a, read.at(a));
    if (!d.missing) n += d.bits.length;
  }
  return n;
}

/** Every set flag across a set of words, as `{ address, label }`. */
export function listFlags(
  read: RawReader,
  addresses: readonly number[],
): Array<{ address: number; label: string }> {
  const out: Array<{ address: number; label: string }> = [];
  for (const a of addresses) {
    const d = decodeAddress(a, read.at(a));
    for (const label of d.bits) out.push({ address: a, label });
  }
  return out;
}

/* ── the tabs ──────────────────────────────────────────────────────── */

export function gridTab(read: RawReader): TabModel {
  const V = [33251, 33253, 33255] as const;
  const I = [33252, 33254, 33256] as const;
  const P = [33257, 33259, 33261] as const;
  const Q = [33265, 33267, 33269] as const;
  const S = [33273, 33275, 33277] as const;

  const totalP = decodeAddress(33263, read.at(33263));
  const totalQ = decodeAddress(33271, read.at(33271));
  const totalS = decodeAddress(33279, read.at(33279));
  const pf = decodeAddress(33281, read.at(33281));
  const freq = decodeAddress(33282, read.at(33282));
  const imported = decodeAddress(33171, read.at(33171));
  const exported = decodeAddress(33175, read.at(33175));
  const rating = ratedVA(read);
  const ratedV = ratingAt(read, 33718); // acRatedVoltage
  const ratedF = ratingAt(read, 43098); // ovGF01, primary over-frequency trip

  const phaseRow = (i: number, name: string): MatrixCell[] => {
    const v = decodeAddress(slot(V, i), read.at(slot(V, i)));
    const c = decodeAddress(slot(I, i), read.at(slot(I, i)));
    const p = decodeAddress(slot(P, i), read.at(slot(P, i)));
    const q = decodeAddress(slot(Q, i), read.at(slot(Q, i)));
    const s = decodeAddress(slot(S, i), read.at(slot(S, i)));
    return [
      { text: name, color: undefined },
      cell(v),
      cell(c),
      p.missing ? gone : { text: signedPower(p), color: C.purple },
      q.missing ? gone : { text: groupThousands(q.text) },
      s.missing ? gone : { text: groupThousands(s.text) },
      i === 0 ? cell(pf) : gone,
    ];
  };

  return {
    addresses: [],
    regRange: "33250–33290",
    kpis: [
      {
        label: "ACTIVE POWER",
        value: kw(totalP, true),
        unit: "kW",
        sub: "reg 33263",
        color: C.purple,
      },
      {
        label: "FREQUENCY",
        value: freq.text,
        unit: freq.units || "Hz",
        sub: "reg 33282",
      },
      {
        label: "IMPORT / EXPORT",
        value: `${imported.text}/${exported.text}`,
        unit: "kWh",
        sub: "today",
      },
    ],
    matrixTitle: "GRID METER · PER PHASE",
    matrixNote: "V/A/W/var/VA",
    matrixCols: [
      { label: "PHASE" },
      { label: "V", reg: "33251" },
      { label: "I", reg: "33252" },
      { label: "P", reg: "33257" },
      { label: "Q", reg: "33265" },
      { label: "S", reg: "33273" },
      { label: "PF" },
    ],
    matrixRows: [
      phaseRow(0, "A"),
      phaseRow(1, "B"),
      phaseRow(2, "C"),
      [
        { text: "TOTAL", color: C.ink3 },
        gone,
        gone,
        totalP.missing
          ? gone
          : { text: signedPower(totalP), color: C.purple, strong: true },
        totalQ.missing ? gone : { text: groupThousands(totalQ.text) },
        totalS.missing ? gone : { text: groupThousands(totalS.text) },
        cell(pf),
      ],
    ],
    blocks: [
      {
        title: "METER",
        rows: [
          row(read, 33250, "CT position"),
          row(read, 33246, "Parallel CT detect"),
          row(read, 33283, "Total from grid"),
          row(read, 33285, "Total to grid"),
        ],
      },
      {
        title: "EXPORT CONTROL",
        rows: [
          row(read, 33248, "EPM fail-safe"),
          row(read, 33092, "Grid standard"),
          row(read, 33091, "Working mode"),
          row(read, 33468, "G100 v2 status"),
          row(read, 33151, "AC grid port power"),
        ],
      },
    ],
    extra: {
      title: "PHASE BALANCE",
      note: `% of ${rating ? groupThousands(String(rating)) : "—"} VA rating`,
      // Voltage bars scale against the device's OWN rated AC voltage (33718)
      // and frequency against its own over-frequency trip (43098), not against
      // numbers invented for the design mock. Where the device has not
      // published its rating the bar is dropped by `bar`, because an
      // unscaled bar cannot be read.
      bars: compact([
        bar(
          "A active",
          decodeAddress(P[0], read.at(P[0])),
          rating,
          C.purple,
          signedPower,
        ),
        bar("A voltage", decodeAddress(V[0], read.at(V[0])), ratedV, C.blue),
        bar(
          "B active",
          decodeAddress(P[1], read.at(P[1])),
          rating,
          C.purple,
          signedPower,
        ),
        bar("B voltage", decodeAddress(V[1], read.at(V[1])), ratedV, C.blue),
        bar(
          "C active",
          decodeAddress(P[2], read.at(P[2])),
          rating,
          C.purple,
          signedPower,
        ),
        bar("C voltage", decodeAddress(V[2], read.at(V[2])), ratedV, C.blue),
        bar("Total active", totalP, rating, C.purple, signedPower),
        bar("Frequency", freq, ratedF, C.green),
      ]),
    },
  };
}

export function batteryTab(read: RawReader): TabModel {
  const soc = decodeAddress(33139, read.at(33139));
  const soh = decodeAddress(33140, read.at(33140));
  const v1 = decodeAddress(33133, read.at(33133));
  const i1 = decodeAddress(33134, read.at(33134));
  const p1 = decodeAddress(33149, read.at(33149));
  const dir = decodeAddress(33135, read.at(33135));
  const temp = decodeAddress(33043, read.at(33043));

  const soc2 = decodeAddress(34417, read.at(34417));
  const soh2 = decodeAddress(34418, read.at(34418));
  /* 34368, not 34607. The gospel holds `battery2Power` at both addresses —
     34368 for this unit and 34607 at module-1 scope — and the store's address
     index keeps the FIRST record per key, so 34607 resolves to no store key
     and could only ever read "--". */
  const p2 = decodeAddress(34368, read.at(34368));
  const dir2 = decodeAddress(34291, read.at(34291));
  const temp2 = decodeAddress(34277, read.at(34277));

  const chgToday = decodeAddress(33163, read.at(33163));
  const dchgToday = decodeAddress(33167, read.at(33167));
  const chgLimit = decodeAddress(33143, read.at(33143));
  const dchgLimit = decodeAddress(33144, read.at(33144));

  const cellLo = decodeAddress(34375, read.at(34375));
  const cellHi = decodeAddress(34376, read.at(34376));
  // Full-scale values for the bars, read from the device rather than invented.
  const cellMax = ratingAt(read, 34374); // bms2HighestSingleCellVoltage
  const currentMax = ratingAt(read, 33041); // maxChargeDischargeCurrentModel

  return {
    addresses: [],
    regRange: "33133–33167",
    kpis: [
      { label: "SYSTEM SOC", value: soc.text, unit: "%", sub: "reg 33139" },
      {
        label: "NET POWER",
        value: kw(p1, true),
        unit: "kW",
        sub: "+ charge / - discharge",
        color: signColor(p1.value) ?? C.green,
      },
      {
        label: "SOH",
        value: soh2.missing ? soh.text : `${soh.text}/${soh2.text}`,
        unit: "%",
        sub: soh2.missing ? "pack 1" : "pack 1 / pack 2",
      },
      {
        label: "CHG / DCHG",
        value: `${chgToday.text}/${dchgToday.text}`,
        unit: "kWh",
        sub: "today",
      },
    ],
    matrixTitle: "BATTERIES · COLLECTIVE",
    matrixNote: "inverter-side values · BMS below",
    matrixCols: [
      { label: "PACK" },
      { label: "SOC", reg: "33139" },
      { label: "V", reg: "33133" },
      { label: "I", reg: "33134" },
      { label: "P", reg: "33149" },
      { label: "TEMP", reg: "33043" },
      { label: "STATE", reg: "33135" },
    ],
    matrixRows: [
      [
        { text: "BAT 1" },
        soc.missing ? gone : { text: `${soc.text} %` },
        cell(v1),
        i1.missing
          ? gone
          : { text: signedPower(i1), color: signColor(i1.value) },
        p1.missing
          ? gone
          : { text: signedPower(p1), color: signColor(p1.value) },
        temp.missing ? gone : { text: `${temp.text} ℃` },
        dir.missing
          ? gone
          : { text: dir.text, color: signColor(p1.value), strong: true },
      ],
      [
        { text: "BAT 2" },
        soc2.missing ? gone : { text: `${soc2.text} %` },
        gone,
        gone,
        p2.missing
          ? gone
          : { text: signedPower(p2), color: signColor(p2.value) },
        temp2.missing ? gone : { text: `${temp2.text} ℃` },
        dir2.missing
          ? gone
          : { text: dir2.text, color: signColor(p2.value), strong: true },
      ],
    ],
    blocks: [
      {
        title: "BMS · PACK 1",
        rows: [
          splitWordRow(read, 33141, "BMS voltage"),
          row(read, 33142, "BMS current"),
          row(read, 33143, "Max charge I"),
          row(read, 33144, "Max discharge I"),
          row(read, 33110, "Charge V limit"),
          row(read, 33111, "BMS status"),
          row(read, 33145, "Fault 01", {
            text: (d) =>
              d.missing ? NO_READING : `${toHexWord(d.raw)} ${d.text}`,
          }),
          row(read, 33146, "Fault 02", {
            text: (d) =>
              d.missing ? NO_READING : `${toHexWord(d.raw)} ${d.text}`,
          }),
        ],
      },
      {
        title: "BMS · PACK 2",
        rows: [
          /* This block was shifted by two: 34273 and 34274 are not in the map
             at all, so those two rows could only ever read "--", and every
             label below them named the register two addresses back. The pack-2
             block actually starts at 34275. Charge/discharge limits are at
             34281/34282, not 34275/34276. */
          splitWordRow(read, 34275, "BMS voltage"),
          row(read, 34276, "BMS current"),
          row(read, 34277, "Temperature"),
          row(read, 34281, "Max charge I"),
          row(read, 34282, "Max discharge I"),
          row(read, 34578, "BMS status"),
          row(read, 34375, "Cell lo"),
          row(read, 34376, "Cell hi"),
        ],
      },
    ],
    extra: {
      title: "BATTERY DETAIL",
      note: "inverter and BMS side by side",
      // SOC and SOH are already percentages, so they are their own scale.
      // Cell voltage scales against the pack's own reported maximum cell
      // voltage (34374) and the current bars against the device's own
      // charge/discharge current rating (33041). Temperature has no rated
      // value anywhere in the map, so those bars are not drawn at all rather
      // than being scaled against a guess.
      bars: compact([
        bar2("P1 SOC", soc, `${soc.text} %`, soc.value, C.green),
        bar2("P2 SOC", soc2, `${soc2.text} %`, soc2.value, C.green),
        bar2("P1 SOH", soh, `${soh.text} %`, soh.value, C.blue),
        bar2("P2 SOH", soh2, `${soh2.text} %`, soh2.value, C.blue),
        bar("Cell lo", cellLo, cellMax, C.green),
        bar("Cell hi", cellHi, cellMax, C.green),
        bar("Chg limit", chgLimit, currentMax, C.green),
        bar("Dchg limit", dchgLimit, currentMax, C.red),
      ]),
    },
  };
}

/**
 * BATTERY — both packs and the energy totals on one panel.
 *
 * Replaces three legacy widgets at once: `Battery.tsx` (pack 1), `BMSWidget`
 * (pack 2) and `BatteryEnergy` (the kWh counters). They were split because the
 * legacy path had one widget per register block; nothing about the data wants
 * that split, and an installer comparing the two packs had to open two panels
 * to do it.
 *
 * `batteryTab` above is the design-port version and stays for the tab model.
 * This one extends it: pack 2 gets the same depth as pack 1 (its own BMS
 * limits, cell extremes and cell LOCATIONS), and the energy counters that
 * previously lived in their own widget become the fourth KPI plus a detail
 * block.
 *
 * Two address choices are worth stating, because the obvious register is the
 * wrong one in both cases:
 *
 * - Pack 2 power reads 34368, not 34607. The gospel holds `battery2Power`
 *   twice — 34368 (this unit) and 34607 (module 1 scope) — and the store's
 *   address index keeps the FIRST record per key, so 34607 resolves to no
 *   legacy store name at all and can never return a word. 34368 is the one
 *   the device actually files.
 * - Pack 1 SOC/SOH come from 33139/33140 (inverter side), pack 2 from
 *   34278/34279 (BMS side). 34417/34418 are the inverter's own copy of pack
 *   2's pair and are shown separately, because on a healthy system they agree
 *   and a disagreement is the interesting reading.
 */
export function batteryAllTab(read: RawReader): TabModel {
  /* Pack 1, inverter side. */
  const soc1 = decodeAddress(33139, read.at(33139));
  const soh1 = decodeAddress(33140, read.at(33140));
  const v1 = decodeAddress(33133, read.at(33133));
  const i1 = decodeAddress(33134, read.at(33134));
  const p1 = decodeAddress(33149, read.at(33149));
  const dir1 = decodeAddress(33135, read.at(33135));
  const temp1 = decodeAddress(33043, read.at(33043));

  /* Pack 2. SOC/SOH from its own BMS; V/I/P/direction from the inverter. */
  const soc2 = decodeAddress(34278, read.at(34278));
  const soh2 = decodeAddress(34279, read.at(34279));
  const v2 = decodeAddress(34289, read.at(34289));
  const i2 = decodeAddress(34290, read.at(34290));
  const p2 = decodeAddress(34368, read.at(34368));
  const dir2 = decodeAddress(34291, read.at(34291));
  const temp2 = decodeAddress(34277, read.at(34277));

  /* Energy counters. Both packs are summed into these on dual-port models. */
  const chgToday = decodeAddress(33163, read.at(33163));
  const dchgToday = decodeAddress(33167, read.at(33167));

  /* Cell extremes. Pack 1 at 34348-34351, pack 2 at 34373-34376. */
  const cellLo1 = decodeAddress(34348, read.at(34348));
  const cellHi1 = decodeAddress(34349, read.at(34349));
  const cellLo2 = decodeAddress(34373, read.at(34373));
  const cellHi2 = decodeAddress(34374, read.at(34374));

  const chgLimit1 = decodeAddress(33143, read.at(33143));
  const dchgLimit1 = decodeAddress(33144, read.at(33144));
  const chgLimit2 = decodeAddress(34281, read.at(34281));
  const dchgLimit2 = decodeAddress(34282, read.at(34282));

  /* Full scales, every one of them read from the device. A pack's OWN highest
     cell voltage is the only published scale for its cell bars, and the two
     packs report separately, so each is scaled against its own. */
  const cellMax1 = ratingAt(read, 34349); // maxSingleCellVoltage
  const cellMax2 = ratingAt(read, 34374); // bms2HighestSingleCellVoltage
  const currentMax = ratingAt(read, 33041); // maxChargeDischargeCurrentModel
  const powerMax = ratingAt(read, 33729); // ratedOutputPowerBattery

  const netPower =
    p1.missing && p2.missing ? NO_READING : kw(p1.missing ? p2 : p1, true);

  return {
    addresses: [],
    regRange: "33041–34390",
    kpis: [
      {
        label: "SOC",
        value: soc2.missing ? soc1.text : `${soc1.text}/${soc2.text}`,
        unit: "%",
        sub: soc2.missing ? "pack 1 · reg 33139" : "pack 1 / pack 2",
      },
      {
        label: "NET POWER",
        value: netPower,
        unit: "kW",
        sub: "+ charge / - discharge",
        color: signColor(p1.value ?? p2.value) ?? C.green,
      },
      {
        label: "SOH",
        value: soh2.missing ? soh1.text : `${soh1.text}/${soh2.text}`,
        unit: "%",
        sub: soh2.missing ? "pack 1 · reg 33140" : "pack 1 / pack 2",
      },
      {
        label: "CHG / DCHG",
        value: `${chgToday.text}/${dchgToday.text}`,
        unit: "kWh",
        sub: "today · both packs",
      },
    ],
    matrixTitle: "BATTERY PACKS",
    matrixNote: "inverter-side V/I/P · BMS temperature",
    matrixCols: [
      { label: "PACK" },
      { label: "SOC", reg: "33139" },
      { label: "V", reg: "33133" },
      { label: "I", reg: "33134" },
      { label: "P", reg: "33149" },
      { label: "TEMP", reg: "33043" },
      { label: "STATE", reg: "33135" },
    ],
    matrixRows: [
      [
        { text: "PACK 1" },
        soc1.missing ? gone : { text: `${soc1.text} %` },
        cell(v1),
        i1.missing
          ? gone
          : { text: signedPower(i1), color: signColor(i1.value) },
        p1.missing
          ? gone
          : { text: signedPower(p1), color: signColor(p1.value) },
        cell(temp1),
        dir1.missing
          ? gone
          : { text: dir1.text, color: signColor(p1.value), strong: true },
      ],
      [
        { text: "PACK 2" },
        soc2.missing ? gone : { text: `${soc2.text} %` },
        cell(v2),
        i2.missing
          ? gone
          : { text: signedPower(i2), color: signColor(i2.value) },
        p2.missing
          ? gone
          : { text: signedPower(p2), color: signColor(p2.value) },
        cell(temp2),
        dir2.missing
          ? gone
          : { text: dir2.text, color: signColor(p2.value), strong: true },
      ],
    ],
    blocks: [
      {
        title: "BMS · PACK 1",
        rows: [
          splitWordRow(read, 33141, "BMS voltage"),
          row(read, 33142, "BMS current"),
          row(read, 33143, "Max charge I"),
          row(read, 33144, "Max discharge I"),
          row(read, 33110, "Charge V limit"),
          row(read, 34346, "Discharge V limit"),
          row(read, 33111, "BMS status"),
          row(read, 33046, "Battery MOSFET temp"),
          // Both fault words are bitfields, but the hex is what a Solis
          // engineer quotes down the phone, so it leads and the decoded bit
          // list follows.
          row(read, 33145, "Fault 01", {
            text: (d) =>
              d.missing ? NO_READING : `${toHexWord(d.raw)} ${d.text}`,
          }),
          row(read, 33146, "Fault 02", {
            text: (d) =>
              d.missing ? NO_READING : `${toHexWord(d.raw)} ${d.text}`,
          }),
          row(read, 33293, "Fault code 1"),
          row(read, 33294, "Fault code 2"),
          row(read, 34348, "Cell V lo"),
          row(read, 34349, "Cell V hi"),
          row(read, 34350, "Cell temp lo"),
          row(read, 34351, "Cell temp hi"),
          row(read, 34352, "Lowest V cell at"),
          row(read, 34354, "Highest V cell at"),
          row(read, 34356, "Coldest cell at"),
          row(read, 34358, "Hottest cell at"),
          row(read, 34360, "Installed capacity"),
          row(read, 34362, "Cycles"),
          row(read, 34363, "Modules in parallel"),
          row(read, 34364, "Cell strings"),
          row(read, 34365, "Modules in series"),
          row(read, 33160, "Battery model"),
          row(read, 33295, "BMS real-time status"),
        ],
      },
      {
        title: "BMS · PACK 2",
        rows: [
          splitWordRow(read, 34275, "BMS voltage"),
          row(read, 34276, "BMS current"),
          row(read, 34281, "Max charge I"),
          row(read, 34282, "Max discharge I"),
          row(read, 34280, "Charge V limit"),
          row(read, 34371, "Discharge V limit"),
          row(read, 34372, "BMS2 status"),
          row(read, 34277, "Temperature"),
          row(read, 34283, "Warning 1", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
          row(read, 34284, "Warning 2", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
          row(read, 34285, "Alarm 1", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
          row(read, 34286, "Alarm 2", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
          row(read, 34287, "Alarm 3", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
          row(read, 34373, "Cell V lo"),
          row(read, 34374, "Cell V hi"),
          row(read, 34375, "Cell temp lo"),
          row(read, 34376, "Cell temp hi"),
          row(read, 34377, "Lowest V cell at"),
          row(read, 34379, "Highest V cell at"),
          row(read, 34381, "Coldest cell at"),
          row(read, 34383, "Hottest cell at"),
          row(read, 34385, "Installed capacity"),
          row(read, 34387, "Cycles"),
          row(read, 34388, "Modules in parallel"),
          row(read, 34389, "Cell strings"),
          row(read, 34390, "Modules in series"),
          // The inverter keeps its own copy of pack 2's SOC/SOH. On a healthy
          // system it agrees with the BMS pair above; a disagreement is the
          // whole reason to show both.
          row(read, 34417, "Inverter SOC"),
          row(read, 34418, "Inverter SOH"),
          row(read, 34578, "BMS real-time status"),
        ],
      },
      {
        title: "ENERGY",
        rows: [
          row(read, 33163, "Charged today"),
          row(read, 33164, "Charged yesterday"),
          row(read, 33161, "Charged total"),
          row(read, 33167, "Discharged today"),
          row(read, 33168, "Discharged yesterday"),
          row(read, 33165, "Discharged total"),
          row(read, 33184, "Grid-charged total"),
        ],
      },
      {
        title: "LIMITS & MODEL",
        rows: [
          row(read, 33041, "Max charge/discharge I"),
          row(read, 33729, "Rated battery power"),
          row(read, 33213, "Over-discharge SOC"),
          row(read, 33214, "Force-charge SOC"),
          row(read, 33297, "Off-grid over-discharge SOC"),
          row(read, 33298, "EPS over-discharge SOC"),
          row(read, 33218, "Rated capacity (parallel)"),
          row(read, 34755, "Local battery total P"),
          row(read, 34797, "Parallel max SOC"),
          row(read, 34798, "Parallel min SOC"),
        ],
      },
    ],
    extra: {
      title: "PACK COMPARISON",
      note: "both packs against their own published ratings",
      // SOC and SOH ARE percentages, so they carry their own scale. Cell
      // voltage is drawn against each pack's own reported highest cell, the
      // current limits against the device's charge/discharge current rating
      // (33041) and the pack powers against its rated battery power (33729).
      // Temperature is deliberately absent: nothing in the map publishes a
      // rated battery temperature, so a temperature bar would need an invented
      // full scale and says nothing true.
      bars: compact([
        bar2("P1 SOC", soc1, `${soc1.text} %`, soc1.value, C.green),
        bar2("P2 SOC", soc2, `${soc2.text} %`, soc2.value, C.green),
        bar2("P1 SOH", soh1, `${soh1.text} %`, soh1.value, C.blue),
        bar2("P2 SOH", soh2, `${soh2.text} %`, soh2.value, C.blue),
        bar("P1 power", p1, powerMax, C.purple, signedPower),
        bar("P2 power", p2, powerMax, C.purple, signedPower),
        bar("P1 cell lo", cellLo1, cellMax1, C.green),
        bar("P1 cell hi", cellHi1, cellMax1, C.green),
        bar("P2 cell lo", cellLo2, cellMax2, C.cyan),
        bar("P2 cell hi", cellHi2, cellMax2, C.cyan),
        bar("P1 chg limit", chgLimit1, currentMax, C.green),
        bar("P1 dchg limit", dchgLimit1, currentMax, C.red),
        bar("P2 chg limit", chgLimit2, currentMax, C.green),
        bar("P2 dchg limit", dchgLimit2, currentMax, C.red),
      ]),
    },
  };
}

export function pvTab(read: RawReader): TabModel {
  const V = [33049, 33051, 33053, 33055] as const;
  const I = [33050, 33052, 33054, 33056] as const;
  const totalDC = decodeAddress(33057, read.at(33057));
  const today = decodeAddress(33035, read.at(33035));
  const total = decodeAddress(33029, read.at(33029));
  const bus = decodeAddress(33071, read.at(33071));
  const modTemp = decodeAddress(33093, read.at(33093));

  const strings = V.map((_, i) => {
    const v = decodeAddress(slot(V, i), read.at(slot(V, i)));
    const c = decodeAddress(slot(I, i), read.at(slot(I, i)));
    const watts =
      v.missing || c.missing ? null : (v.value ?? 0) * (c.value ?? 0);
    return { v, c, watts };
  });

  const activeCount = strings.filter((s) => (s.watts ?? 0) > 0).length;
  const dcTotal =
    totalDC.value ?? strings.reduce((n, s) => n + (s.watts ?? 0), 0);

  return {
    addresses: [],
    regRange: "33029–33071",
    kpis: [
      {
        label: "SOLAR DC",
        value: totalDC.missing ? NO_READING : kw(totalDC),
        unit: "kW",
        sub: `${activeCount} of 4 MPPT active`,
        color: C.warn,
      },
      {
        label: "DC BUS",
        value: bus.text,
        unit: bus.units || "V",
        sub: "reg 33071",
      },
      { label: "YIELD", value: today.text, unit: "kWh", sub: "today" },
      {
        label: "TOTAL",
        value: total.missing ? NO_READING : groupThousands(total.text),
        unit: "kWh",
        sub: "lifetime · reg 33029",
      },
    ],
    matrixTitle: "PV INPUTS · PER MPPT",
    matrixNote: "V/A · W computed",
    matrixCols: [
      { label: "STRING" },
      { label: "V", reg: "33049" },
      { label: "I", reg: "33050" },
      { label: "P" },
      { label: "SHARE" },
      { label: "STATE" },
      { label: "" },
    ],
    matrixRows: strings.map((s, i) => {
      const used = (s.watts ?? 0) > 0;
      return [
        { text: `MPPT ${i + 1}` },
        cell(s.v),
        cell(s.c),
        s.watts === null
          ? gone
          : { text: groupThousands(s.watts.toFixed(0)), strong: true },
        s.watts === null || !dcTotal
          ? gone
          : { text: `${((s.watts / dcTotal) * 100).toFixed(0)} %` },
        used
          ? { text: "OK", color: C.green }
          : { text: s.v.missing ? NO_READING : "UNUSED", color: C.dim },
        gone,
      ];
    }),
    blocks: [
      {
        title: "DC SIDE",
        rows: [
          row(read, 33071, "HVDC bus"),
          row(read, 33072, "Bus half voltage"),
          row(read, 33048, "DC input type"),
          row(read, 33093, "Module temp"),
          row(read, 33107, "Module temp 2"),
        ],
      },
      {
        title: "GENERATION",
        rows: [
          row(read, 33035, "Today"),
          row(read, 33036, "Yesterday"),
          row(read, 33031, "This month"),
          row(read, 33033, "Last month"),
          row(read, 33029, "Total"),
        ],
      },
    ],
    extra: {
      title: "STRING CONTRIBUTION",
      note: "share of total DC",
      // A string's share of total DC is a genuine percentage, so those bars
      // stand. The per-string voltage bars, the DC bus bar and the module
      // temperature bar had invented full scales (500 V, 600 V, 100 C) and no
      // register in the map supplies a rating for any of them, so they are
      // dropped rather than drawn against a guess.
      bars: compact(
        strings.map((s, i): BarItem | null =>
          s.watts === null || !dcTotal
            ? null
            : {
                label: `MPPT ${i + 1}`,
                value: `${groupThousands(s.watts.toFixed(0))} W`,
                pct: (s.watts / dcTotal) * 100,
                color: C.warn,
              },
        ),
      ),
    },
  };
}

/**
 * PV — the whole solar side on one panel: every MPPT channel, the DC bus and
 * AFCI that watch them, AC-coupled PV, and every energy total.
 *
 * Replaces three legacy widgets: `ACCoupledPV` (Meter2.tsx), `PVEnergy`
 * (Energy.tsx) and `SystemEnergy` (SystemEnergy.tsx). Their register lists
 * were the drifted legacy-mapper subset; this is swept fresh from the gospel.
 *
 * WHY THIS ABSORBED THE MPPT PANEL
 * --------------------------------
 * There used to be a separate MPPT panel drawing the same ten-channel table,
 * the same DC-bus block and the same contribution bars. Two copies of one
 * table is bad on its own, but the real hazard was that they could DISAGREE:
 * the channels straddle two distant blocks (33049-33066 and 34498-34501), so
 * with only one fetched, each panel counted only what it happened to have and
 * reported a different live-channel count for the same inverter. MPPT vs PV
 * was never a real distinction either — both are the solar input.
 *
 * The MPPT panel's version of the table is the one that survived, because it
 * is the better one: it separates "not fetched" from "idle" (see the STATE
 * column below) and names the block still to fetch (see `coverage`). Its
 * DC-bus imbalance row and AFCI block came across with it.
 *
 * WHY THE CHANNEL BLOCK STOPS AT TEN
 * ----------------------------------
 * The gospel also carries `pvV1..pvV60` / `pvI1..pvI60` at 33343-33462, which
 * look like a 60-string array. They are not. The source doc (33343-33406, and
 * the 43868 protocol note) shows that block is the IV-curve / AFCI
 * characteristic-data SCRATCH BUFFER: the same words hold 1-64 point voltage,
 * then 65-128 point voltage, then the current halves, depending on which
 * frame was last requested through the 43868 handshake. Rendering them as
 * "string 23 voltage" would be a number with no meaning. The inverter's real
 * MPPT inputs are 33049-33066 (1-8) and 34498-34501 (9-10), and those are
 * what the matrix draws.
 */
export function pvEnergyTab(read: RawReader): TabModel {
  /**
   * The ten channels, as `[voltage, current]` pairs.
   *
   * Listed rather than generated because the run is not uniform: the u32
   * total at 33057-33058 interrupts it after channel 4, and channels 9-10
   * were appended later in an entirely different block at 34498.
   */
  const CHANNELS: Array<[number, number]> = [
    [33049, 33050],
    [33051, 33052],
    [33053, 33054],
    [33055, 33056],
    [33059, 33060],
    [33061, 33062],
    [33063, 33064],
    [33065, 33066],
    [34498, 34499],
    [34500, 34501],
  ];

  /** Which block a channel's registers live in, for the coverage line. */
  const LOW_BLOCK = "33049-33066";
  const HIGH_BLOCK = "34498-34501";

  const totalDC = decodeAddress(33057, read.at(33057));
  const bus = decodeAddress(33071, read.at(33071));
  const busHalf = decodeAddress(33072, read.at(33072));
  const yieldToday = decodeAddress(33035, read.at(33035));
  const yieldTotal = decodeAddress(33029, read.at(33029));

  const channels = CHANNELS.map(([va, ia], i) => {
    const v = decodeAddress(va, read.at(va));
    const c = decodeAddress(ia, read.at(ia));
    // Both halves must be real. Volts alone cannot produce a wattage, and a
    // computed 0 W would look like a channel that is wired and merely idle.
    const watts =
      v.missing || c.missing ? null : (v.value ?? 0) * (c.value ?? 0);
    // A channel counts as unfetched only when NEITHER half arrived. One half
    // present means the block WAS fetched and the other register is genuinely
    // absent — a different fact, which must not be reported as "not fetched".
    const unread = v.missing && c.missing;
    return {
      n: i + 1,
      va,
      ia,
      v,
      c,
      watts,
      unread,
      block: va < 34000 ? LOW_BLOCK : HIGH_BLOCK,
    };
  });

  const measured = channels.filter((s) => !s.unread);
  const live = channels.filter((s) => (s.watts ?? 0) > 0);

  /**
   * The denominator for the share column and the contribution bars.
   *
   * 33057 is preferred because it is the inverter's own MEASURED total rather
   * than a sum of separate measurements. Falling back to the sum of the read
   * channels keeps shares meaningful on a device that has not published
   * 33057. Both are real readings — neither is invented.
   */
  const dcTotal =
    totalDC.value ?? measured.reduce((n, s) => n + (s.watts ?? 0), 0);

  const lowRead = measured.filter((s) => s.block === LOW_BLOCK).length;
  const highRead = measured.filter((s) => s.block === HIGH_BLOCK).length;

  /**
   * The coverage line, and the reason the channel table states its blocks.
   *
   * The ten channels straddle two distant blocks, so "channels 9 and 10 are
   * dashes" has two completely different causes: an eight-input inverter, or
   * a user who fetched one range and not the other. Naming the unfetched
   * block turns that into an instruction instead of a mystery.
   */
  const coverage =
    lowRead === 0 && highRead === 0
      ? "no DC block fetched yet"
      : highRead === 0
        ? `fetch ${HIGH_BLOCK} for MPPT 9-10`
        : lowRead === 0
          ? `fetch ${LOW_BLOCK} for MPPT 1-8`
          : "both DC blocks fetched";

  // AC-coupled PV. Meter 2 is the CT on the grid-tied inverter's own output.
  const m2P = decodeAddress(33314, read.at(33314));
  const acCoupleToday = decodeAddress(34451, read.at(34451));
  const acCoupleTotal = decodeAddress(34445, read.at(34445));
  const rating = ratedVA(read);

  return {
    addresses: [],
    regRange: "33029–34501",
    kpis: [
      {
        label: "SOLAR DC",
        value: kw(totalDC),
        unit: "kW",
        // Stated against what was READ, not against all ten. "3/8" while two
        // channels are unfetched is honest; "3 of 10" would imply the other
        // seven were measured and found at zero.
        sub: measured.length
          ? `${live.length}/${measured.length} MPPT live · reg 33057`
          : "measured · reg 33057",
        color: C.warn,
      },
      {
        label: "AC-COUPLED PV",
        value: kw(m2P, true),
        unit: "kW",
        sub: "meter 2 · reg 33314",
        color: C.cyan,
      },
      {
        label: "YIELD",
        value: yieldToday.text,
        unit: yieldToday.units || "kWh",
        sub: "today · reg 33035",
      },
      {
        label: "LIFETIME",
        value: yieldTotal.missing
          ? NO_READING
          : groupThousands(yieldTotal.text),
        unit: yieldTotal.units || "kWh",
        sub: "total · reg 33029",
      },
    ],
    matrixTitle: "MPPT CHANNELS · ALL TEN",
    matrixNote: coverage,
    matrixCols: [
      { label: "CHANNEL" },
      { label: "V", reg: "33049" },
      { label: "I", reg: "33050" },
      { label: "P" },
      { label: "SHARE" },
      { label: "STATE" },
      { label: "REG" },
    ],
    matrixRows: channels
      .map((s): MatrixCell[] => [
        { text: `MPPT ${s.n}` },
        cell(s.v),
        cell(s.c),
        s.watts === null
          ? gone
          : { text: groupThousands(s.watts.toFixed(0)), strong: true },
        s.watts === null || !dcTotal
          ? gone
          : { text: `${((s.watts / dcTotal) * 100).toFixed(0)} %` },
        // Three distinct states, because collapsing them is exactly the
        // confusion this table exists to remove: a channel that was never
        // fetched is not a channel that is wired and sitting idle.
        s.unread
          ? { text: "NOT FETCHED", color: C.dim }
          : (s.watts ?? 0) > 0
            ? { text: "OK", color: C.green }
            : { text: "IDLE", color: C.muted },
        { text: String(s.va), color: C.dim },
      ])
      .concat([
        [
          { text: "TOTAL", color: C.ink3 },
          gone,
          gone,
          totalDC.missing
            ? gone
            : {
                text: groupThousands(totalDC.text),
                color: C.warn,
                strong: true,
              },
          gone,
          gone,
          { text: "33057", color: C.dim },
        ],
      ]),
    blocks: [
      {
        title: "DC BUS & INPUT",
        rows: [
          row(read, 33071, "HVDC bus"),
          row(read, 33072, "Bus half voltage"),
          // The half rail should sit at half the bus. A split rail is a real
          // fault mode on a commercial unit, so the imbalance is computed
          // rather than left for the reader to subtract by eye. Both halves
          // are readings, so this is arithmetic on real values, not a rating.
          literalRow(
            "Bus imbalance",
            "33071/72",
            bus.missing || busHalf.missing
              ? NO_READING
              : `${
                  (busHalf.value ?? 0) - (bus.value ?? 0) / 2 >= 0 ? "+" : ""
                }${((busHalf.value ?? 0) - (bus.value ?? 0) / 2).toFixed(1)} V`,
            bus.missing || busHalf.missing ? C.dim : undefined,
          ),
          row(read, 33048, "DC input type"),
          row(read, 33044, "Ground voltage"),
          row(read, 33216, "Leakage current"),
          row(read, 33093, "Module temp"),
          row(read, 33107, "Module temp 2"),
          row(read, 34428, "Parallel PV total"),
        ],
      },
      {
        title: "AFCI · ARC DETECTION",
        rows: [
          // Each bit of 34242 covers a PAIR of channels, which the labels say
          // outright so "MPPT 1-2" is not read as channel 12.
          row(read, 34242, "Arc fault channels"),
          row(read, 33215, "AFCI fault string"),
          row(read, 33090, "Arc fault count"),
          row(read, 34241, "CT module faults"),
          row(read, 34240, "AFCI board version", {
            // A packed major/minor byte pair. Hex is how the document quotes
            // it and the only form in which both halves stay readable.
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
          row(read, 34250, "AFCI board rx count"),
        ],
      },
      {
        title: "AC-COUPLED PV · METER 2",
        rows: [
          row(read, 33314, "Total active", {
            color: C.cyan,
            text: (d) => (d.missing ? NO_READING : `${signedPower(d)} W`),
          }),
          row(read, 33322, "Total reactive"),
          row(read, 33330, "Total apparent"),
          row(read, 33332, "Power factor"),
          row(read, 33333, "Frequency"),
          row(read, 33334, "Meter 2 import"),
          row(read, 33336, "Meter 2 export"),
          row(read, 34528, "AC coupling status"),
        ],
      },
      {
        title: "PV GENERATION",
        rows: [
          row(read, 33035, "Today"),
          row(read, 33036, "Yesterday"),
          row(read, 33031, "This month"),
          row(read, 33033, "Last month"),
          row(read, 33037, "This year"),
          row(read, 33039, "Last year"),
          row(read, 33029, "Total"),
          row(read, 34451, "AC-coupled today", { color: C.cyan }),
          row(read, 34445, "AC-coupled total", { color: C.cyan }),
        ],
      },
      {
        title: "GRID & LOAD ENERGY",
        rows: [
          row(read, 33171, "Import today"),
          row(read, 33172, "Import yesterday"),
          row(read, 33169, "Import total"),
          row(read, 33175, "Export today", { color: C.green }),
          row(read, 33176, "Export yesterday", { color: C.green }),
          row(read, 33173, "Export total", { color: C.green }),
          row(read, 33179, "Load today"),
          row(read, 33180, "Load yesterday"),
          row(read, 33177, "Load total"),
        ],
      },
      {
        title: "BATTERY & PORT ENERGY",
        rows: [
          row(read, 33163, "Charge today", { color: C.green }),
          row(read, 33164, "Charge yesterday", { color: C.green }),
          row(read, 33161, "Charge total", { color: C.green }),
          row(read, 33167, "Discharge today", { color: C.red }),
          row(read, 33168, "Discharge yesterday", { color: C.red }),
          row(read, 33165, "Discharge total", { color: C.red }),
          row(read, 33182, "Inverting export total"),
          row(read, 33184, "Grid-charge battery total"),
          row(read, 33186, "AC port export total"),
          row(read, 33188, "AC port import total"),
          row(read, 33577, "AC port export today"),
          row(read, 33578, "AC port import today"),
        ],
      },
      {
        title: "LOAD BREAKDOWN",
        rows: [
          row(read, 33586, "Household today"),
          row(read, 33587, "Household yesterday"),
          row(read, 33584, "Household this month"),
          row(read, 33582, "Household this year"),
          row(read, 33580, "Household total"),
          row(read, 33596, "Backup today"),
          row(read, 33597, "Backup yesterday"),
          row(read, 33594, "Backup this month"),
          row(read, 33592, "Backup this year"),
          row(read, 33590, "Backup total"),
          row(read, 34413, "Smart load today"),
          row(read, 34411, "Smart load total"),
        ],
      },
    ],
    extra: {
      title: "STRING CONTRIBUTION",
      note: "share of measured DC total",
      // A channel's share of the DC total is a genuine percentage against a
      // real denominator, so those bars stand. There is deliberately no
      // per-string VOLTAGE bar: the map publishes no rated PV input voltage
      // anywhere, so such a bar could only be drawn against a guess.
      //
      // The meter-2 bar is the one AC-coupled bar that has a real scale — the
      // device's own rated apparent power at 33067. It is dropped when that
      // rating was never read.
      bars: compact([
        ...channels.map((s): BarItem | null =>
          s.watts === null || !dcTotal
            ? null
            : {
                label: `MPPT ${s.n}`,
                value: `${groupThousands(s.watts.toFixed(0))} W`,
                pct: (s.watts / dcTotal) * 100,
                color: C.warn,
              },
        ),
        bar("AC-coupled", m2P, rating, C.cyan, signedPower),
      ]),
    },
  };
}

export function deviceTab(read: RawReader): TabModel {
  const gridV = decodeAddress(33073, read.at(33073));
  const gridI = decodeAddress(33076, read.at(33076));
  const gridP = decodeAddress(33079, read.at(33079));
  const freq = decodeAddress(33094, read.at(33094));

  const backupV = decodeAddress(33137, read.at(33137));
  const backupI = decodeAddress(33138, read.at(33138));
  const backupP = splitWordAt(read, 33148);

  const houseP = splitWordAt(read, 33147);
  const opStatus = decodeAddress(33287, read.at(33287));
  const workMode = decodeAddress(33091, read.at(33091));
  const modTemp = decodeAddress(33093, read.at(33093));
  const rating = ratedVA(read);
  const ratedV = ratingAt(read, 33718); // acRatedVoltage
  const ratedF = ratingAt(read, 43098); // ovGF01, primary over-frequency trip

  return {
    addresses: [],
    regRange: "33000–33100",
    kpis: [
      {
        label: "OPERATING",
        value: opStatus.missing ? NO_READING : opStatus.text.toUpperCase(),
        unit: "",
        sub: "reg 33287",
        color: C.green,
      },
      {
        label: "WORKING MODE",
        value: workMode.missing ? NO_READING : workMode.text.toUpperCase(),
        unit: "",
        sub: "reg 33091",
      },
      {
        label: "THROUGHPUT",
        value: kw(gridP),
        unit: "kW",
        sub: rating
          ? `of ${groupThousands(String(rating))} VA rated`
          : "reg 33079",
      },
      {
        label: "TEMPERATURE",
        value: modTemp.text,
        unit: modTemp.units || "℃",
        sub: "module · reg 33093",
      },
    ],
    matrixTitle: "AC PORTS",
    matrixNote: "grid · backup · load",
    matrixCols: [
      { label: "PORT" },
      { label: "V" },
      { label: "I" },
      { label: "P" },
      { label: "FREQ" },
      { label: "LOAD" },
      { label: "STATE" },
    ],
    matrixRows: [
      [
        { text: "GRID" },
        cell(gridV),
        cell(gridI),
        gridP.missing ? gone : { text: signedPower(gridP), color: C.purple },
        cell(freq),
        pctCell(gridP, rating),
        opStatus.missing
          ? gone
          : { text: opStatus.text.toUpperCase(), color: C.green, strong: true },
      ],
      [
        { text: "BACKUP" },
        cell(backupV),
        cell(backupI),
        backupP.missing ? gone : { text: signedPower(backupP), color: C.cyan },
        cell(freq),
        pctCell(backupP, rating),
        backupP.missing
          ? gone
          : {
              text: (backupP.value ?? 0) !== 0 ? "LIVE" : "IDLE",
              color: (backupP.value ?? 0) !== 0 ? C.cyan : C.dim,
              strong: true,
            },
      ],
      [
        { text: "HOUSE LOAD" },
        gone,
        gone,
        houseP.missing ? gone : { text: groupThousands(houseP.text) },
        gone,
        pctCell(houseP, rating),
        gone,
      ],
    ],
    blocks: [
      {
        title: "IDENTITY",
        rows: [
          serialRow(read, 33000, "Model"),
          serialRow(read, 33004, "Serial"),
          row(read, 33001, "DSP"),
          row(read, 33002, "HMI"),
          row(read, 33003, "Protocol"),
          row(read, 33068, "Safety"),
          row(read, 33047, "AC output type"),
          row(read, 33067, "Rated apparent"),
        ],
      },
      {
        title: "STORAGE CONTROL",
        rows: [
          row(read, 33132, "Storage control", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
          row(read, 33132, "Flags", { color: C.purple }),
          row(read, 33122, "Operating mode", { color: C.purple }),
          row(read, 33121, "Operating status"),
          row(read, 33123, "Work mode status"),
          row(read, 33092, "Grid standard"),
          row(read, 33111, "Battery BMS status"),
        ],
      },
    ],
    extra: {
      title: "PORT LOADING · OF RATED",
      note: rating
        ? `${groupThousands(String(rating))} VA rated`
        : "rating unread",
      // Power against the device's rated VA, voltage against its own rated AC
      // voltage, frequency against its own over-frequency trip. The three
      // temperature bars and the DC bus bar are gone: the map publishes no
      // rated value for either, and a bar with an invented full scale says
      // nothing true.
      bars: compact([
        bar("Grid port", gridP, rating, C.purple, signedPower),
        bar("Backup port", backupP, rating, C.cyan, signedPower),
        bar("House load", houseP, rating, C.green),
        bar("Grid voltage", gridV, ratedV, C.blue),
        bar("Backup voltage", backupV, ratedV, C.blue),
        bar("Frequency", freq, ratedF, C.green),
      ]),
    },
  };
}

export function faultsTab(read: RawReader): TabModel {
  const active = listFlags(read, FAULT_WORDS);
  const batteryFlags = listFlags(read, BATTERY_FAULT_WORDS);
  const warnings = listFlags(read, WARNING_WORDS);
  const status = decodeAddress(33095, read.at(33095));

  const flagCells = (addresses: readonly number[]): MatrixCell[] =>
    addresses.map((a) => {
      const d = decodeAddress(a, read.at(a));
      if (d.missing) return gone;
      const clear = d.bits.length === 0;
      return {
        text: toHexWord(d.raw),
        color: clear ? C.green : C.red,
        strong: !clear,
      };
    });

  const pad = (cells: MatrixCell[], to: number): MatrixCell[] =>
    cells.concat(
      Array.from({ length: Math.max(0, to - cells.length) }, () => gone),
    );

  return {
    addresses: [],
    regRange: "33116–33146",
    kpis: [
      {
        label: "FAULTS",
        value: String(active.length),
        unit: "",
        sub: "active now",
        color: active.length ? C.red : C.green,
      },
      {
        label: "WARNINGS",
        value: String(warnings.length),
        unit: "",
        sub: "reg 33339",
        color: warnings.length ? C.warn : C.green,
      },
      {
        label: "BATTERY",
        value: String(batteryFlags.length),
        unit: "",
        sub: "reg 33145 / 33146",
        color: batteryFlags.length ? C.warn : C.green,
      },
      {
        label: "STATUS",
        value: status.missing ? NO_READING : status.text,
        unit: "",
        sub: "reg 33095",
      },
    ],
    matrixTitle: "FAULT REGISTERS",
    matrixNote: "raw word per group · green = clear",
    matrixCols: [
      { label: "GROUP" },
      { label: "CODE 01" },
      { label: "CODE 02" },
      { label: "CODE 03" },
      { label: "CODE 04" },
      { label: "CODE 05" },
      { label: "CODE 06" },
    ],
    matrixRows: [
      [
        { text: "INVERTER" },
        ...pad(flagCells([33116, 33117, 33118, 33119, 33120, 33124]), 6),
      ],
      [
        { text: "EXTENDED" },
        ...pad(flagCells([33125, 34394, 34395, 34396, 34397, 34398]), 6),
      ],
      [{ text: "BATTERY" }, ...pad(flagCells(BATTERY_FAULT_WORDS), 6)],
    ],
    blocks: [
      {
        title: "ACTIVE",
        rows: active.length
          ? active.map((f) => ({
              label: f.label,
              reg: String(f.address),
              value: "fault",
              color: C.red,
              note: noteFor(f.address),
            }))
          : [literalRow("No active faults", "—", "clear", C.green)],
      },
      {
        title: "WARNINGS & BATTERY",
        rows: warnings
          .concat(batteryFlags)
          .map((f): DetailRow => ({
            label: f.label,
            reg: String(f.address),
            value: "warning",
            color: C.warn,
            note: noteFor(f.address),
          }))
          .concat(
            warnings.length + batteryFlags.length
              ? []
              : [literalRow("Nothing raised", "—", "clear", C.green)],
          ),
      },
    ],
    extra: {
      title: "FLAG WORDS · RAW",
      note: "bit count per register",
      // Bit count out of 16 is a real scale — a flag word IS sixteen bits, so
      // this needs no rating register. A word that was never read is dropped
      // rather than drawn at 0 %, which would look like "read, and clear".
      bars: compact(
        [...FAULT_WORDS, ...BATTERY_FAULT_WORDS, 33121, 33122, 33339]
          .slice(0, 10)
          .map((a): BarItem | null => {
            const d = decodeAddress(a, read.at(a));
            if (d.missing) return null;
            const reg = byAddress.get(a);
            return {
              label: flagLabel(a),
              value: toHexWord(d.raw),
              pct: (d.bits.length / 16) * 100,
              color: d.bits.length ? C.red : C.green,
            };
          }),
      ),
    },
  };
}

/**
 * DEVICE, the whole of it: identity, AC ports, thermals, modes and the
 * battery FUNCTION settings the old `BatteryFunctions` widget showed.
 *
 * Extends `deviceTab` rather than replacing it: the AC-port matrix and the
 * loading bars are the same shape, because they were already right. What is
 * added is everything the two retired widgets carried that the ported design
 * had no slot for — the sub-versions, the four thermal probes, the DC bus
 * pair, the AFCI/leakage diagnostics, and the 33190..33218 energy-storage
 * control block.
 *
 * The battery-function rows are DATA-space copies (33190+), not the holding
 * registers at 43xxx. The two spaces carry the same names, and only the data
 * copies are in this store — see `hybridAddressTable.ts`.
 */
export function deviceAllTab(read: RawReader): TabModel {
  // Grid-port (33073-33083) and backup-port (33137/33138/33148, 33521-33529)
  // readings now live in GridPortPanel and BackupPortPanel, each with their
  // own full three-phase view. Repeating them here as a stray two-row summary
  // just duplicated a widget that already exists. House load stays: it is
  // its own widget too (LoadPanel) but was never grid/backup port data, and
  // nothing in Task 9's brief asked for it to move.
  const houseP = splitWordAt(read, 33147);
  const opStatus = decodeAddress(33287, read.at(33287));
  const status = decodeAddress(33095, read.at(33095));
  const modTemp = decodeAddress(33093, read.at(33093));
  const esEnable = decodeAddress(33190, read.at(33190));

  const rating = ratedVA(read);

  return {
    addresses: [],
    regRange: "33000–33218",
    kpis: [
      {
        label: "STATUS",
        value: status.missing ? NO_READING : status.text.toUpperCase(),
        unit: "",
        sub: "reg 33095",
        color: status.missing ? undefined : C.green,
      },
      {
        label: "OPERATING",
        value: opStatus.missing ? NO_READING : opStatus.text.toUpperCase(),
        unit: "",
        sub: "reg 33287",
      },
      {
        label: "TEMPERATURE",
        value: modTemp.text,
        unit: modTemp.units || "℃",
        sub: "module · reg 33093",
      },
    ],
    matrixTitle: "HOUSE LOAD",
    matrixNote: "grid · backup port readings moved to their own widgets",
    matrixCols: [
      { label: "PORT" },
      { label: "LOAD" },
    ],
    matrixRows: [
      [
        { text: "HOUSE LOAD" },
        houseP.missing ? gone : { text: groupThousands(houseP.text) },
      ],
    ],
    blocks: [
      {
        title: "IDENTITY",
        rows: [
          serialRow(read, 33000, "Model"),
          serialRow(read, 33004, "Serial"),
          row(read, 33001, "DSP"),
          row(read, 33021, "DSP sub"),
          row(read, 33002, "HMI"),
          row(read, 33069, "HMI sub"),
          row(read, 33003, "Protocol"),
          row(read, 33068, "Safety"),
          row(read, 33047, "AC output type"),
          row(read, 33048, "DC input type"),
          row(read, 33067, "Rated apparent"),
          row(read, 33042, "Rated grid current"),
        ],
      },
      {
        title: "THERMAL & DC BUS",
        rows: [
          row(read, 33093, "Module temp"),
          row(read, 33107, "Module temp 2"),
          row(read, 33099, "Cabinet temp"),
          row(read, 33046, "Battery MOS temp"),
          row(read, 33071, "DC bus"),
          row(read, 33072, "DC bus half"),
          row(read, 33136, "LLC bus"),
          row(read, 33216, "Leakage current"),
          row(read, 33090, "AFCI/ARC faults"),
        ],
      },
      {
        title: "MODES & STANDARD",
        rows: [
          row(read, 33122, "Operating mode", { color: C.purple }),
          row(read, 33121, "Operating status"),
          row(read, 33091, "Standard working mode"),
          row(read, 33123, "Working mode started"),
          row(read, 33092, "Grid standard"),
          row(read, 33097, "Function status"),
          row(read, 33098, "DRM status"),
          row(read, 33132, "Storage control", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
          row(read, 33132, "Storage flags", { color: C.purple }),
        ],
      },
      {
        title: "BATTERY FUNCTION",
        rows: [
          row(read, 33190, "Storage enable", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
          row(read, 33190, "Enable flags", { color: C.purple }),
          row(read, 33203, "Chg/dchg enable"),
          row(read, 33204, "Chg/dchg direction"),
          row(read, 33205, "Chg/dchg current"),
          row(read, 33206, "Max charge I"),
          row(read, 33207, "Max discharge I"),
          row(read, 33111, "BMS status"),
          row(read, 33160, "Battery model"),
        ],
      },
      {
        title: "BATTERY PROTECTION",
        rows: [
          row(read, 33208, "Under-voltage"),
          row(read, 33209, "Float charge V"),
          row(read, 33210, "Equal charge V"),
          row(read, 33211, "Over-voltage"),
          row(read, 33213, "Over-discharge SOC"),
          row(read, 33214, "Force charge SOC"),
          row(read, 33297, "Off-grid ODP SOC"),
          row(read, 33298, "EPS ODP SOC"),
          row(read, 33212, "Voltage droop"),
        ],
      },
      {
        title: "BACKUP CIRCUIT",
        rows: [
          row(read, 33200, "Backup enable"),
          row(read, 33201, "Reference voltage"),
          row(read, 33202, "Reference frequency"),
          row(read, 33299, "EPS switching time"),
          row(read, 33218, "Rated capacity"),
          row(read, 33104, "Power limit"),
          row(read, 33105, "PF adjustment"),
          row(read, 33106, "Reactive limit"),
        ],
      },
    ],
    extra: {
      title: "PORT LOADING · OF RATED",
      note: rating
        ? `${groupThousands(String(rating))} VA rated`
        : "rating unread",
      // Power against the device's rated VA. There is deliberately NO bar for
      // any temperature and none for the DC bus: the map publishes no rated
      // value for either, and a bar with an invented full scale says nothing
      // true. Grid/backup port bars (voltage, current, apparent power) moved
      // out with the rows above -- GridPortPanel and BackupPortPanel carry
      // their own phase-table bars now.
      bars: compact([
        bar("House load", houseP, rating, C.green),
        // The enable word IS sixteen bits, so bit count out of 16 is a real
        // denominator and needs no rating register.
        esEnable.missing
          ? null
          : {
              label: "Storage enable",
              value: toHexWord(esEnable.raw),
              pct: (esEnable.bits.length / 16) * 100,
              color: C.purple,
            },
      ]),
    },
  };
}

/**
 * REMOTE DISPATCH, and the remote-control block it belongs to.
 *
 * SCOPE MATTERS HERE. The gospel documents self-describing modules, and
 * module 7 (25000..25021) is the remote-control block — but 25xxx is outside
 * the 33000..34599 window this DATA store holds, so none of it is readable
 * from here. The readable remote-control surface is the 34502..34505 dispatch
 * header, `remoteControlProtocolVersion` at 34799 and the operating-mode word
 * at 33122, whose bit 7 is "Remote Control". Everything under 43xxx/44xxx is
 * the SETTINGS space and lives in a different store entirely.
 *
 * `remoteDispatchValidMark` at 34502 is the gate: 0xAA55 means the firmware
 * implements 44100..44199 at all. It is shown raw as hex, because a bare
 * 43605 tells the reader nothing.
 */
export function dispatchTab(read: RawReader): TabModel {
  const valid = decodeAddress(34502, read.at(34502));
  const version = decodeAddress(34503, read.at(34503));
  const opStatus = decodeAddress(34504, read.at(34504));
  const relays = decodeAddress(34505, read.at(34505));
  const protocol = decodeAddress(34799, read.at(34799));
  const mode = decodeAddress(33122, read.at(33122));

  // The dispatch setpoints the inverter is ACTUALLY holding, as reported back
  // on the data side. The written setpoints live at 43128..43136 in the
  // settings space and are not in this store.
  const gridPortP = decodeAddress(33151, read.at(33151));
  const batteryP = decodeAddress(33149, read.at(33149));
  const meterP = decodeAddress(33263, read.at(33263));
  const acCoupleP = decodeAddress(34496, read.at(34496));

  const limitP = decodeAddress(33104, read.at(33104));
  const limitQ = decodeAddress(33106, read.at(33106));
  const pf = decodeAddress(33105, read.at(33105));

  const rating = ratedVA(read);

  /** 0xAA55 is the map's "this block is populated" marker. */
  const VALID_MARK = 0xaa55;
  const supported = !valid.missing && valid.raw === VALID_MARK;

  const setpointRow = (
    name: string,
    p: Decoded,
    reg: string,
    color: string,
  ): MatrixCell[] => [
    { text: name },
    { text: reg, color: C.ink3 },
    p.missing ? gone : { text: signedPower(p), color },
    p.missing ? gone : { text: kw(p, true) },
    pctCell(p, rating),
    p.missing
      ? gone
      : {
          text:
            (p.value ?? 0) === 0 ? "IDLE" : (p.value ?? 0) > 0 ? "IN" : "OUT",
          color: signColor(p.value) ?? C.dim,
          strong: true,
        },
    gone,
  ];

  return {
    addresses: [],
    regRange: "34502–34505",
    kpis: [
      {
        label: "DISPATCH",
        value: opStatus.missing ? NO_READING : opStatus.text.toUpperCase(),
        unit: "",
        sub: "reg 34504",
        color: opStatus.missing ? undefined : C.purple,
      },
      {
        label: "SUPPORTED",
        value: valid.missing ? NO_READING : supported ? "YES" : "NO",
        unit: "",
        sub: valid.missing ? "reg 34502" : toHexWord(valid.raw),
        color: valid.missing ? undefined : supported ? C.green : C.red,
      },
      {
        label: "SETPOINT",
        value: kw(gridPortP, true),
        unit: "kW",
        sub: "AC grid port · reg 33151",
        color: signColor(gridPortP.value) ?? C.purple,
      },
      {
        label: "BATTERY",
        value: kw(batteryP, true),
        unit: "kW",
        sub: "+ charge / - discharge",
        color: signColor(batteryP.value) ?? C.green,
      },
    ],
    matrixTitle: "DISPATCHED POWER",
    matrixNote:
      "what the inverter is holding · setpoints are written at 43128+",
    matrixCols: [
      { label: "TARGET" },
      { label: "REG" },
      { label: "W" },
      { label: "kW" },
      { label: "OF RATED" },
      { label: "FLOW" },
      { label: "" },
    ],
    matrixRows: [
      setpointRow("AC grid port", gridPortP, "33151", C.purple),
      setpointRow("Battery", batteryP, "33149", C.green),
      setpointRow("Grid meter", meterP, "33263", C.blue),
      setpointRow("AC couple", acCoupleP, "34496", C.cyan),
    ],
    blocks: [
      {
        title: "REMOTE DISPATCH",
        rows: [
          row(read, 34502, "Valid mark", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
            color: supported ? C.green : C.red,
          }),
          literalRow(
            "Supports 44100+",
            "34502",
            valid.missing ? NO_READING : supported ? "yes" : "no",
            valid.missing ? C.dim : supported ? C.green : C.red,
          ),
          row(read, 34503, "Function version", {
            // The map records this as a plain count, but the doc reads it as
            // a version ordinal: 0x0001 is "V01". Rendered both ways so the
            // raw word stays visible.
            text: (d) =>
              d.missing
                ? NO_READING
                : `V${String(d.raw).padStart(2, "0")} (${toHexWord(d.raw)})`,
          }),
          row(read, 34504, "Dispatch status", { color: C.purple }),
          row(read, 34799, "Control protocol", {
            text: (d) =>
              d.missing
                ? NO_READING
                : `${d.raw >> 8}.${String(d.raw & 0xff).padStart(2, "0")}`,
          }),
        ],
      },
      {
        title: "REMOTE CONTROL",
        rows: [
          row(read, 33122, "Operating mode", { color: C.purple }),
          literalRow(
            "Remote control active",
            "33122",
            mode.missing
              ? NO_READING
              : mode.bits.includes("Remote Control")
                ? "yes"
                : "no",
            mode.missing
              ? C.dim
              : mode.bits.includes("Remote Control")
                ? C.green
                : C.dim,
          ),
          literalRow(
            "Passive mode",
            "33122",
            mode.missing
              ? NO_READING
              : mode.bits.includes("Passive Mode")
                ? "yes"
                : "no",
            mode.missing
              ? C.dim
              : mode.bits.includes("Passive Mode")
                ? C.warn
                : C.dim,
          ),
          row(read, 34505, "Relay command", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
          row(read, 34505, "Relays closed", { color: C.cyan }),
          row(read, 34528, "AC coupling status", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
        ],
      },
      {
        title: "POWER LIMITING",
        rows: [
          row(read, 33104, "Active power limit"),
          row(read, 33106, "Reactive power limit"),
          row(read, 33105, "PF setpoint"),
          row(read, 33091, "Standard working mode"),
          row(read, 33123, "Mode started"),
          row(read, 33067, "Rated apparent"),
        ],
      },
    ],
    extra: {
      title: "DISPATCH LOADING",
      note: rating
        ? `${groupThousands(String(rating))} VA rated`
        : "rating unread",
      // The limit registers ARE percentages already, so they are their own
      // scale. The power bars use the device's rated VA. There is no bar for
      // the dispatch mode word: an enum has no magnitude.
      bars: compact([
        bar("AC grid port", gridPortP, rating, C.purple, signedPower),
        bar("Battery", batteryP, rating, C.green, signedPower),
        bar("Grid meter", meterP, rating, C.blue, signedPower),
        bar2("Power limit", limitP, `${limitP.text} %`, limitP.value, C.warn),
        bar2(
          "Reactive limit",
          limitQ,
          `${limitQ.text} %`,
          limitQ.value === null ? null : Math.abs(limitQ.value),
          C.warn,
        ),
        // PF runs -1..+1, so its magnitude out of 1 is a genuine fraction.
        bar2(
          "Power factor",
          pf,
          pf.text,
          pf.value === null ? null : Math.abs(pf.value) * 100,
          C.cyan,
        ),
        // A relay command word IS sixteen bits; eight of them are defined.
        relays.missing
          ? null
          : {
              label: "Relays closed",
              value: toHexWord(relays.raw),
              pct: (relays.bits.length / 16) * 100,
              color: relays.bits.length ? C.cyan : C.dim,
            },
      ]),
    },
  };
}

/**
 * STATUS — the combined status-and-faults panel.
 *
 * Replaces the two old widgets `HybridStatusWidget` and `HybridFaultWidget`,
 * which between them read six status registers and twenty-five fault words
 * through the legacy mapper. They were separate for no better reason than
 * having been written separately: reading "Fault Off" in 33121 without seeing
 * WHICH fault is set, or seeing a fault word without knowing the inverter is
 * merely standing by, means switching widgets to answer one question.
 *
 * The register set is a fresh sweep of the gospel rather than a port of either
 * old list. That sweep found the two things this panel exists to show:
 *
 *   - the headline code 33095, which carries the single most useful piece of
 *     information on the device ("Leakage Current Protection", not "4148"),
 *     and which had no value_map at all until this task added one upstream;
 *   - the extended fault block 34394-34402 and the SPH pair 34260/34261,
 *     eighteen more decoded fault words the fault count never reached.
 */
export function statusFaultsTab(read: RawReader): TabModel {
  // 33095 is the code the installer actually quotes. 33070 subdivides it and
  // 33292 carries the sub-code, so all three are read together.
  const status = decodeAddress(33095, read.at(33095));
  const statusData = decodeAddress(33070, read.at(33070));
  const opStatus = decodeAddress(33287, read.at(33287));
  const opMode = decodeAddress(33122, read.at(33122));
  const workMode = decodeAddress(33091, read.at(33091));

  const faults = listFlags(read, FAULT_WORDS);
  const extFaults = listFlags(read, EXT_FAULT_WORDS);
  const sphFaults = listFlags(read, SPH_FAULT_WORDS);
  const batteryFlags = listFlags(read, BATTERY_FAULT_WORDS);
  const warnings = listFlags(read, WARNING_WORDS);
  const derates = listFlags(read, [DERATE_WORD]);
  const allFaults = [...faults, ...extFaults, ...sphFaults];

  // 33095 names a fault by code even when no bit word has been fetched, so a
  // panel that only counted bits would call a tripped inverter healthy. Any
  // code outside the running set counts as "something is wrong".
  const RUNNING_CODES: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
  const statusIsFault =
    !status.missing &&
    status.value !== null &&
    !RUNNING_CODES.includes(status.value);

  const faultColor = allFaults.length || statusIsFault ? C.red : C.green;

  /** A raw hex cell per flag word: green when clear, red when anything is set. */
  const flagCells = (addresses: readonly number[]): MatrixCell[] =>
    addresses.map((a) => {
      const d = decodeAddress(a, read.at(a));
      if (d.missing) return gone;
      // A word with no bit_flags in the map still reports whether it is zero,
      // which is the useful half. `bits` stays empty, so it never inflates a
      // count with bits it cannot name.
      const clear = d.raw === 0;
      return {
        text: toHexWord(d.raw),
        color: clear ? C.green : C.red,
        strong: !clear,
      };
    });

  const pad = (cells: MatrixCell[], to: number): MatrixCell[] =>
    cells.concat(
      Array.from({ length: Math.max(0, to - cells.length) }, () => gone),
    );

  /** Flags as detail rows, tagged with the severity word the block means. */
  const flagRows = (
    flags: Array<{ address: number; label: string }>,
    value: string,
    color: string,
  ): DetailRow[] =>
    flags.map((f): DetailRow => ({
      label: f.label,
      reg: String(f.address),
      value,
      color,
      note: noteFor(f.address),
    }));

  return {
    addresses: [],
    regRange: "33070–34406",
    kpis: [
      {
        label: "STATUS",
        // The enum label, not the code. 33095 renders "Generating" or
        // "Leakage Current Protection" now that the map carries Appendix 3.
        value: status.missing ? NO_READING : status.text.toUpperCase(),
        unit: "",
        sub: "reg 33095",
        color: status.missing ? C.dim : statusIsFault ? C.red : C.green,
      },
      {
        label: "OPERATING",
        value: opStatus.missing ? NO_READING : opStatus.text.toUpperCase(),
        unit: "",
        sub: "reg 33287",
        color: opStatus.missing ? C.dim : C.blue,
      },
      {
        label: "FAULTS",
        value: String(allFaults.length),
        unit: "",
        sub: "inverter · ext · SPH",
        color: faultColor,
      },
      {
        label: "WARNINGS",
        value: String(warnings.length + batteryFlags.length + derates.length),
        unit: "",
        sub: "warn · battery · derate",
        color:
          warnings.length + batteryFlags.length + derates.length
            ? C.warn
            : C.green,
      },
    ],
    matrixTitle: "FLAG WORDS · RAW",
    matrixNote: "one word per cell · green = clear",
    matrixCols: [
      { label: "GROUP" },
      { label: "01" },
      { label: "02" },
      { label: "03" },
      { label: "04" },
      { label: "05" },
      { label: "06" },
    ],
    matrixRows: [
      // The original seven inverter fault words, in address order.
      [
        { text: "FAULT" },
        ...pad(flagCells([33116, 33117, 33118, 33119, 33120, 33124]), 6),
      ],
      // 33125 closes that block; the extended block opens 34394+.
      [
        { text: "EXT A" },
        ...pad(flagCells([33125, 34394, 34395, 34396, 34397, 34398]), 6),
      ],
      [
        { text: "EXT B" },
        ...pad(flagCells([34399, 34400, 34401, 34402, 34403, 34404]), 6),
      ],
      // 34405/34406 have no bit_flags, so they show as raw words only.
      [
        { text: "BATT/SPH" },
        ...pad(flagCells([33145, 33146, 34260, 34261, 34405, 34406]), 6),
      ],
      [
        { text: "STATE" },
        ...pad(flagCells([33121, 33122, 33132, 33097, 33190, 33339]), 6),
      ],
    ],
    blocks: [
      {
        title: "ACTIVE FAULTS",
        rows: (() => {
          const rows: DetailRow[] = [];
          // The headline code leads, because it names the trip even when the
          // bit words behind it have not been fetched.
          if (statusIsFault) {
            rows.push({
              label: status.text,
              reg: "33095",
              value: "fault",
              color: C.red,
              note: noteFor(33095),
            });
          }
          rows.push(...flagRows(faults, "fault", C.red));
          rows.push(...flagRows(extFaults, "ext fault", C.red));
          rows.push(...flagRows(sphFaults, "SPH fault", C.red));
          return rows.length
            ? rows
            : [
                literalRow(
                  status.missing ? "Nothing read yet" : "No active faults",
                  "—",
                  status.missing ? NO_READING : "clear",
                  status.missing ? C.dim : C.green,
                ),
              ];
        })(),
      },
      {
        title: "WARNINGS · DERATE · BATTERY",
        rows: (() => {
          const rows = [
            ...flagRows(warnings, "warning", C.warn),
            ...flagRows(derates, "derate", C.warn),
            ...flagRows(batteryFlags, "battery", C.warn),
          ];
          return rows.length
            ? rows
            : [
                literalRow(
                  status.missing ? "Nothing read yet" : "Nothing raised",
                  "—",
                  status.missing ? NO_READING : "clear",
                  status.missing ? C.dim : C.green,
                ),
              ];
        })(),
      },
      {
        title: "MODE & STATE",
        rows: [
          row(read, 33095, "Status code"),
          row(read, 33070, "Status detail"),
          row(read, 33292, "Equipment sub-code"),
          row(read, 33287, "Operating status"),
          row(read, 33122, "Operating mode", { color: C.purple }),
          row(read, 33091, "Working mode"),
          row(read, 33123, "Mode startup"),
          row(read, 33121, "Working status"),
          row(read, 33132, "Storage control", { color: C.purple }),
          row(read, 33190, "Storage enable"),
          row(read, 33097, "Function status"),
          row(read, 33463, "Derate/restrict", { color: C.warn }),
        ],
      },
      {
        title: "SUBSYSTEMS",
        rows: [
          row(read, 33111, "Battery BMS"),
          row(read, 33295, "BMS 1 real-time"),
          row(read, 34578, "BMS 2 real-time"),
          row(read, 33296, "Master/slave"),
          row(read, 33468, "G100 V2"),
          row(read, 33248, "EPM/FailSafe"),
          row(read, 33290, "CT self-test"),
          row(read, 33090, "AFCI fault count"),
          row(read, 33098, "DRM code"),
          row(read, 34245, "SPH running"),
          row(read, 34252, "SPH mode"),
          row(read, 34271, "SPH switches"),
        ],
      },
    ],
    extra: {
      title: "FLAG WORDS · BITS SET",
      note: "of 16 bits",
      // Bit count out of 16 is a real denominator — a flag word IS sixteen
      // bits — so these bars need no rating register. A word that was never
      // read is dropped rather than drawn at 0 %, which would misread as
      // "fetched, and clear".
      bars: compact(
        [
          ...FAULT_WORDS,
          ...EXT_FAULT_WORDS,
          ...SPH_FAULT_WORDS,
          ...BATTERY_FAULT_WORDS,
          ...WARNING_WORDS,
          ...STATE_WORDS,
        ].map((a): BarItem | null => {
          const d = decodeAddress(a, read.at(a));
          if (d.missing) return null;
          // The gospel already named these bits; show the names, not the hex.
          // A word with no bit_flags in the map, or one whose set bits are all
          // "Reserve", has nothing to name and falls back to the raw word so
          // the reading is never hidden.
          return {
            label: flagLabel(a),
            value: d.bits.length ? d.bits.join(", ") : toHexWord(d.raw),
            pct: (d.bits.length / 16) * 100,
            color: d.bits.length ? C.red : C.green,
          };
        }),
      ),
    },
  };
}

/**
 * PUBLIC GRID — the measurement taken AT the grid connection point.
 *
 * This is NOT the same measurement point as `gridTab`, and the distinction is
 * the whole reason this panel exists.
 *
 * 33251-33286 (which `gridTab` draws) is the external meter/CT reporting
 * ITSELF, wherever it is physically clamped. The gospel note on 33251 spells
 * out the two cases: clamp the meter on the public grid side and those
 * registers already ARE the grid-side reading; clamp it on the LOAD side and
 * they are the load's consumption instead, and the grid-side figure has to be
 * derived. 33540-33575 is that derived block — the note on 33540 says so, and
 * the description on 33546 gives the arithmetic outright:
 *
 *   Pa = inverter AC side phase A active power - load side meter phase A
 *
 * So on a load-side install the two blocks legitimately differ by whatever the
 * house is consuming, and neither is wrong. A user reading 33552 against
 * 33263 without knowing which side the CT sits on will think the inverter is
 * lying to them; the matrix note and the METER POSITION block below exist to
 * answer that before it is asked.
 *
 * This is also where 33572/33574 belong. They are the public-grid-side energy
 * counters at 0.01 kWh, the counterparts of the 1 kWh 33169/33173 that the PV
 * panel shows. The PV panel deliberately leaves this pair out so the two
 * scales are never set side by side and read as a contradiction.
 */
export function publicGridTab(read: RawReader): TabModel {
  const V = [33540, 33542, 33544] as const;
  const I = [33541, 33543, 33545] as const;
  const P = [33546, 33548, 33550] as const;
  const Q = [33554, 33556, 33558] as const;
  const S = [33562, 33564, 33566] as const;

  const totalP = decodeAddress(33552, read.at(33552));
  const totalQ = decodeAddress(33560, read.at(33560));
  const totalS = decodeAddress(33568, read.at(33568));
  const pf = decodeAddress(33570, read.at(33570));
  const freq = decodeAddress(33571, read.at(33571));
  const taken = decodeAddress(33572, read.at(33572));
  const sent = decodeAddress(33574, read.at(33574));

  const rating = ratedVA(read);
  const ratedV = ratingAt(read, 33718); // acRatedVoltage
  const ratedF = ratingAt(read, 43098); // ovGF01, primary over-frequency trip

  const phaseRow = (i: number, name: string): MatrixCell[] => {
    const v = decodeAddress(slot(V, i), read.at(slot(V, i)));
    const c = decodeAddress(slot(I, i), read.at(slot(I, i)));
    const p = decodeAddress(slot(P, i), read.at(slot(P, i)));
    const q = decodeAddress(slot(Q, i), read.at(slot(Q, i)));
    const s = decodeAddress(slot(S, i), read.at(slot(S, i)));
    return [
      { text: name, color: undefined },
      cell(v),
      cell(c),
      p.missing ? gone : { text: signedPower(p), color: C.purple },
      q.missing ? gone : { text: groupThousands(q.text) },
      s.missing ? gone : { text: groupThousands(s.text) },
      i === 0 ? cell(pf) : gone,
    ];
  };

  return {
    addresses: [],
    regRange: "33540–33575",
    kpis: [
      {
        label: "GRID POWER",
        value: kw(totalP, true),
        unit: "kW",
        sub: "reg 33552 · + export",
        color: C.purple,
      },
      {
        label: "FREQUENCY",
        value: freq.text,
        unit: freq.units || "Hz",
        sub: "reg 33571",
      },
      {
        label: "POWER FACTOR",
        value: pf.text,
        unit: "",
        sub: "reg 33570",
      },
      {
        label: "TAKEN / SENT",
        value: `${taken.text}/${sent.text}`,
        unit: "kWh",
        sub: "reg 33572 · 33574",
      },
    ],
    matrixTitle: "PUBLIC GRID SIDE · PER PHASE",
    matrixNote: "grid connection point, not the meter",
    matrixCols: [
      { label: "PHASE" },
      { label: "V", reg: "33540" },
      { label: "I", reg: "33541" },
      { label: "P", reg: "33546" },
      { label: "Q", reg: "33554" },
      { label: "S", reg: "33562" },
      { label: "PF" },
    ],
    matrixRows: [
      phaseRow(0, "A"),
      phaseRow(1, "B"),
      phaseRow(2, "C"),
      [
        { text: "TOTAL", color: C.ink3 },
        gone,
        gone,
        totalP.missing
          ? gone
          : { text: signedPower(totalP), color: C.purple, strong: true },
        totalQ.missing ? gone : { text: groupThousands(totalQ.text) },
        totalS.missing ? gone : { text: groupThousands(totalS.text) },
        cell(pf),
      ],
    ],
    blocks: [
      {
        title: "METER POSITION",
        rows: [
          // Which side the CT is clamped is what decides whether 33251+ and
          // 33540+ agree, so it is the first thing this panel states.
          row(read, 33250, "CT position"),
          row(read, 33246, "Parallel CT detect"),
          row(read, 33283, "Meter total from grid"),
          row(read, 33285, "Meter total to grid"),
        ],
      },
      {
        title: "PUBLIC GRID ENERGY",
        rows: [
          row(read, 33572, "Taken from grid"),
          row(read, 33574, "Sent to grid"),
          // The whole-system and parallel views of the same quantity. Each is
          // sentinel-guarded in the map (0x80000000 = invalid), and `decode`
          // already turns that into "--", so a single unit shows these blank
          // rather than as a fabricated -2.1 GW.
          row(read, 34625, "Public grid total P"),
          row(read, 34921, "System public grid P"),
          row(read, 34795, "Parallel PCC power"),
        ],
      },
      {
        title: "PARALLEL SYSTEM",
        rows: [
          // 34490/34491 are only meaningful when 34427 reads 0xAA55; the doc
          // is explicit that any other value makes the pair invalid, so the
          // gate is shown next to them rather than left for the user to know.
          row(read, 34427, "Parallel info valid"),
          row(read, 34491, "Parallel public grid P"),
          row(read, 34490, "Parallel grid load P"),
          row(read, 34623, "Grid-side load total P"),
        ],
      },
    ],
    extra: {
      title: "PUBLIC GRID BALANCE",
      note: `% of ${rating ? groupThousands(String(rating)) : "—"} VA rating`,
      // Same rule as GRID METER: voltage scales against the device's own rated
      // AC voltage (33718), frequency against its own over-frequency trip
      // (43098), power against rated VA (33067). Where the device has not
      // published the rating `bar` drops the bar rather than invent a scale.
      bars: compact([
        bar(
          "A active",
          decodeAddress(P[0], read.at(P[0])),
          rating,
          C.purple,
          signedPower,
        ),
        bar("A voltage", decodeAddress(V[0], read.at(V[0])), ratedV, C.blue),
        bar(
          "B active",
          decodeAddress(P[1], read.at(P[1])),
          rating,
          C.purple,
          signedPower,
        ),
        bar("B voltage", decodeAddress(V[1], read.at(V[1])), ratedV, C.blue),
        bar(
          "C active",
          decodeAddress(P[2], read.at(P[2])),
          rating,
          C.purple,
          signedPower,
        ),
        bar("C voltage", decodeAddress(V[2], read.at(V[2])), ratedV, C.blue),
        bar("Total active", totalP, rating, C.purple, signedPower),
        bar("Frequency", freq, ratedF, C.green),
      ]),
    },
  };
}

/**
 * BUILT-IN METER + LOAD BREAKDOWN.
 *
 * THE MEASUREMENT POINT IS THE WHOLE POINT OF THIS PANEL.
 *
 * `gridTab` reads the EXTERNAL meter / CT at 33250-33290 — a separate device
 * wired at the grid connection point, whose readings depend on where the
 * installer clamped it (33250 `meterCTPosition`).
 *
 * This panel reads the inverter's OWN INTERNAL meter at 34292-34326. It is
 * built into the unit, so it always measures at the inverter's AC port and
 * needs no CT and no installer choice. The two blocks disagree by design
 * whenever anything sits between the inverter and the external CT, so every
 * heading here says INTERNAL and the matrix note names the other block. A
 * user must never have to guess which measurement point a number came from.
 *
 * The load blocks live here rather than with the grid meter for the same
 * reason: grid-side load, smart port and SPH load are all measured by the
 * inverter itself, not by the external meter.
 *
 * NOTE ON THE INTERLEAVED V/I ORDERING at 34292-34297: the block runs
 * V-A, I-A, V-B, I-B, V-C, I-C — NOT all three voltages then all three
 * currents. `decode.test.ts` pins 34292 as a voltage and 34293 as a current
 * so a future "tidy-up" cannot quietly re-order them.
 */
export function builtInMeterTab(read: RawReader): TabModel {
  // Interleaved: voltage then current, per phase. See the header note.
  const V = [34292, 34294, 34296] as const;
  const I = [34293, 34295, 34297] as const;
  const P = [34298, 34300, 34302] as const;
  const Q = [34306, 34308, 34310] as const;
  const S = [34314, 34316, 34318] as const;

  const totalP = decodeAddress(34304, read.at(34304));
  const totalQ = decodeAddress(34312, read.at(34312));
  const totalS = decodeAddress(34320, read.at(34320));
  const pf = decodeAddress(34322, read.at(34322));
  const freq = decodeAddress(34323, read.at(34323));
  const drawn = decodeAddress(34324, read.at(34324));
  const delivered = decodeAddress(34326, read.at(34326));
  const gridSideLoad = decodeAddress(34623, read.at(34623));
  const smartLoad = decodeAddress(34494, read.at(34494));

  const rating = ratedVA(read);
  const ratedV = ratingAt(read, 33718); // acRatedVoltage
  const ratedF = ratingAt(read, 43098); // ovGF01, primary over-frequency trip

  const phaseRow = (i: number, name: string): MatrixCell[] => {
    const v = decodeAddress(slot(V, i), read.at(slot(V, i)));
    const c = decodeAddress(slot(I, i), read.at(slot(I, i)));
    const p = decodeAddress(slot(P, i), read.at(slot(P, i)));
    const q = decodeAddress(slot(Q, i), read.at(slot(Q, i)));
    const s = decodeAddress(slot(S, i), read.at(slot(S, i)));
    return [
      { text: name, color: undefined },
      cell(v),
      cell(c),
      p.missing ? gone : { text: signedPower(p), color: C.purple },
      q.missing ? gone : { text: groupThousands(q.text) },
      s.missing ? gone : { text: groupThousands(s.text) },
      // One power-factor word covers the whole meter, so it sits against
      // phase A rather than being repeated down the column.
      i === 0 ? cell(pf) : gone,
    ];
  };

  return {
    addresses: [],
    regRange: "34292–34326",
    kpis: [
      {
        label: "INTERNAL ACTIVE",
        value: kw(totalP, true),
        unit: "kW",
        sub: "reg 34304",
        color: C.purple,
      },
      {
        label: "INTERNAL FREQ",
        value: freq.text,
        unit: freq.units || "Hz",
        sub: "reg 34323",
      },
      {
        label: "DRAWN / DELIVERED",
        value: `${drawn.text}/${delivered.text}`,
        unit: "kWh",
        sub: "reg 34324/34326",
      },
      {
        label: "GRID-SIDE LOAD",
        value: kw(gridSideLoad),
        unit: "kW",
        sub: "reg 34623",
        color: C.cyan,
      },
    ],
    matrixTitle: "BUILT-IN (INTERNAL) METER · PER PHASE",
    matrixNote: "inverter's own meter — not the external CT at 33250",
    matrixCols: [
      { label: "PHASE" },
      { label: "V", reg: "34292" },
      { label: "I", reg: "34293" },
      { label: "P", reg: "34298" },
      { label: "Q", reg: "34306" },
      { label: "S", reg: "34314" },
      { label: "PF", reg: "34322" },
    ],
    matrixRows: [
      phaseRow(0, "A"),
      phaseRow(1, "B"),
      phaseRow(2, "C"),
      [
        { text: "TOTAL", color: C.ink3 },
        gone,
        gone,
        totalP.missing
          ? gone
          : { text: signedPower(totalP), color: C.purple, strong: true },
        totalQ.missing ? gone : { text: groupThousands(totalQ.text) },
        totalS.missing ? gone : { text: groupThousands(totalS.text) },
        cell(pf),
      ],
    ],
    blocks: [
      {
        title: "GRID-SIDE LOAD",
        rows: [
          /* LABELLED BY GOSPEL MEANING, NOT BY LEGACY NAME.
             `hybridAddressTable` aliases 34424 to the legacy store key
             `gridSideLoadPowerPhaseC` and 34426 to `gridSideLoadTotalPower`,
             because those are the names the legacy mapper filed the words
             under. The alias only says WHERE a word is stored; the word
             itself is the gospel register at that address. Reading by address
             and decoding by address means the phase letters below are the
             gospel's, which are the correct ones. */
          row(read, 34424, "Phase A", { text: autoPowerText }),
          row(read, 34425, "Phase B", { text: autoPowerText }),
          row(read, 34426, "Phase C", { text: autoPowerText }),
          row(read, 34623, "Total active", { text: autoPowerText }),
          /* One 32-bit grid load power split across NON-ADJACENT registers:
             33147 low, 34343 high. Joining them is not arithmetic invented
             here — 34343's own description defines the pairing and gives a
             worked example. Reading 33147 alone WRAPS at 65 535 W, which on a
             commercial unit is a plausible-looking wrong number. */
          splitWordRow(read, 33147, "Grid load power", {
            text: autoPowerText,
          }),
          row(read, 34490, "Parallel-system total", { text: autoPowerText }),
        ],
      },
      {
        title: "SMART PORT / SMART LOAD",
        rows: [
          row(read, 34328, "Port A voltage"),
          row(read, 34331, "Port A current"),
          row(read, 34329, "Port B voltage"),
          row(read, 34332, "Port B current"),
          row(read, 34330, "Port C voltage"),
          row(read, 34333, "Port C current"),
          /* 34494, not 34619. Both records carry the key
             `smartLoadTotalActivePower`, and the address table keeps the
             FIRST data-space record per key, so 34619 resolves to no legacy
             store key at all and would render "--" forever. */
          row(read, 34494, "Smart load total"),
          row(read, 34433, "Parallel smart load"),
          row(read, 34413, "Smart load today"),
          row(read, 34411, "Smart load total energy"),
        ],
      },
      {
        title: "SMART PORT PHASE POWER",
        rows: [
          /* The gospel keys these `secondBackupLoad*`, but each register's
             own NAME reads "Smart Port Phase X Active Power", so they are the
             per-phase detail behind the smart-port block above. Labelled by
             the name, keyed by the address. */
          row(read, 34391, "Phase A active"),
          row(read, 34392, "Phase B active"),
          row(read, 34393, "Phase C active"),
          row(read, 34496, "AC couple total"),
        ],
      },
      {
        title: "SPH LOAD CABINET",
        rows: [
          row(read, 34252, "SPH mode"),
          row(read, 34246, "SPH load power"),
          row(read, 34247, "SPH load energy"),
          row(read, 34253, "Generator voltage"),
          row(read, 34255, "Load voltage 1"),
          row(read, 34256, "Load voltage 2"),
          row(read, 34257, "Load voltage 3"),
          row(read, 34258, "Load voltage 4"),
        ],
      },
    ],
    extra: {
      title: "INTERNAL METER LOADING",
      note: `% of ${rating ? groupThousands(String(rating)) : "—"} VA rating`,
      /* Same rule as GRID METER: voltage scales against the device's own
         rated AC voltage (33718) and frequency against its own over-frequency
         trip (43098). 43098 lives in the SETTINGS space, which this data
         store does not hold, so the frequency bar is always dropped here.
         That is the correct outcome — a bar drawn against a guessed scale is
         worse than no bar at all. */
      bars: compact([
        bar(
          "A active",
          decodeAddress(P[0], read.at(P[0])),
          rating,
          C.purple,
          signedPower,
        ),
        bar("A voltage", decodeAddress(V[0], read.at(V[0])), ratedV, C.blue),
        bar(
          "B active",
          decodeAddress(P[1], read.at(P[1])),
          rating,
          C.purple,
          signedPower,
        ),
        bar("B voltage", decodeAddress(V[1], read.at(V[1])), ratedV, C.blue),
        bar(
          "C active",
          decodeAddress(P[2], read.at(P[2])),
          rating,
          C.purple,
          signedPower,
        ),
        bar("C voltage", decodeAddress(V[2], read.at(V[2])), ratedV, C.blue),
        bar("Total active", totalP, rating, C.purple, signedPower),
        bar("Total apparent", totalS, rating, C.cyan),
        bar("Frequency", freq, ratedF, C.green),
        bar("Grid-side load", gridSideLoad, rating, C.cyan, signedPower),
        bar("Smart load", smartLoad, rating, C.warn, signedPower),
      ]),
    },
  };
}

/**
 * SYSTEM POWER — the whole installation, not this one unit.
 *
 * A parallel install has one master and up to fifteen slaves; every other DATA
 * panel shows only the box the extension is talking to. This one shows what
 * the INSTALLATION is doing, by reading the aggregate blocks the master
 * publishes.
 *
 * The device reports the same aggregate at three different resolutions, and
 * the panel shows all three side by side rather than picking one, because they
 * are not interchangeable:
 *
 *   - the PARALLEL block (34427-34434, 34490-34491, 34537) is s16 at 100 W per
 *     count, so it saturates at +-3.2 MW and quantises to 100 W;
 *   - the parallel 32-bit values (34779+) are s32 at 1 W, the same quantities
 *     without either limit;
 *   - MODULE 6 (34900-34923) is the PV+hybrid system scope: it adds the
 *     grid-tied (PV-only) inverters, which the parallel block does not cover.
 *
 * Each block carries its own 0xAA55 validity marker, and a block whose marker
 * is absent or wrong is showing stale words rather than readings — so the
 * markers are surfaced instead of being silently trusted.
 *
 * SCOPE HAZARD: `generatorTotalActivePower` and `smartLoadTotalActivePower`
 * each exist at several scopes, and `hybridAddressTable` keeps only the FIRST
 * data-space record per key. So the module-6 generator total at 34913 and the
 * module-1 copies at 34617/34619 are UNREACHABLE — 34492 and 34494 hold those
 * keys. This panel therefore reads the parallel-scope generator (34429) and
 * smart-load (34433) totals, which have their own distinct `parallelSystem`
 * keys and are reachable. See the header of `src/mapper/gospel.ts`.
 */
export function systemPowerTab(read: RawReader): TabModel {
  /** The map's "this block is populated" marker, shared by both blocks. */
  const VALID_MARK = 0xaa55;

  const parValid = decodeAddress(34427, read.at(34427));
  const mod6Valid = decodeAddress(34902, read.at(34902));
  const parOk = !parValid.missing && parValid.raw === VALID_MARK;
  const mod6Ok = !mod6Valid.missing && mod6Valid.raw === VALID_MARK;

  // Parallel block, s16 at 100 W per count.
  const parPv = decodeAddress(34428, read.at(34428));
  const parGen = decodeAddress(34429, read.at(34429));
  const parBat = decodeAddress(34430, read.at(34430));
  const parBackup = decodeAddress(34431, read.at(34431));
  const parInv = decodeAddress(34432, read.at(34432));
  const parSmart = decodeAddress(34433, read.at(34433));
  const parAcCouple = decodeAddress(34434, read.at(34434));
  const parGridLoad = decodeAddress(34490, read.at(34490));
  const parPublicGrid = decodeAddress(34491, read.at(34491));
  const parAcPort = decodeAddress(34537, read.at(34537));

  // The same parallel quantities as s32 at 1 W — no 3.2 MW ceiling, no 100 W
  // quantisation. Where both are present the fine value is the one to trust.
  const finePv = decodeAddress(34779, read.at(34779));
  const fineBat = decodeAddress(34781, read.at(34781));
  const fineAcPort = decodeAddress(34785, read.at(34785));
  const finePcc = decodeAddress(34795, read.at(34795));

  // Module 6: the PV + hybrid system, which includes the grid-tied inverters.
  const m6Pv = decodeAddress(34903, read.at(34903));
  const m6Bat = decodeAddress(34905, read.at(34905));
  const m6Inv = decodeAddress(34907, read.at(34907));
  const m6Backup = decodeAddress(34909, read.at(34909));
  const m6AcPort = decodeAddress(34911, read.at(34911));
  const m6Smart = decodeAddress(34915, read.at(34915));
  const m6GridTied = decodeAddress(34917, read.at(34917));
  const m6GridLoad = decodeAddress(34919, read.at(34919));
  const m6PublicGrid = decodeAddress(34921, read.at(34921));

  const socMax = decodeAddress(34797, read.at(34797));
  const socMin = decodeAddress(34798, read.at(34798));

  const rating = ratedVA(read);

  /**
   * How many inverters the master says are online.
   *
   * 33338 and 33388 are the same bitmap at two addresses: BIT00 is unused and
   * BIT01..15 are inverter IDs 1..15. Both are refused in `ENUM_CANDIDATES.md`
   * as bitfields the harvester could not resolve, so the map publishes no
   * `bit_flags` and `decodeAddress` returns a bare number. Counting the set
   * bits is arithmetic on the documented layout, not an invented label, so it
   * is safe to do here; the raw word is still shown beside it.
   */
  const onlineCount = (d: Decoded): number | null => {
    if (d.missing) return null;
    let n = 0;
    for (let bit = 1; bit <= 15; bit += 1) {
      if ((d.raw >> bit) & 1) n += 1;
    }
    return n;
  };

  /** The bitmap as an ID list, e.g. "1, 2, 5". */
  const onlineIds = (d: Decoded): string => {
    if (d.missing) return NO_READING;
    const ids: number[] = [];
    for (let bit = 1; bit <= 15; bit += 1) {
      if ((d.raw >> bit) & 1) ids.push(bit);
    }
    return ids.length ? ids.join(", ") : "none";
  };

  const onlineA = decodeAddress(33338, read.at(33338));
  const onlineB = decodeAddress(33388, read.at(33388));
  // Either address can be the populated one depending on firmware, so take
  // whichever actually read rather than assuming one of them.
  const online = onlineA.missing ? onlineB : onlineA;
  const onlineN = onlineCount(online);

  /** A validity marker row: the hex word plus whether it is the 0xAA55 mark. */
  const markRow = (address: number, label: string, ok: boolean): DetailRow =>
    row(read, address, label, {
      text: (d) =>
        d.missing ? NO_READING : `${toHexWord(d.raw)} ${ok ? "valid" : "stale"}`,
      color: ok ? C.green : C.red,
    });

  /**
   * One row of the three-scope comparison matrix.
   *
   * Columns are PARALLEL (s16/100 W), FINE (s32/1 W) and MODULE 6 (s32/1 W).
   * A quantity that only one scope reports leaves the other cells dimmed —
   * that absence is itself the answer to "which blocks does this install
   * publish", so it is shown rather than hidden.
   */
  const scopeRow = (
    name: string,
    coarse: Decoded | null,
    coarseReg: string,
    fine: Decoded | null,
    fineReg: string,
    mod6: Decoded | null,
    mod6Reg: string,
    color: string,
  ): MatrixCell[] => {
    const power = (d: Decoded | null): MatrixCell =>
      d === null || d.missing ? gone : { text: signedPower(d), color };
    // The best available reading drives the "of rated" column: the fine s32
    // where the device publishes it, else the coarse parallel word.
    const best = fine && !fine.missing ? fine : coarse;
    return [
      { text: name },
      { text: coarseReg, color: C.ink3 },
      power(coarse),
      { text: fineReg, color: C.ink3 },
      power(fine),
      power(mod6),
      best === null ? gone : pctCell(best, rating),
    ];
  };

  /** Prefer the 1 W s32 reading, fall back to the 100 W parallel word. */
  const finest = (fine: Decoded, coarse: Decoded): Decoded =>
    fine.missing ? coarse : fine;

  return {
    addresses: [],
    regRange: "34427–34923",
    kpis: [
      {
        label: "SYSTEM PV",
        value: kw(finest(finePv, parPv)),
        unit: "kW",
        sub: finePv.missing ? "reg 34428" : "reg 34779",
        color: C.warn,
      },
      {
        label: "SYSTEM BATTERY",
        value: kw(finest(fineBat, parBat), true),
        unit: "kW",
        sub: "+ charge / - discharge",
        color: signColor(finest(fineBat, parBat).value) ?? C.green,
      },
      {
        label: "PCC",
        value: kw(finest(finePcc, parPublicGrid), true),
        unit: "kW",
        sub: finePcc.missing ? "reg 34491" : "reg 34795",
        color: signColor(finest(finePcc, parPublicGrid).value) ?? C.purple,
      },
      {
        label: "INVERTERS ONLINE",
        value: onlineN === null ? NO_READING : String(onlineN),
        unit: "",
        sub: online.missing ? "reg 33338" : `IDs ${onlineIds(online)}`,
        color: onlineN === null ? undefined : C.blue,
      },
    ],
    matrixTitle: "SYSTEM TOTALS · BY SCOPE",
    matrixNote: "parallel s16 100 W · fine s32 1 W · module 6 = PV + hybrid",
    matrixCols: [
      { label: "QUANTITY" },
      { label: "REG" },
      { label: "PARALLEL" },
      { label: "REG" },
      { label: "FINE" },
      { label: "MODULE 6" },
      { label: "OF RATED" },
    ],
    matrixRows: [
      scopeRow("PV", parPv, "34428", finePv, "34779", m6Pv, "34903", C.warn),
      scopeRow(
        "Battery",
        parBat,
        "34430",
        fineBat,
        "34781",
        m6Bat,
        "34905",
        C.green,
      ),
      scopeRow(
        "Inverter AC",
        parInv,
        "34432",
        null,
        "—",
        m6Inv,
        "34907",
        C.purple,
      ),
      scopeRow(
        "AC grid port",
        parAcPort,
        "34537",
        fineAcPort,
        "34785",
        m6AcPort,
        "34911",
        C.blue,
      ),
      scopeRow(
        "Public grid / PCC",
        parPublicGrid,
        "34491",
        finePcc,
        "34795",
        m6PublicGrid,
        "34921",
        C.purple,
      ),
      scopeRow(
        "Backup load",
        parBackup,
        "34431",
        null,
        "—",
        m6Backup,
        "34909",
        C.cyan,
      ),
      scopeRow(
        "Grid-side load",
        parGridLoad,
        "34490",
        null,
        "—",
        m6GridLoad,
        "34919",
        C.cyan,
      ),
      scopeRow(
        "Smart load",
        parSmart,
        "34433",
        null,
        "—",
        m6Smart,
        "34915",
        C.cyan,
      ),
      scopeRow("Generator", parGen, "34429", null, "—", null, "—", C.warn),
      scopeRow("AC couple", parAcCouple, "34434", null, "—", null, "—", C.cyan),
      scopeRow(
        "Grid-tied inverters",
        null,
        "—",
        null,
        "—",
        m6GridTied,
        "34917",
        C.warn,
      ),
    ],
    blocks: [
      {
        title: "PARALLEL SYSTEM",
        rows: [
          markRow(34427, "Parallel block", parOk),
          row(read, 33097, "Function status", { color: C.purple }),
          row(read, 33296, "Master / slave"),
          row(read, 34243, "Sync result"),
          literalRow(
            "Online inverters",
            "33338",
            onlineN === null
              ? NO_READING
              : `${onlineN} · IDs ${onlineIds(online)}`,
            onlineN === null ? C.dim : C.blue,
          ),
          row(read, 33388, "Online bitmap", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
        ],
      },
      {
        title: "MODULE 6 · PV + HYBRID",
        rows: [
          markRow(34902, "Module 6 block", mod6Ok),
          row(read, 34900, "Module ID", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
          // Low byte is the count of valid registers from 34902; the high byte
          // is reserved, so masking it off is what the description asks for.
          row(read, 34901, "Valid registers", {
            text: (d) => (d.missing ? NO_READING : String(d.raw & 0xff)),
          }),
          row(read, 34923, "Grid-tied online"),
          row(read, 34917, "Grid-tied power"),
        ],
      },
      {
        title: "PARALLEL AC & SOC",
        rows: [
          row(read, 33245, "Parallel inverter P"),
          row(read, 33244, "Parallel inverter V"),
          row(read, 33243, "Parallel inverter I"),
          row(read, 33246, "Parallel CT detect"),
          // 34797/34798 are SOC percentages: the description says "1~100:
          // battery SOC", but the map's units column carries a stray "W". The
          // unit is suppressed here rather than printing "85 W" for an SOC.
          row(read, 34797, "Highest pack SOC", {
            text: (d) => (d.missing ? NO_READING : `${d.text} %`),
          }),
          row(read, 34798, "Lowest pack SOC", {
            text: (d) => (d.missing ? NO_READING : `${d.text} %`),
          }),
        ],
      },
    ],
    extra: {
      title: "SYSTEM LOADING",
      note: `% of ${rating ? groupThousands(String(rating)) : "—"} VA rating · this unit`,
      // Every power bar is a system total measured against THIS unit's rated
      // VA, which is the only rating the device publishes. On a multi-inverter
      // install a bar can therefore exceed 100 % — that is a true statement
      // about the system relative to one box, not an invented full scale, and
      // an unread 33067 drops every one of them rather than guessing.
      //
      // The SOC bars are the exception: those are percentages already, so they
      // need no denominator at all.
      bars: compact([
        bar("PV total", finest(finePv, parPv), rating, C.warn, signedPower),
        bar(
          "Battery total",
          finest(fineBat, parBat),
          rating,
          C.green,
          signedPower,
        ),
        bar("Inverter AC total", parInv, rating, C.purple, signedPower),
        bar(
          "AC grid port",
          finest(fineAcPort, parAcPort),
          rating,
          C.blue,
          signedPower,
        ),
        bar(
          "PCC",
          finest(finePcc, parPublicGrid),
          rating,
          C.purple,
          signedPower,
        ),
        bar("Backup load", parBackup, rating, C.cyan, signedPower),
        bar("Grid-side load", parGridLoad, rating, C.cyan, signedPower),
        bar2(
          "Highest pack SOC",
          socMax,
          `${socMax.text} %`,
          socMax.value,
          C.green,
        ),
        bar2(
          "Lowest pack SOC",
          socMin,
          `${socMin.text} %`,
          socMin.value,
          C.warn,
        ),
      ]),
    },
  };
}

/**
 * EPS / BACKUP — the off-grid output subsystem.
 *
 * The backup port is the socket the house keeps running from when the grid
 * drops. It is a DIFFERENT measurement point from the AC grid port, and that
 * is the whole reason this panel exists: `deviceAllTab` shows three backup
 * words (33137/33138/33148) inside its "AC PORTS" summary, which answers "is
 * the backup port live?" and nothing about per-phase balance, transfer timing
 * or the reference the inverter is regulating to. This is the deep view.
 *
 * TWO POWER BLOCKS, AND WHY BOTH ARE HERE
 * ---------------------------------------
 * 33521-33529 is the inverter's own measurement of what it pushes out of each
 * backup phase (W/var/VA, s16 at scale 10). 34611/34613 is the same port
 * totalled as a signed 32-bit pair, which is the only place a backup load
 * beyond the 16-bit range can be read without stitching 33148 to its high word
 * at 34344. They agree in normal operation; a disagreement is itself
 * diagnostic, so both are shown rather than one being picked.
 *
 * SCOPE. `backupLoadTotalActivePower` at 34611 is module-1 scope — THIS unit's
 * port. `systemBackupLoadTotalActivePower` at 34909 is module-6 scope, the
 * whole PV + hybrid system, and it is a DIFFERENT KEY, so both resolve through
 * `hybridAddressTable` and both are reachable. 34431 is the parallel block's
 * own total at scale 100. All three sit side by side in SYSTEM TOTALS because
 * on a parallel install they legitimately differ, and a reader comparing one
 * against another without knowing the scope will think the inverter is lying.
 *
 * REFERENCE VALUES AS BAR DENOMINATORS
 * ------------------------------------
 * 33201 and 33202 are not invented full scales. They are setpoints the
 * inverter publishes and actively regulates its own backup output to — the
 * gospel descriptions read "10<-->1V, Default: 230V" and "100<-->1Hz,
 * Default: 50Hz". Drawing the measured backup voltage and frequency against
 * the inverter's own reference is therefore the most useful bar on this panel:
 * in healthy operation every bar sits at 100 %, and any bar that does not is
 * the inverter failing to hold its own target. `ratingAt` returns 0 when the
 * reference itself was never read, so those bars vanish rather than being
 * drawn against a guess.
 *
 * The per-phase POWER bars keep the device's rated apparent power (33067) as
 * their denominator, because the map publishes no separate power rating for
 * the backup port and the VA rating is the real one it shares with the grid
 * port.
 *
 * 33132 AND 33463 ARE REPEATED HERE ON PURPOSE, from a different angle than
 * the Status panel takes. 33132 bit 2 is "Off-Grid" — the only place the map
 * states whether the unit is CONFIGURED for off-grid running at all, which is
 * the first question asked of a backup port that is dark. 33463 carries the
 * map's only "Backup Overload" bit, so it is repeated in OFF-GRID STATE rather
 * than sending the reader to another panel mid-diagnosis.
 */
export function epsBackupTab(read: RawReader): TabModel {
  const V = [33137, 33153, 33155] as const;
  const I = [33138, 33154, 33156] as const;
  const P = [33521, 33524, 33527] as const;
  const Q = [33522, 33525, 33528] as const;
  const S = [33523, 33526, 33529] as const;

  const loadP = splitWordAt(read, 33148);
  const totalP = decodeAddress(34611, read.at(34611));
  const totalS = decodeAddress(34613, read.at(34613));
  const opStatus = decodeAddress(33287, read.at(33287));
  const switchTime = decodeAddress(33299, read.at(33299));
  const epsSoc = decodeAddress(33298, read.at(33298));
  const offGridSoc = decodeAddress(33297, read.at(33297));
  const derate = decodeAddress(33463, read.at(33463));

  const rating = ratedVA(read);
  // The inverter's OWN published backup setpoints. See the header — these are
  // device-published references, not invented full scales.
  const refV = ratingAt(read, 33201); // backupCircuitReferenceVoltage
  const refF = ratingAt(read, 33202); // backupCircuitReferenceFrequency
  const ratedI = ratingAt(read, 33042); // rated AC-port output current

  /**
   * Whether the inverter says it is actually running off-grid.
   *
   * 33287 codes 4 (Off-Grid), 5 (Off-Grid to On-Grid) and 6 (Backup Bypass)
   * all mean the backup port is carrying the house one way or another. Read
   * off the RAW word rather than the decoded label, so a firmware shipping an
   * unmapped code falls through to "not off-grid" instead of matching on text
   * that never appeared.
   */
  const offGrid = !opStatus.missing && [4, 5, 6].includes(opStatus.raw & 0xffff);

  const phaseRow = (i: number, name: string): MatrixCell[] => {
    const v = decodeAddress(slot(V, i), read.at(slot(V, i)));
    const c = decodeAddress(slot(I, i), read.at(slot(I, i)));
    const p = decodeAddress(slot(P, i), read.at(slot(P, i)));
    const q = decodeAddress(slot(Q, i), read.at(slot(Q, i)));
    const s = decodeAddress(slot(S, i), read.at(slot(S, i)));
    return [
      { text: name },
      cell(v),
      cell(c),
      p.missing ? gone : { text: signedPower(p), color: C.cyan },
      q.missing ? gone : { text: groupThousands(q.text) },
      s.missing ? gone : { text: groupThousands(s.text) },
      pctCell(s, rating),
    ];
  };

  return {
    addresses: [],
    regRange: "33137–34613",
    kpis: [
      {
        label: "BACKUP LOAD",
        value: kw(totalP.missing ? loadP : totalP),
        unit: "kW",
        sub: totalP.missing ? "reg 33148" : "reg 34611",
        color: C.cyan,
      },
      {
        label: "OPERATING",
        value: opStatus.missing ? NO_READING : opStatus.text.toUpperCase(),
        unit: "",
        sub: "reg 33287",
        color: opStatus.missing ? undefined : offGrid ? C.warn : C.green,
      },
      {
        label: "TRANSFER",
        value: switchTime.text,
        unit: switchTime.units || "ms",
        sub: "EPS switching · reg 33299",
      },
      {
        label: "EPS CUT-OFF",
        value: epsSoc.text,
        unit: epsSoc.units || "%",
        sub: "over-discharge · reg 33298",
        color: epsSoc.missing ? undefined : C.purple,
      },
    ],
    matrixTitle: "BACKUP PORT · PER PHASE",
    matrixNote: "V/A from 33137+ · W/var/VA from 33521+",
    matrixCols: [
      { label: "PHASE" },
      { label: "V", reg: "33137" },
      { label: "I", reg: "33138" },
      { label: "P", reg: "33521" },
      { label: "Q", reg: "33522" },
      { label: "S", reg: "33523" },
      { label: "% VA" },
    ],
    matrixRows: [
      phaseRow(0, "A"),
      phaseRow(1, "B"),
      phaseRow(2, "C"),
      // The 32-bit port totals. Same physical port as the three phase rows
      // above, read at the wider width that survives a large load, so they
      // belong in this table rather than in a detail block.
      [
        { text: "TOTAL", color: C.ink3 },
        gone,
        gone,
        totalP.missing
          ? gone
          : { text: signedPower(totalP), color: C.cyan, strong: true },
        gone,
        totalS.missing ? gone : { text: groupThousands(totalS.text) },
        pctCell(totalS, rating),
      ],
    ],
    blocks: [
      {
        title: "OFF-GRID STATE",
        rows: [
          row(read, 33287, "Operating status", {
            color: offGrid ? C.warn : undefined,
          }),
          row(read, 33122, "Operating mode", { color: C.purple }),
          // The storage control word raw, then decoded. Bit 2 is "Off-Grid":
          // whether the unit is CONFIGURED to run off-grid at all, which is
          // the first thing to check on a backup port that is dark.
          row(read, 33132, "Storage control", {
            text: (d) => (d.missing ? NO_READING : toHexWord(d.raw)),
          }),
          row(read, 33132, "Storage flags", { color: C.purple }),
          // Repeated from the Status panel deliberately: "Backup Overload" is
          // the map's only overload signal and belongs where the backup port
          // is being diagnosed.
          row(read, 33463, "Derate / overload", {
            color: derate.bits.length ? C.warn : undefined,
          }),
          row(read, 33296, "Parallel master/slave"),
        ],
      },
      {
        title: "BACKUP CIRCUIT",
        rows: [
          row(read, 33200, "Circuit enable"),
          row(read, 33201, "Reference voltage"),
          row(read, 33202, "Reference frequency"),
          row(read, 33299, "EPS switching time"),
          row(read, 33298, "EPS over-discharge SOC"),
          row(read, 33297, "Off-grid over-discharge SOC"),
        ],
      },
      {
        title: "BACKUP ENERGY",
        rows: [
          row(read, 33596, "Today"),
          row(read, 33597, "Yesterday"),
          row(read, 33594, "This month"),
          row(read, 33592, "This year"),
          row(read, 33590, "Lifetime"),
        ],
      },
      {
        title: "SYSTEM TOTALS",
        rows: [
          // Three DIFFERENT scopes of the same measurement. See the header.
          row(read, 34611, "This unit (module 1)"),
          row(read, 34909, "Whole system (module 6)"),
          row(read, 34431, "Parallel system"),
          row(read, 34613, "This unit apparent"),
          // 33148 is the 16-bit low word of the same port total and 34344 is
          // its high word. Shown as the pair the document describes rather
          // than stitched, because stitching them here would hide which half
          // the firmware actually populated.
          row(read, 33148, "Port power low"),
          row(read, 34344, "Port power high"),
        ],
      },
      {
        title: "SMART PORT",
        rows: [
          // The second backup output: physically a different socket from the
          // EPS port above, but the same subsystem, and no other panel shows
          // it.
          row(read, 34391, "Smart port A"),
          row(read, 34392, "Smart port B"),
          row(read, 34393, "Smart port C"),
          row(read, 33147, "Grid load (excl. backup)"),
          row(read, 33042, "Rated port current"),
          row(read, 33067, "Rated apparent"),
        ],
      },
    ],
    extra: {
      title: "BACKUP OUTPUT · AGAINST THE PUBLISHED REFERENCE",
      note: refV
        ? `${refV.toFixed(1)} V / ${refF ? refF.toFixed(2) : "—"} Hz reference`
        : "reference unread",
      // Voltage against 33201 and current against the rated port current
      // (33042); power against the device's rated VA (33067). 33202 is read
      // for the note but draws no bar of its own — the backup port publishes
      // no measured frequency register, only the reference it targets, and a
      // bar of a setpoint against itself is always 100 % and says nothing.
      // There is deliberately no bar for switching time or for the energy
      // counters: the map publishes no rated value for either.
      bars: compact([
        bar("A voltage", decodeAddress(V[0], read.at(V[0])), refV, C.blue),
        bar("B voltage", decodeAddress(V[1], read.at(V[1])), refV, C.blue),
        bar("C voltage", decodeAddress(V[2], read.at(V[2])), refV, C.blue),
        bar("A current", decodeAddress(I[0], read.at(I[0])), ratedI, C.grey),
        bar("B current", decodeAddress(I[1], read.at(I[1])), ratedI, C.grey),
        bar("C current", decodeAddress(I[2], read.at(I[2])), ratedI, C.grey),
        bar(
          "A active",
          decodeAddress(P[0], read.at(P[0])),
          rating,
          C.cyan,
          signedPower,
        ),
        bar(
          "B active",
          decodeAddress(P[1], read.at(P[1])),
          rating,
          C.cyan,
          signedPower,
        ),
        bar(
          "C active",
          decodeAddress(P[2], read.at(P[2])),
          rating,
          C.cyan,
          signedPower,
        ),
        bar("Port total", totalP, rating, C.cyan, signedPower),
        bar("Port apparent", totalS, rating, C.warn),
        // Both cut-off SOCs ARE percentages, so they carry their own scale and
        // need no rating register.
        bar2(
          "EPS cut-off SOC",
          epsSoc,
          `${epsSoc.text} %`,
          epsSoc.value,
          C.purple,
        ),
        bar2(
          "Off-grid cut-off SOC",
          offGridSoc,
          `${offGridSoc.text} %`,
          offGridSoc.value,
          C.purple,
        ),
      ]),
    },
  };
}

/**
 * GENERATOR — what the generator is actually doing.
 *
 * The SETTINGS side already has a GENERATOR tab, so a user can configure
 * start/stop SOC, charge current and run windows. Nothing on the DATA side
 * reported back what the generator was doing with any of it. This closes that
 * gap.
 *
 * PHASE A IS 33530. The task described 33530 as "realTimePowerOfGenerator"
 * with no explicit phase-A register in the run, which reads like a total. It
 * is not: the gospel `name` for 33530 is literally "Generator Phase A Active
 * Power" (v3.5 p25) and its description says "Single-phase systems use Phase
 * A power." The key `realTimePowerOfGenerator` is a legacy store name kept for
 * lookup, not a statement of scope. So 33530/33534/33535 are A/B/C at the same
 * S16 x10 W scale, and the total is a separate register.
 *
 * WHICH TOTAL. `generatorTotalActivePower` exists three times — 34492, 34617
 * and 34913. Only ONE can be read: `hybridAddressTable` keeps the FIRST
 * data-space record per key, so 34492 wins and the other two resolve to no
 * legacy key at all and would render "--" forever. 34492 is therefore the one
 * used here. It is worth knowing that this is the WORSE of the three: 34617 is
 * the documented S32 1 W register whose description even explains its
 * 0x80000000 "no generator" sentinel, while 34492 is an unverified stub with
 * no unit and no source. Fixing that is a change to the address table's
 * first-wins rule, which is out of scope for one panel and would move the
 * register out from under every other reader of that key. Instead the panel
 * shows a per-phase sum it computes itself, which is honest and needs no
 * disputed register.
 *
 * THE 36xxx MAPPING BLOCK IS NOT REACHABLE FROM THIS PAGE. 36029 / 36042 /
 * 36043 duplicate the settings switch, input power and daily generation. They
 * resolve to legacy keys, so they look reachable, but the hybrid DATA tab
 * fetches `33000 + buttonIndex * numberOfRegisters` over 1600 registers —
 * 33000..34599. 36xxx is the EPM base and is never requested here, so every
 * one of those three would render "--" permanently. They are left out rather
 * than shown as three dead rows duplicating registers that do work.
 */
export function generatorTab(read: RawReader): TabModel {
  const pA = decodeAddress(33530, read.at(33530));
  const pB = decodeAddress(33534, read.at(33534));
  const pC = decodeAddress(33535, read.at(33535));

  const today = decodeAddress(33531, read.at(33531));
  const total = decodeAddress(33532, read.at(33532));
  const yesterday = decodeAddress(34444, read.at(34444));

  const volts = decodeAddress(34253, read.at(34253));
  const runState = decodeAddress(34590, read.at(34590));
  const parallelP = decodeAddress(34429, read.at(34429));

  // The Smart Port is the physical port a generator is wired to when the
  // installation uses one, so its V/I is the generator's own terminals.
  const spV = [34328, 34329, 34330] as const;
  const spI = [34331, 34332, 34333] as const;

  const rating = ratedVA(read);
  const ratedV = ratingAt(read, 33718); // acRatedVoltage

  /**
   * Total generator power, summed from the phases this panel already reads.
   *
   * Preferred over 34492 deliberately — see the header. A sum is only stated
   * when at least one phase actually read; summing nothing would produce a
   * confident 0 W for a generator that never reported.
   */
  const phaseValues = [pA, pB, pC]
    .filter((d) => !d.missing && d.value !== null)
    .map((d) => d.value as number);
  const summedW = phaseValues.length
    ? phaseValues.reduce((a, b) => a + b, 0)
    : null;

  const running = !runState.missing && runState.raw === 2;

  const phaseRow = (
    name: string,
    p: Decoded,
    reg: string,
    i: number,
  ): MatrixCell[] => {
    const v = decodeAddress(slot(spV, i), read.at(slot(spV, i)));
    const c = decodeAddress(slot(spI, i), read.at(slot(spI, i)));
    return [
      { text: name },
      { text: reg, color: C.ink3 },
      p.missing ? gone : { text: signedPower(p), color: C.warn },
      p.missing ? gone : { text: kw(p, true) },
      cell(v),
      cell(c),
      pctCell(p, rating),
    ];
  };

  return {
    addresses: [],
    regRange: "33530–34590",
    kpis: [
      {
        label: "OUTPUT",
        value:
          summedW === null ? NO_READING : groupThousands((summedW / 1000).toFixed(2)),
        unit: "kW",
        sub: "A+B+C · 33530/34/35",
        color: summedW === null ? undefined : C.warn,
      },
      {
        label: "RUN STATE",
        value: runState.missing ? NO_READING : runState.text.toUpperCase(),
        unit: "",
        sub: "reg 34590",
        color: runState.missing ? undefined : running ? C.green : C.dim,
      },
      {
        label: "TODAY",
        value: today.text,
        unit: today.units || "kWh",
        sub: yesterday.missing ? "reg 33531" : `${yesterday.text} yesterday`,
      },
      {
        label: "LIFETIME",
        value: total.missing ? NO_READING : groupThousands(total.text),
        unit: total.units || "kWh",
        sub: "reg 33532",
      },
    ],
    matrixTitle: "GENERATOR · PER PHASE",
    matrixNote: "W/kW at the Smart Port terminals",
    matrixCols: [
      { label: "PHASE" },
      { label: "REG" },
      { label: "W" },
      { label: "kW" },
      { label: "V", reg: "34328" },
      { label: "I", reg: "34331" },
      { label: "OF RATED" },
    ],
    matrixRows: [
      phaseRow("A", pA, "33530", 0),
      phaseRow("B", pB, "33534", 1),
      phaseRow("C", pC, "33535", 2),
      [
        { text: "TOTAL", color: C.ink3 },
        { text: "sum", color: C.ink3 },
        summedW === null
          ? gone
          : {
              text: groupThousands(String(Math.round(summedW))),
              color: C.warn,
              strong: true,
            },
        summedW === null
          ? gone
          : { text: (summedW / 1000).toFixed(2), strong: true },
        gone,
        gone,
        summedW === null || !rating
          ? gone
          : { text: `${((Math.abs(summedW) / rating) * 100).toFixed(0)} %` },
      ],
    ],
    blocks: [
      {
        title: "GENERATOR",
        rows: [
          row(read, 34590, "Run state", {
            color: running ? C.green : undefined,
          }),
          row(read, 34253, "Voltage"),
          row(read, 34410, "Frequency"),
          // 33097 bit 4 is "Generator Connected". The whole bit list is shown
          // rather than that one bit, because the gospel owns the labels and
          // picking a single bit out here would hard-code its position.
          row(read, 33097, "Function status"),
          row(read, 34252, "SPH mode"),
          row(read, 34429, "Parallel total"),
        ],
      },
      {
        title: "ENERGY",
        rows: [
          row(read, 33531, "Today"),
          row(read, 34444, "Yesterday"),
          row(read, 34442, "This month"),
          row(read, 34440, "This year"),
          row(read, 33532, "Lifetime"),
        ],
      },
    ],
    extra: {
      title: "GENERATOR LOADING",
      note: `% of ${rating ? groupThousands(String(rating)) : "—"} VA rating`,
      // The generator's own rated input power lives at 43364, in the SETTINGS
      // space, which this DATA store does not hold — so it cannot scale these
      // bars. The inverter's rated apparent power (33067) is the only rating
      // reachable here, and it is the right ceiling anyway: the generator
      // cannot push more through the inverter than the inverter is rated for.
      // Voltage scales against the device's own rated AC voltage. Frequency
      // has no reachable rating (43098 is settings-space too) so it gets no
      // bar rather than an invented 65 Hz full scale.
      bars: compact([
        bar("A active", pA, rating, C.warn, signedPower),
        bar("B active", pB, rating, C.warn, signedPower),
        bar("C active", pC, rating, C.warn, signedPower),
        bar("Parallel total", parallelP, rating, C.purple, signedPower),
        bar("Voltage", volts, ratedV, C.blue),
        bar(
          "SP A voltage",
          decodeAddress(spV[0], read.at(spV[0])),
          ratedV,
          C.blue,
        ),
      ]),
    },
  };
}

/* ── shared builders ───────────────────────────────────────────────── */

/** Rated apparent power, the denominator every loading bar uses. */
function ratedVA(read: RawReader): number {
  return ratingAt(read, 33067);
}

/**
 * A bar's full-scale value, read from the map like everything else.
 *
 * The design's sample data carried invented full-scale numbers — 460 V for a
 * voltage bar, 65 Hz for frequency, 50 kWh for daily energy. Those are not
 * readings and must never be drawn as if they were: the inverter publishes its
 * own rated voltage, its own trip thresholds and its own rated power, so the
 * scale comes from the device.
 *
 * Returns 0 when the rating register itself was never read, which makes
 * `pctOf` return null and the caller drop the bar. A bar drawn against a
 * guessed scale is worse than no bar.
 */
function ratingAt(read: RawReader, address: number): number {
  const d = decodeAddress(address, read.at(address));
  return d.missing || !d.value ? 0 : d.value;
}

/** A row whose stored value is text, not a number (model name, serial). */
function serialRow(read: RawReader, address: number, label: string): DetailRow {
  const text = read.textAt(address);
  const num = read.at(address);
  const value =
    text ?? (num === null ? NO_READING : decodeAddress(address, num).text);
  return {
    label,
    reg: String(address),
    value,
    color: value === NO_READING ? C.dim : undefined,
    note: noteFor(address),
  };
}

/**
 * One bar from a decode, scaled against a rating.
 *
 * Returns null when the register was never read, or when the rating it would
 * be drawn against is itself unknown. A bar with no scale is a bar with no
 * meaning, so the caller drops it rather than showing a track at 0 %.
 */
function bar(
  label: string,
  d: Decoded,
  rating: number,
  color: string,
  text?: (d: Decoded) => string,
): BarItem | null {
  const pct = pctOf(d, rating);
  if (pct === null) return null;
  const body = text ? text(d) : groupThousands(d.text);
  return {
    label,
    value: d.units ? `${body} ${d.units}` : body,
    pct,
    color,
  };
}

/** A bar whose percentage IS the value — SOC, SOH. Dropped when unread. */
function bar2(
  label: string,
  d: Decoded,
  value: string,
  pct: number | null,
  color: string,
): BarItem | null {
  if (d.missing || pct === null) return null;
  return { label, value, pct, color };
}

/** camelCase key -> a 74 px bar label. */
/**
 * A bar label for a flag word.
 *
 * Prefers the gospel's own `name` ("Inverter operating status") over the
 * camelCase key split on capitals ("operating Status"), because the name is
 * what the document calls the register and reads as English. Falls back to
 * the split key, then to the bare address.
 */
function flagLabel(address: number): string {
  const reg = byAddress.get(address);
  if (reg?.name && reg.name !== reg.key) return reg.name;
  if (reg?.key) return reg.key.replace(/([A-Z])/g, " $1").trim();
  return String(address);
}

/** The builder for one tab, without the address bookkeeping. */
function builderFor(tab: TabKey): (read: RawReader) => TabModel {
  switch (tab) {
    case "battery":
      return batteryTab;
    case "batteryAll":
      return batteryAllTab;
    case "pv":
      return pvTab;
    case "device":
      return deviceTab;
    case "deviceAll":
      return deviceAllTab;
    case "dispatch":
      return dispatchTab;
    case "faults":
      return faultsTab;
    case "grid":
    default:
      return gridTab;
  }
}

/**
 * Build the whole model for one tab, and record which registers it read.
 *
 * `addresses` is filled from `read.touched()` AFTER the builder has run, so it
 * is exactly the set the panel asked for. Doing it here rather than in each
 * builder means a panel can never claim a register it does not draw, or miss
 * one it does.
 */
export function buildTab(tab: TabKey, read: RawReader): TabModel {
  return withAddresses(builderFor(tab), read);
}

/** Run a builder and stamp the addresses it touched onto the result. */
export function withAddresses(
  build: (read: RawReader) => TabModel,
  read: RawReader,
): TabModel {
  const model = build(read);
  return { ...model, addresses: read.touched() };
}

/** The device bar's own summary, independent of which tab is showing. */
export interface DeviceSummary {
  model: string;
  serial: string;
  faults: number;
  warnings: number;
}

export function deviceSummary(read: RawReader): DeviceSummary {
  const model = read.textAt(33000);
  const modelNum = read.at(33000);
  const serial = read.textAt(33004);
  return {
    model:
      model ??
      (modelNum === null
        ? NO_READING
        : `0x${modelNum.toString(16).toUpperCase()}`),
    serial: serial ?? NO_READING,
    // The extended block (34394-34402) and the SPH pair carry real fault bits
    // the original seven words do not reach, so a fault raised only there used
    // to leave the device bar reading "0 faults". An unread word contributes
    // nothing, so a device that never fetches 34394+ counts exactly as before.
    faults:
      countFlags(read, FAULT_WORDS) +
      countFlags(read, EXT_FAULT_WORDS) +
      countFlags(read, SPH_FAULT_WORDS),
    warnings:
      countFlags(read, WARNING_WORDS) + countFlags(read, BATTERY_FAULT_WORDS),
  };
}


export type { GospelRegister };

/* ── CEI 0-21, the Italian grid self-test ──────────────────────────── */

/**
 * The ten protection functions CEI 0-21 verifies, in document order.
 *
 * Each is measured on all three phases, and each measurement is a VALUE and a
 * TIME in adjacent registers. The three phase blocks are perfectly regular —
 * A at 33223, B at 33470, C at 33490, ten (value, time) pairs each — so the
 * table is generated from three base addresses rather than from the sixty
 * hand-written legacy key names the old widget carried. Sixty names was sixty
 * chances to typo one into another register's word.
 *
 * `unit` is the axis the function trips on, and is used only to head the
 * column; the displayed value and its units come from the gospel record, as
 * everywhere else in this file.
 */
export const CEI_TESTS: Array<{
  id: string;
  description: string;
  unit: "V" | "Hz";
}> = [
  { id: "59.S1", description: "Over Voltage Stage 1", unit: "V" },
  { id: "59.S2", description: "Over Voltage Stage 2", unit: "V" },
  { id: "27.S1", description: "Under Voltage Stage 1", unit: "V" },
  { id: "27.S2", description: "Under Voltage Stage 2", unit: "V" },
  { id: "81>.S1", description: "Over Frequency Stage 1", unit: "Hz" },
  { id: "81<.S1", description: "Under Frequency Stage 1", unit: "Hz" },
  { id: "81>.S2F", description: "Over Freq Stage 2 (Fast)", unit: "Hz" },
  { id: "81<.S2F", description: "Under Freq Stage 2 (Fast)", unit: "Hz" },
  { id: "81>.S2S", description: "Over Freq Stage 2 (Slow)", unit: "Hz" },
  { id: "81<.S2S", description: "Under Freq Stage 2 (Slow)", unit: "Hz" },
];

/** First register of each phase's ten (value, time) pairs. */
export const CEI_PHASE_BASE = { A: 33223, B: 33470, C: 33490 } as const;

/** The (value, time) address pair for one test on one phase. */
export function ceiPair(
  phase: keyof typeof CEI_PHASE_BASE,
  testIndex: number,
): { value: number; time: number } {
  const base = CEI_PHASE_BASE[phase] + testIndex * 2;
  return { value: base, time: base + 1 };
}

/**
 * The self-test state machine, as the two status registers report it.
 *
 * Kept here rather than read from the gospel because 33221/33222 carry no
 * `value_map` — the labels come from the CEI 0-21 document. If the map ever
 * gains them, `decodeAddress` will return the label and this table can go.
 */
export const CEI_SELF_TEST_STATUS: Record<number, string> = {
  0: "Idle",
  1: "Single Self-Test",
  2: "Full Self-Test",
};

/** The single-function result codes, with the colour each result reads as. */
export const CEI_RESULT: Record<number, { label: string; color: string }> = {
  0: { label: "Invalid", color: C.dim },
  1: { label: "Conditions Not Met", color: C.warn },
  2: { label: "Testing…", color: C.blue },
  3: { label: "PASS", color: C.green },
  100: { label: "FAIL — CT Abnormal", color: C.red },
};

/**
 * CEI 0-21 self-test, in the Detail Panels style.
 *
 * The protection results are the matrix — ten rows, one per function, with a
 * value and a time for each of the three phases. Steady-state grid readings
 * become the KPI strip, because they are what tells you whether the inverter
 * was in a fit state to be tested at all, and the self-test state machine
 * becomes a detail block.
 *
 * Every number is decoded through the gospel. The old widget printed
 * `${v.value} ${v.units}` off the legacy parsed `variables`, which for the
 * TIME registers meant a raw millisecond count carrying the literal units
 * string "1ms".
 */
export function ceiTab(read: RawReader): TabModel {
  const vA = decodeAddress(33073, read.at(33073));
  const vB = decodeAddress(33074, read.at(33074));
  const vC = decodeAddress(33075, read.at(33075));
  const iA = decodeAddress(33076, read.at(33076));
  const iB = decodeAddress(33077, read.at(33077));
  const iC = decodeAddress(33078, read.at(33078));
  const freq = decodeAddress(33094, read.at(33094));

  const single = decodeAddress(33221, read.at(33221));
  const full = decodeAddress(33222, read.at(33222));
  const result = decodeAddress(33290, read.at(33290));

  const statusText = (d: Decoded): string =>
    d.missing ? NO_READING : (CEI_SELF_TEST_STATUS[d.raw] ?? d.text);

  const resultInfo = result.missing ? null : CEI_RESULT[result.raw];

  /* A measured value and the time it took, side by side. Both dim to "--"
     independently: a phase that reported a trip level but no time is a real
     state, and merging them would hide it. */
  const pairCells = (
    phase: keyof typeof CEI_PHASE_BASE,
    testIndex: number,
  ): MatrixCell[] => {
    const { value, time } = ceiPair(phase, testIndex);
    const v = decodeAddress(value, read.at(value));
    const t = decodeAddress(time, read.at(time));
    return [cell(v, { strong: true }), cell(t, { color: C.ink3 })];
  };

  const matrixRows: MatrixCell[][] = CEI_TESTS.map((test, i) => [
    { text: test.id, strong: true },
    { text: test.description, color: C.ink3 },
    ...pairCells("A", i),
    ...pairCells("B", i),
    ...pairCells("C", i),
  ]);

  const phaseKpi = (name: string, v: Decoded, c: Decoded): Kpi => ({
    label: name,
    value: v.missing ? NO_READING : v.text,
    unit: v.missing ? "" : v.units,
    sub: c.missing ? `${NO_READING} A` : `${c.text} ${c.units}`,
    color: v.missing ? C.dim : C.blue,
  });

  return {
    addresses: [],
    regRange: "33073–33509",
    kpis: [
      phaseKpi("PHASE A", vA, iA),
      phaseKpi("PHASE B", vB, iB),
      phaseKpi("PHASE C", vC, iC),
      {
        label: "FREQUENCY",
        value: freq.missing ? NO_READING : freq.text,
        unit: freq.missing ? "" : freq.units,
        sub: "grid",
        color: freq.missing ? C.dim : C.purple,
      },
    ],
    matrixTitle: "PROTECTION FUNCTIONS",
    matrixNote: "value / time, per phase",
    matrixCols: [
      { label: "Test" },
      { label: "Function" },
      { label: "A", reg: "33223" },
      { label: "A time" },
      { label: "B", reg: "33470" },
      { label: "B time" },
      { label: "C", reg: "33490" },
      { label: "C time" },
    ],
    matrixRows,
    blocks: [
      {
        title: "SELF-TEST STATE",
        rows: [
          row(read, 33221, "Single self-test", { text: statusText }),
          row(read, 33222, "Full self-test", { text: statusText }),
          {
            label: "Operation result",
            reg: "33290",
            value: result.missing
              ? NO_READING
              : (resultInfo?.label ?? `Code ${result.raw}`),
            color: result.missing ? C.dim : (resultInfo?.color ?? C.ink),
            note: noteFor(33290),
          },
        ],
      },
      {
        title: "DEVICE",
        rows: [
          serialRow(read, 33004, "Serial number"),
          // `serialRow`, not `row`, for the model: 33000 carries "Product
          // Model Number" in its gospel `units` field, which is a description
          // rather than a unit, so `row` would render "3306 Product Model
          // Number". The DEVICE panels take the same route for the same
          // reason — see `deviceTab`.
          serialRow(read, 33000, "Model"),
          row(read, 33094, "Grid frequency"),
        ],
      },
    ],
    extra: { title: "", note: "", bars: [] },
  };
}
