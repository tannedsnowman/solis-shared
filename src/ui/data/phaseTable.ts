/**
 * The dense phase table: phases down the side, quantities across the top.
 *
 * Separate from `tabModel.ts` because the two layouts coexist — STATUS,
 * FAULTS and DEVICE keep the sectioned `DataPanel`, while anything measuring
 * a three-phase quantity uses this.
 *
 * The defining rule: a register number belongs BESIDE ITS VALUE, never in a
 * column header. A header register is a lie the moment two rows read
 * different registers, which is exactly the battery pack 2 bug.
 */
import { decodeAddress, NO_READING, Decoded } from "./decode";
import { slot } from '../pv/captures';
import { RawReader } from './rawReader';
import { groupThousands, signedPower } from "./tabModel";
import { C } from "./panelStyles";

export interface PhaseCell {
  text: string;
  /** The register number, or a formula for a calculated cell. */
  reg: string;
  color?: string;
  strong?: boolean;
  /** Calculated, not read. Rendered amber and italic. */
  calc?: boolean;
}

export interface PhaseRow {
  label: string;
  cells: PhaseCell[];
  /** The TOTAL row is tinted to separate it from the phases. */
  total?: boolean;
}

export interface StripCell {
  label: string;
  value: string;
  reg: string;
  calc?: boolean;
}

export interface PhaseTableModel {
  regRange: string;
  addresses: number[];
  columns: string[];
  rows: PhaseRow[];
  /** Single readings that are not per-phase. */
  strip: StripCell[];
  /** Energy counters, kept in their own strip. */
  energy: StripCell[];
  /** Shown only when some cell is calculated. */
  legend?: string;
}

/** Read one register into a cell that carries its own address. */
export function phaseCell(
  read: RawReader,
  address: number,
  opts: { color?: string; strong?: boolean; text?: (d: Decoded) => string } = {},
): PhaseCell {
  const d = decodeAddress(address, read.at(address));
  return {
    text: d.missing ? NO_READING : opts.text ? opts.text(d) : d.text,
    reg: String(address),
    color: d.missing ? undefined : opts.color,
    strong: opts.strong,
  };
}

/**
 * A derived cell. `formula` takes the slot a register would occupy, so the
 * provenance of every number on screen is visible without a tooltip.
 */
export function calcCell(text: string | null, formula: string): PhaseCell {
  return { text: text ?? NO_READING, reg: formula, calc: true };
}

/** A cell with nothing in it — voltage has no total, and that is not missing. */
export function blankCell(): PhaseCell {
  return { text: "", reg: "" };
}

export function stripCell(
  read: RawReader,
  address: number,
  label: string,
): StripCell {
  const d = decodeAddress(address, read.at(address));
  return {
    label,
    value: d.missing ? NO_READING : `${d.text}${d.units ? ` ${d.units}` : ""}`,
    reg: String(address),
  };
}

/**
 * Apparent power.
 *
 * A REGISTER ALWAYS WINS. `V x I` is the fallback for ports that publish P and
 * Q but no S — the grid port is the case in hand. Marking the fallback keeps a
 * user from quoting a computed VA down the phone as if the inverter said it.
 */
export function apparentCell(
  read: RawReader,
  opts: { direct?: number; v: number; i: number },
): PhaseCell {
  if (opts.direct !== undefined) {
    const d = decodeAddress(opts.direct, read.at(opts.direct));
    if (!d.missing) {
      return { text: groupThousands(d.text), reg: String(opts.direct) };
    }
  }
  const v = decodeAddress(opts.v, read.at(opts.v));
  const i = decodeAddress(opts.i, read.at(opts.i));
  if (v.missing || i.missing || v.value === null || i.value === null) {
    return calcCell(null, "V x I");
  }
  return calcCell(groupThousands(String(Math.round(v.value * i.value))), "V x I");
}

/**
 * A per-phase power total, summed from three registers this widget already
 * trusts (rather than a fourth, worse register that claims to already be the
 * total). Used by `generatorTable2`, whose real total registers are either
 * unreachable (34617) or an undocumented u32 that misdecodes its own
 * "no generator" sentinel as +2.1 GW (34492) -- see that function's header
 * comment for the full account.
 *
 * If ANY phase is missing the sum is missing too, never a partial total: a
 * generator with a dead phase-C feed must not show a plausible two-phase
 * number as if it were the whole picture.
 */
export function sumPhasesCell(
  read: RawReader,
  addresses: readonly number[],
  opts: { color?: string; strong?: boolean } = {},
): PhaseCell {
  const decoded = addresses.map((a) => decodeAddress(a, read.at(a)));
  if (decoded.some((d) => d.missing || d.value === null)) {
    return { ...calcCell(null, "A+B+C"), color: opts.color, strong: opts.strong };
  }
  const sum = decoded.reduce((acc, d) => acc + (d.value as number), 0);
  const body = groupThousands(String(Math.round(Math.abs(sum))));
  const text = sum > 0 ? `+${body}` : sum < 0 ? `-${body}` : body;
  return { ...calcCell(text, "A+B+C"), color: opts.color, strong: opts.strong };
}

/**
 * The two battery packs.
 *
 * THIS IS THE BUG THE RESTRUCTURE EXISTS TO FIX. The old matrix put register
 * numbers in the COLUMN HEADER (e.g. "V 33133"), so pack 2's voltage row
 * appeared to read register 33133 when it actually reads 34289 — a user
 * chasing a pack 2 fault would fetch the wrong register block and misdiagnose
 * a live site. Every cell here carries its own address instead, so the two
 * packs cannot be confused no matter which row a user is staring at.
 *
 * Every address below was checked against `src/mapper/generated/hybrid.json`
 * directly, not carried over from the legacy widgets:
 *   - SOC: 33139 / 34278, u16, scale 1, units "%".
 *   - V:   33133 / 34289, u16, scale 0.1, units "V".
 *   - I:   33134 / 34290, s16, scale 0.1, units "A".
 *   - P:   33149-33150 / 34368-34369, s32 pairs (registered under their LOW
 *     address, "33149-33150" / "34368-34369" in the gospel), scale 1, units
 *     "W". `read.at`/`decodeAddress` take the low address and assemble the
 *     pair themselves, the same as every other S32 in this file.
 *   - TEMP: 33043 / 34277, s16, scale 0.1, units "℃".
 *   - STATE: 33135 / 34291, u16 with a value_map {0: "Charging", 1:
 *     "Discharging"} -- an enum, so it is read with `phaseCell` (which shows
 *     the decoded label) and never with `stripCell` (whose unit-appending
 *     would mangle a label; see stripCell's own caveat below).
 *   - SOH: 33140 / 34279, u16, scale 1, units "%".
 *   - Energy: 33163 (charge) / 33167 (discharge), u16, scale 0.1, units
 *     "kWh". Both are single system-wide counters, not per-pack, so they sit
 *     in the energy strip rather than in a pack row.
 *
 * None of the strip/energy registers (33140, 34279, 33163, 33167) decode to
 * an enum or bitfield, so `stripCell`'s inline unit-append is safe here.
 */
export function batteryPacksTable(read: RawReader): PhaseTableModel {
  const P1 = { soc: 33139, v: 33133, i: 33134, p: 33149, temp: 33043, state: 33135 };
  const P2 = { soc: 34278, v: 34289, i: 34290, p: 34368, temp: 34277, state: 34291 };

  const packRow = (label: string, r: typeof P1): PhaseRow => ({
    label,
    cells: [
      phaseCell(read, r.soc),
      phaseCell(read, r.v),
      phaseCell(read, r.i, { text: signedPower }),
      phaseCell(read, r.p, { text: signedPower }),
      phaseCell(read, r.temp),
      phaseCell(read, r.state, { strong: true }),
    ],
  });

  return {
    regRange: "33041-34390",
    addresses: [...Object.values(P1), ...Object.values(P2), 33140, 34279, 33163, 33167],
    columns: ["SOC", "V", "I", "P", "TEMP", "STATE"],
    rows: [packRow("PACK 1", P1), packRow("PACK 2", P2)],
    strip: [
      stripCell(read, 33140, "SOH P1"),
      stripCell(read, 34279, "SOH P2"),
    ],
    energy: [
      stripCell(read, 33163, "CHG TODAY"),
      stripCell(read, 33167, "DCHG TODAY"),
    ],
  };
}

/**
 * The external grid meter.
 *
 * The old `gridTab` drew this same matrix AND, underneath it, a PHASE BALANCE
 * bar panel that re-plotted the same per-phase active power and voltage as
 * bars -- the top and bottom of the widget showed the same numbers twice.
 * That duplication is why this restructure started; the bars are gone here,
 * and `gridTab` itself is left alone (Task 9 removes its last caller).
 *
 * Every address below was checked against `src/mapper/generated/hybrid.json`
 * directly:
 *   - V:  33251/33253/33255, u16, scale 0.1, units "V".
 *   - I:  33252/33254/33256, u16, scale 0.01, units "A" (NOT 0.1 -- current
 *     scales differently from voltage on this meter, see apparentCell's own
 *     test for the same gotcha).
 *   - P:  33257-33258/33259-33260/33261-33262 per phase, s32 pairs (low
 *     address 33257/33259/33261), scale 1, units "W". Total at 33263-33264.
 *   - Q:  33265-33266/33267-33268/33269-33270 per phase, s32 pairs, scale 1,
 *     units "Var". Total at 33271-33272.
 *   - S:  33273-33274/33275-33276/33277-33278 per phase, s32 pairs, scale 1,
 *     units "VA". Total at 33279-33280.
 *   - PF: 33281, s16, scale 0.01, units "" -- ONE register, not per-phase. The
 *     old gridTab put it on phase A's row and left B/C blank; mirrored here.
 *   - FREQ: 33282, u16, scale 0.01, units "Hz" -- one reading, not a
 *     per-phase quantity, so it sits in the strip rather than as a column.
 *   - CT POS: 33250, u16, bit_flags (no value_map) -- an enum-shaped reading.
 *   - MODE: 33091, u16, value_map -- also enum-shaped.
 *   - Energy: 33283-33284 (imported) / 33285-33286 (exported), u32 pairs,
 *     scale 0.01, units "kWh".
 *
 * `stripCell` appends units inline instead of suppressing them the way
 * `decode.ts`'s `withUnits()` does for an enum/bitfield decode (see
 * `stripCell`'s own doc comment). CT POS and MODE are both enum-shaped, which
 * is exactly the case that helper warns about -- but I checked both records
 * in the gospel and their `units` field is `""` for both, so `stripCell`'s
 * `${d.text}${d.units ? ... }` appends nothing and the label prints as-is.
 * No actual misrender here; flagged in the task report per the brief's
 * instruction to report rather than silently work around it.
 */
export function gridMeterTable(read: RawReader): PhaseTableModel {
  const V = [33251, 33253, 33255] as const;
  const I = [33252, 33254, 33256] as const;
  const P = [33257, 33259, 33261] as const;
  const Q = [33265, 33267, 33269] as const;
  const S = [33273, 33275, 33277] as const;
  const PF = 33281;

  const phase = (n: number, label: string): PhaseRow => ({
    label,
    cells: [
      phaseCell(read, slot(V, n)),
      phaseCell(read, slot(I, n)),
      phaseCell(read, slot(P, n), { color: C.purple, text: signedPower }),
      phaseCell(read, slot(Q, n)),
      phaseCell(read, slot(S, n)),
      n === 0 ? phaseCell(read, PF) : blankCell(),
    ],
  });

  return {
    regRange: "33250-33290",
    addresses: [...V, ...I, ...P, ...Q, ...S, PF, 33263, 33271, 33279, 33282, 33283, 33285, 33250, 33091],
    columns: ["V", "I", "P", "Q", "S", "PF"],
    rows: [
      phase(0, "A"),
      phase(1, "B"),
      phase(2, "C"),
      {
        label: "TOTAL",
        total: true,
        cells: [
          // Voltage and current do not sum across phases -- blank, not "--".
          blankCell(),
          blankCell(),
          phaseCell(read, 33263, { color: C.purple, strong: true, text: signedPower }),
          phaseCell(read, 33271, { strong: true }),
          phaseCell(read, 33279, { strong: true }),
          blankCell(),
        ],
      },
    ],
    strip: [
      stripCell(read, 33282, "FREQ"),
      stripCell(read, 33250, "CT POS"),
      stripCell(read, 33091, "MODE"),
    ],
    energy: [
      stripCell(read, 33283, "FROM GRID"),
      stripCell(read, 33285, "TO GRID"),
    ],
  };
}

const CALC_LEGEND = "amber italic = calculated, not read from Modbus";

/**
 * The inverter's own AC grid port.
 *
 * There are NO grid-port-specific voltage or current registers. 33073-33078
 * ("A/B/C Phase Voltage" and "A/B/C Phase Current" in the gospel) is the
 * inverter's own AC output V/I -- the same electrical point as the grid
 * port -- so it is read DIRECTLY here and must NOT be marked calculated.
 * Per-phase S genuinely has no register anywhere in the gospel, so it alone
 * is derived as `V x I` via `apparentCell`, which renders amber/italic and
 * shows the formula in place of a register number.
 *
 * The TOTAL row's S (33083, "Apparent Power Value") IS a real register, so
 * it renders upright, not calculated -- the deliberate contrast the task
 * calls for: derived per-phase S sitting next to a measured total S.
 *
 * Every address below was checked against `src/mapper/generated/hybrid.json`
 * directly:
 *   - V: 33073/33074/33075, u16, scale 0.1, units "V".
 *   - I: 33076/33077/33078, u16, scale 0.1, units "A".
 *   - P: 33512/33515/33518 ("Inverter AC Grid Port Phase A/B/C Active
 *     Power"), s16, scale 10, units "W".
 *   - Q: 33513/33516/33519 (same port, Reactive Power), s16, scale 10,
 *     units "Var".
 *   - TOTAL P: 33151 ("Inverter AC Grid Port Real-time Total Active
 *     Power"), s32 pair (low address 33151), scale 1, units "W".
 *   - TOTAL Q: 33081 ("Reactive Power Value"), s32 pair, scale 1, units
 *     "Var".
 *   - TOTAL S: 33083 ("Apparent Power Value"), s32 pair, scale 1, units
 *     "VA".
 *   - Energy: 33577 (Daily Power Export) / 33578 (Daily Power Import), u16,
 *     scale 0.1, units "kWh".
 *
 * None of the strip/energy registers here (33577, 33578) decode to an enum
 * or bitfield, so `stripCell`'s inline unit-append is safe.
 *
 * Per the Task 5 ruling carried into this task: the TOTAL row leaves V and I
 * blank via `blankCell()` rather than summing or echoing phase A, because
 * neither has a true total register.
 */
export function gridPortTable(read: RawReader): PhaseTableModel {
  const V = [33073, 33074, 33075] as const;
  const I = [33076, 33077, 33078] as const;
  const P = [33512, 33515, 33518] as const;
  const Q = [33513, 33516, 33519] as const;

  const phase = (n: number, label: string): PhaseRow => ({
    label,
    cells: [
      phaseCell(read, slot(V, n)),
      phaseCell(read, slot(I, n)),
      phaseCell(read, slot(P, n), { color: C.purple, text: signedPower }),
      phaseCell(read, slot(Q, n)),
      apparentCell(read, { v: slot(V, n), i: slot(I, n) }),
    ],
  });

  return {
    regRange: "33073-33083 / 33512-33519",
    addresses: [...V, ...I, ...P, ...Q, 33151, 33081, 33083],
    columns: ["V", "I", "P", "Q", "S"],
    rows: [
      phase(0, "A"),
      phase(1, "B"),
      phase(2, "C"),
      {
        label: "TOTAL",
        total: true,
        cells: [
          blankCell(),
          blankCell(),
          phaseCell(read, 33151, { color: C.purple, strong: true, text: signedPower }),
          phaseCell(read, 33081, { strong: true }),
          phaseCell(read, 33083, { strong: true }),
        ],
      },
    ],
    strip: [],
    energy: [
      stripCell(read, 33577, "EXPORT TODAY"),
      stripCell(read, 33578, "IMPORT TODAY"),
    ],
    legend: CALC_LEGEND,
  };
}

/**
 * The backup (EPS) port -- the most completely instrumented of the three,
 * and the deliberate contrast to `gridPortTable`: it publishes S per phase,
 * so nothing here is calculated.
 *
 * Every address below was checked against `src/mapper/generated/hybrid.json`
 * directly:
 *   - V: 33137/33153/33155 ("Backup Port AC Voltage A/B/C"), u16, scale 0.1,
 *     units "V".
 *   - I: 33138/33154/33156 ("Backup Port AC Current A/B/C"), u16, scale 0.1,
 *     units "A".
 *   - P: 33521/33524/33527 ("Inverter Backup Port Phase A/B/C Active
 *     Power"), s16, scale 10, units "W".
 *   - Q: 33522/33525/33528 (same port, Reactive Power), s16, scale 10,
 *     units "Var".
 *   - S: 33523/33526/33529 (same port, Apparent Power -- phase C's record is
 *     titled "Inverter Backup Side Phase C Apparent Power", a naming
 *     inconsistency in the gospel itself, not a different quantity), s16,
 *     scale 10, units "VA".
 *   - TOTAL P: 34611 ("Backup Load Total Active Power"), s32 pair, scale 1,
 *     units "W".
 *   - TOTAL S: 34613 ("Backup Load Total Apparent Power"), s32 pair, scale
 *     1, units "VA". There is no total-Q register for this port, so TOTAL Q
 *     is left blank rather than summed or echoed.
 *   - Energy: 33596 (Backup Load Daily Power Consumption), u16, scale 0.1,
 *     units "kWh"; 33590 (Backup Load Total Power Consumption), u32, scale
 *     1, units "kWh".
 *
 * None of the strip/energy registers here (33596, 33590) decode to an enum
 * or bitfield, so `stripCell`'s inline unit-append is safe.
 */
export function backupPortTable(read: RawReader): PhaseTableModel {
  const V = [33137, 33153, 33155] as const;
  const I = [33138, 33154, 33156] as const;
  const P = [33521, 33524, 33527] as const;
  const Q = [33522, 33525, 33528] as const;
  const S = [33523, 33526, 33529] as const;

  const phase = (n: number, label: string): PhaseRow => ({
    label,
    cells: [
      phaseCell(read, slot(V, n)),
      phaseCell(read, slot(I, n)),
      phaseCell(read, slot(P, n), { color: C.purple, text: signedPower }),
      phaseCell(read, slot(Q, n)),
      phaseCell(read, slot(S, n)),
    ],
  });

  return {
    regRange: "33137-33156 / 33521-33529",
    addresses: [...V, ...I, ...P, ...Q, ...S, 34611, 34613],
    columns: ["V", "I", "P", "Q", "S"],
    rows: [
      phase(0, "A"),
      phase(1, "B"),
      phase(2, "C"),
      {
        label: "TOTAL",
        total: true,
        cells: [
          blankCell(),
          blankCell(),
          phaseCell(read, 34611, { color: C.purple, strong: true, text: signedPower }),
          blankCell(),
          phaseCell(read, 34613, { strong: true }),
        ],
      },
    ],
    strip: [],
    energy: [
      stripCell(read, 33596, "TODAY"),
      stripCell(read, 33590, "TOTAL"),
    ],
  };
}

/**
 * House load: grid-side (normal running) and backup-side (EPS running on
 * battery/generator), each with a REAL total register -- neither is summed
 * from phases.
 *
 * Every address below was checked against `src/mapper/generated/hybrid.json`
 * directly:
 *   - Grid-side per-phase P: 34424/34425/34426 ("Grid Load Phase A/B/C Active
 *     Power"), u16, scale 10, units "W". THESE ARE u16, NOT s16, YET THEY ARE
 *     RENDERED WITH `signedPower` BELOW -- checked deliberately, not an
 *     oversight. A u16 can never carry a negative reading (there is no sign
 *     bit to decode), so `signedPower` can only ever print a leading "+" or
 *     the bare magnitude here, never a "-". That is correct BECAUSE grid-side
 *     LOAD is a consumption-side quantity: a house does not export power
 *     back through its own load meter by definition, so an unsigned register
 *     is the right shape for this quantity, not a limitation of it. If that
 *     assumption were ever wrong -- some future firmware using the top bit
 *     for an export condition -- a negative reading would arrive as its
 *     two's-complement bit pattern decoded as a huge positive (up to
 *     655 350 W after the x10 scale) rather than as a negative number, the
 *     same class of bug as the generator/smart-load sentinel misdecode
 *     documented below. Watch this register if that ever changes.
 *   - Grid-side TOTAL P: 34623 ("Grid-side Load Total Active Power"), s32
 *     pair, scale 1, units "W". A REAL register -- the plan originally called
 *     this calculated by summing phases, which was wrong; the gospel is the
 *     authority and this is measured directly.
 *   - Backup-side TOTAL P: 34611 ("Backup Load Total Active Power"), s32
 *     pair, scale 1, units "W" -- the same register `backupPortTable` already
 *     reads for its own total.
 *   - Backup-side TOTAL S: 34613 ("Backup Load Total Apparent Power"), s32
 *     pair, scale 1, units "VA" -- also shared with `backupPortTable`.
 *   - Energy (grid-side load): 33586 (Grid Load Daily Power Consumption),
 *     u16, scale 0.1, units "kWh"; 33587 (Household load yesterday energy),
 *     u16, scale 0.1, units "kWh"; 33584 (Household load This month energy),
 *     u32, scale 1, units "kWh"; 33582 (Household load This year energy),
 *     u32, scale 1, units "kWh"; 33580 (Grid Load Total Power Consumption),
 *     u32, scale 1, units "kWh".
 *
 * There is no backup-side per-phase load power register in the gospel (the
 * backup PORT phases live in `backupPortTable`, which is the port's own AC
 * measurement, not "load"), so backup only appears as a TOTAL column here.
 *
 * None of the registers above decode to an enum or bitfield, so `stripCell`'s
 * inline unit-append is safe.
 */
export function loadTable(read: RawReader): PhaseTableModel {
  const GRID = [34424, 34425, 34426] as const;

  const phase = (n: number, label: string): PhaseRow => ({
    label,
    cells: [phaseCell(read, slot(GRID, n), { color: C.purple, text: signedPower }), blankCell()],
  });

  return {
    regRange: "34424-34426 / 34611-34623",
    addresses: [...GRID, 34623, 34611, 34613, 33586, 33587, 33584, 33582, 33580],
    columns: ["GRID LOAD P", "BACKUP LOAD"],
    rows: [
      phase(0, "A"),
      phase(1, "B"),
      phase(2, "C"),
      {
        label: "TOTAL",
        total: true,
        cells: [
          phaseCell(read, 34623, { color: C.purple, strong: true, text: signedPower }),
          phaseCell(read, 34611, { strong: true, text: signedPower }),
        ],
      },
    ],
    strip: [stripCell(read, 34613, "BKP S")],
    energy: [
      stripCell(read, 33586, "TODAY"),
      stripCell(read, 33587, "YDAY"),
      stripCell(read, 33584, "MONTH"),
      stripCell(read, 33582, "YEAR"),
      stripCell(read, 33580, "TOTAL"),
    ],
  };
}

/**
 * The generator.
 *
 * PHASE A IS 34253 ("SPH generator voltage"). Only phase A voltage is
 * published in the gospel -- there is no phase B or C generator-voltage
 * register at all. B and C are left BLANK via `blankCell()` rather than
 * shown as 0 V or an echo of phase A: a fake reading on a running generator
 * is exactly the kind of thing that sends an engineer to site for nothing.
 *
 * PER-PHASE P is 33530/33534/33535 ("Generator Phase A/B/C Active Power"),
 * s16, scale 10, units "W" -- matching `generatorTab`'s own header note that
 * the legacy key names are misleading but the gospel `name` field settles it.
 *
 * TOTAL P IS CALCULATED FROM THE PHASES, NOT READ FROM 34492 OR 34617.
 * `generatorTotalActivePower` is a duplicate key across THREE scopes in the
 * gospel: 34492, 34617 and 34913. `hybridAddressTable`'s FIRST-wins rule for
 * keys repeated across scopes resolves this key to 34492, so 34617 --
 * despite being the documented register, with a real name, `present_in:
 * ["v3.4","v3.5"]`, and a description explaining its own sentinel -- is
 * UNREACHABLE through `read.at()`: nothing in the live fetch path
 * (`gospelMapper.ts` `dataRegisters()`, which is FIRST-wins for the same
 * reason) ever writes 34617's word into the store under any key, so a lookup
 * there renders "--" forever. Changing the first-wins rule would move the
 * register out from under every other reader of that key, so that is not the
 * fix.
 *
 * 34492 is not merely "the worse of the two documented registers" -- it is
 * not documented at all. Checked in the gospel: `unverified: true`,
 * `present_in: []`, meaning it appears in NO document revision. And it is
 * actively WRONG in the case that matters most: it is `kind: "u32"`, but
 * `decode.ts`'s sentinel guard (`reg?.kind === 's32' && ... === S32_NO_READING`)
 * only fires for `kind: "s32"`. The gospel's own description of 34617 says
 * register 34617 is "fixed at 0x80000000" when no generator is connected --
 * that sentinel word also lands in 34492 (same electrical event, same word),
 * but because 34492 is u32 the guard never fires, `applySign` takes the u32
 * branch (`raw + 0x100000000`), and 0x80000000 becomes +2 147 483 648. A
 * hybrid with no generator fitted would show a 2.1 GW generator total as a
 * plain upright number -- exactly the "plausible wrong number" this rewrite
 * exists to prevent.
 *
 * So neither candidate register is usable: 34617 cannot be read, and 34492
 * lies about its one documented failure mode. The fix is to stop reading a
 * total register at all and calculate it from the generator's own per-phase
 * registers instead (33530/33534/33535 below), via `calcCell` with formula
 * "A+B+C". If any phase is missing, the total is missing, never zero -- see
 * `calcCell`'s own contract.
 *
 * STRIP: FREQ is 34410 ("Generator Frequency"), u16, scale 0.01, units "Hz".
 * STATUS is 34590 ("Generator Preheat/Cooling Operation Status"), u16 with a
 * value_map ({1: Stopped, 2: Supplying Power, 3: Preheating, 4: Cooling}) --
 * an enum. Checked in the gospel: its `units` field is "" (empty), same as
 * `gridMeterTable`'s CT POS/MODE case, so `stripCell`'s
 * `${d.text}${d.units ? ... }` appends nothing and the label prints as-is --
 * no "Idle W"-style mangling here. PARALLEL is 34429 ("Parallel System Total
 * Generator Active Power"), s16, scale 100, units "W".
 *
 * ENERGY: 33531 (Generator Daily Power Generation), u16, scale 0.1, units
 * "kWh"; 34444 (generatorPowerGenerationPreviousDay), u16, scale 0.1, units
 * "kWh"; 34442 (generatorPowerGenerationMonth), u32, scale 1, units "kWh";
 * 34440 (generatorPowerGenerationYear), u32, scale 1, units "kWh"; 33532
 * (Generator Total Power Generation), u32, scale 1, units "kWh".
 */
export function generatorTable2(read: RawReader): PhaseTableModel {
  const P = [33530, 33534, 33535] as const;

  return {
    regRange: "33530-33535 / 34410-34429",
    addresses: [...P, 34253, 34410, 34590, 34429, 33531, 34444, 34442, 34440, 33532],
    columns: ["V", "P"],
    rows: [
      { label: "A", cells: [phaseCell(read, 34253), phaseCell(read, P[0], { color: C.purple, text: signedPower })] },
      { label: "B", cells: [blankCell(), phaseCell(read, P[1], { color: C.purple, text: signedPower })] },
      { label: "C", cells: [blankCell(), phaseCell(read, P[2], { color: C.purple, text: signedPower })] },
      {
        label: "TOTAL",
        total: true,
        // Summed from the phases -- see the header comment above for why
        // neither 34492 nor 34617 is usable.
        cells: [blankCell(), sumPhasesCell(read, P, { color: C.purple, strong: true })],
      },
    ],
    strip: [
      stripCell(read, 34410, "FREQ"),
      stripCell(read, 34590, "STATUS"),
      stripCell(read, 34429, "PARALLEL"),
    ],
    energy: [
      stripCell(read, 33531, "TODAY"),
      stripCell(read, 34444, "YDAY"),
      stripCell(read, 34442, "MONTH"),
      stripCell(read, 34440, "YEAR"),
      stripCell(read, 33532, "TOTAL"),
    ],
    legend: CALC_LEGEND,
  };
}

/**
 * The smart port measurement set, shared by all three roles.
 *
 * Generator, AC-coupled and smart load are three modes of ONE physical port,
 * so V/I/per-phase-P are literally the same registers:
 *   - V: 34328/34329/34330 ("Smartport Phase A/B/C AC Voltage"), u16, scale
 *     0.1, units "V".
 *   - I: 34331/34332/34333 ("Smartport Phase A/B/C AC Current"), u16, scale
 *     0.1, units "A".
 *   - P: 34391/34392/34393 ("Smart Port Phase A/B/C Active Power (for
 *     connected smart load or grid-tied inverter)"), s16, scale 10, units
 *     "W".
 *
 * Each role keeps its own widget because each has its own TOTAL and its own
 * energy counters, which is what `acCoupledTable`/`smartLoadTable` add.
 */
const SMART_V = [34328, 34329, 34330] as const;
const SMART_I = [34331, 34332, 34333] as const;
const SMART_P = [34391, 34392, 34393] as const;

function smartPortRows(read: RawReader, totalCell: PhaseCell): PhaseRow[] {
  const phase = (n: number, label: string): PhaseRow => ({
    label,
    cells: [
      phaseCell(read, slot(SMART_V, n)),
      phaseCell(read, slot(SMART_I, n)),
      phaseCell(read, slot(SMART_P, n), { color: C.purple, text: signedPower }),
    ],
  });
  return [
    phase(0, "A"),
    phase(1, "B"),
    phase(2, "C"),
    {
      label: "TOTAL",
      total: true,
      cells: [blankCell(), blankCell(), totalCell],
    },
  ];
}

/**
 * AC-coupled: a PV (grid-tied) inverter wired into the Smart port.
 *
 * TOTAL P HAS NO USABLE REGISTER, SO IT RENDERS "--". The only candidate is
 * 34496 ("acCoupleTotalActivePower"): checked in the gospel it is `kind:
 * "u32"`, `unverified: true`, `present_in: []` -- it exists at only this one
 * address (no better-documented duplicate elsewhere, unlike the
 * generator/smart-load pair below), but that also means there is nothing to
 * fall back to. It carries the SAME risk as 34492/34494: `decode.ts`'s
 * "no reading" sentinel guard only fires for `kind: "s32"`, so if this u32
 * register ever carries the 0x80000000 "not connected" word (the same
 * pattern the gospel documents for the generator/smart-load siblings), it
 * misdecodes as +2 147 483 648 instead of "--". An unverified register that
 * appears in NO document revision is not a foundation to build a total on,
 * and unlike the generator there is no per-phase sum to fall back to either
 * (see below), so this total is left unavailable via `calcCell(null, ...)`
 * rather than risk a fabricated number. If a future gospel revision adds a
 * documented, reachable total for this port, read it directly and drop this
 * comment.
 *
 * A phase-sum is NOT used here (unlike the generator): AC-coupled shares its
 * per-phase P registers (34391-34393) with smart load, since both are modes
 * of the same physical Smart port. Summing them would give AC-coupled and
 * smart load IDENTICAL totals, which is not a total for either -- it would
 * just restate the port's own reading twice under two different labels.
 *
 * ENERGY: 34452 (acCouplingPowerGenerationPreviousDay), u16, scale 1, units
 * "" -- the only AC-coupled-specific energy counter in the gospel; there is
 * no today/month/year/lifetime breakdown for this role.
 */
export function acCoupledTable(read: RawReader): PhaseTableModel {
  return {
    regRange: "34328-34393 / 34496",
    addresses: [...SMART_V, ...SMART_I, ...SMART_P, 34452],
    columns: ["V", "I", "P"],
    rows: smartPortRows(read, calcCell(null, "no reachable reg")),
    strip: [],
    energy: [stripCell(read, 34452, "YDAY")],
    legend: CALC_LEGEND,
  };
}

/**
 * Smart load: a controllable load wired into the Smart port.
 *
 * TOTAL P HAS NO USABLE REGISTER, SO IT RENDERS "--". Same root cause as the
 * generator's total (see `generatorTable2`'s header): `smartLoadTotalActivePower`
 * is a duplicate key across scopes (34494, 34619, and a module-6 copy).
 * `hybridAddressTable`'s FIRST-wins rule resolves the key to 34494, so 34619
 * -- the documented register, `kind: "s32"`, `present_in: ["v3.4","v3.5"]`,
 * with a description explaining its own 0x80000000 "no smart load" sentinel
 * -- is UNREACHABLE through `read.at()`. 34494 itself is `kind: "u32"`,
 * `unverified: true`, `present_in: []`: undocumented in any revision, AND
 * because it is u32 the sentinel guard in `decode.ts` never fires for it, so
 * the same 0x80000000 "no smart load" word that 34619 would have reported
 * cleanly instead decodes on 34494 as +2 147 483 648.
 *
 * UNLIKE THE GENERATOR, A PHASE-SUM IS NOT THE FIX HERE. Smart load's
 * per-phase P registers (34391-34393) are the SAME registers AC-coupled
 * reads, because both are modes of one physical Smart port (see the header
 * comment above `smartPortRows`). Summing them for smart load's total would
 * produce the exact same number as AC-coupled's total, which is meaningless
 * for both -- it is not "smart load's total power", it is "the port's power,
 * asked twice." So the total is left unavailable via `calcCell(null, ...)`:
 * losing a number here is correct, because the only candidate register is an
 * unverified stub that misdecodes its own sentinel, and there is no honest
 * substitute the way there is for the generator.
 *
 * STRIP: PARALLEL is 34433 ("Parallel System Total Smart Load Active
 * Power"), s16, scale 100, units "w" (lowercase in the gospel record itself
 * -- not an enum/bitfield, so `stripCell`'s inline unit-append is safe, just
 * a lowercase unit letter carried straight from the source).
 *
 * ENERGY: 34413 (Smart Load Daily Power Consumption), u16, scale 1, units
 * "kWh"; 34439 (smartLoadElectricityConsumptionPreviousDay), u16, scale 1,
 * units ""; 34437 (smartLoadElectricityConsumptionMonth), u32, scale 1,
 * units ""; 34435 (smartLoadElectricityConsumptionYear), u32, scale 1, units
 * ""; 34411 (Smart Load Total Power Consumption), u32, scale 1, units "kWh".
 */
export function smartLoadTable(read: RawReader): PhaseTableModel {
  return {
    regRange: "34328-34393 / 34433",
    addresses: [...SMART_V, ...SMART_I, ...SMART_P, 34433, 34413, 34439, 34437, 34435, 34411],
    columns: ["V", "I", "P"],
    // No reachable, trustworthy total register -- see the header comment above.
    rows: smartPortRows(read, calcCell(null, "no reachable reg")),
    strip: [stripCell(read, 34433, "PARALLEL")],
    energy: [
      stripCell(read, 34413, "TODAY"),
      stripCell(read, 34439, "YDAY"),
      stripCell(read, 34437, "MONTH"),
      stripCell(read, 34435, "YEAR"),
      stripCell(read, 34411, "TOTAL"),
    ],
    legend: CALC_LEGEND,
  };
}
