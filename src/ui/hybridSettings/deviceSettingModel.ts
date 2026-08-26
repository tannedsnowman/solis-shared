/**
 * The Device Setting screen: what is on it, and which category each row is in.
 *
 * WHY THIS SCREEN HAS SUB-HEADINGS AND THE OTHERS DO NOT
 * -----------------------------------------------------
 * The other one-column screens are deliberately flat — six rows read faster
 * without headings, and SolisCloud's pages have none. This one carries
 * twenty-odd rows spanning meters, backup output, EPS, DC/MPPT tuning and two
 * irreversible commands. A flat list of that length is something you scroll
 * through hunting, so the rows are grouped into categories.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * SolisCloud's Device Setting page lists several rows that already live on
 * another screen in this app, and duplicating a writable register across two
 * screens is how two views of one machine end up disagreeing:
 *
 *   43052 / 43051 / 43053  -> Control Panel (max output, reactive, PF)
 *   43073 BIT06            -> Storage Mode (unbalance output)
 *   43249 BIT00            -> Protect Setting (MPPT parallel)
 *
 * It also lists some rows twice: 43052 at both #20 and #22, and 43053 at both
 * #23 and #24. Those are genuine duplicates and appear once here.
 *
 * 43140 is NOT a duplicate, though it looks like one — SolisCloud shows it as
 * a "Meter Type" row and a "Location" row against the same address because it
 * is one register holding two bytes: high byte location, low byte type. Both
 * rows are kept, since they are two real settings, but each is written masked
 * to its own byte so picking a type cannot wipe the location.
 *
 * TWO ROWS HERE CANNOT BE UNDONE
 * ------------------------------
 * Factory reset (43033) and restart HMI (43031) are one-shot COMMANDS, not
 * settings: they take a magic value and act. They are `kind: 'command'` here,
 * are drawn last under a red DANGER sub-heading, and are the only rows on the
 * screen that ask for confirmation before firing.
 */
import { byAddress } from '../../gospel/gospel'
import {
  PACKED_FIELDS,
  PackedField,
} from '../../settings/packedFields'
import { ruleFor } from '../settings/GospelRows'

/* ------------------------------------------------------------- registers -- */

/** Meter and CT. */
export const METER_TYPE_LOCATION = 43140
export const METER_COMMS = 43283
export const CT_DIRECTION = 43029
export const CT_RATIO = 43362
export const PT_RATIO = 44233
/** Meter/CT placement word. BIT13 picks meter vs CT; BIT06 is Storage Mode's. */
export const METER_CT_PLACEMENT = 43073

/** Backup (EPS) output port. */
export const BACKUP_ENABLE = 43111
export const BACKUP_VOLTAGE = 43112
export const BACKUP_FREQUENCY = 43113
export const VOLTAGE_DROOP = 43123
export const DROOP_MIN_VOLTAGE = 43650

/** EPS behaviour. */
export const EPS_FUNCTION = 43705
export const EPS_SWITCH_TIME = 43139
export const EPS_DOD = 43138

/** DC side and tuning. */
export const SPECIAL_FUNCTION = 43302
export const CONST_VOLTAGE_SETPOINT = 43248
export const VFB_ADJ_SCALE = 43241

/** Commands. */
export const CLEAR_YIELD = 43055
export const RESTART_HMI = 43031
export const FACTORY_RESET = 43033

/* ------------------------------------------------------------------ rows -- */

export type DeviceRowKind = 'value' | 'bit' | 'packed' | 'command'

export interface DeviceRow {
  address: number
  label: string
  description: string
  kind: DeviceRowKind
  /** The category sub-heading this row sits under. */
  section: string
  /**
   * `bit` rows only: the bit's label as the rules file spells it. Looked up
   * rather than counted, so a renumbered gospel moves the row with it.
   */
  bitLabel?: string
  /**
   * `packed` rows only: the sub-field's name in `PACKED_FIELDS`. Two rows of
   * one register, one per byte, each written masked to its own byte.
   */
  packedField?: string
  /**
   * `command` rows only: the value that makes the command happen. Taken from
   * the gospel rule's `unlock_value` where there is one, so it is not typed
   * twice — see `commandValueOf`.
   */
  commandValue?: number
  /** `command` rows only: what the confirm modal asks. */
  confirm?: string
}

export const SECTION_METER = 'Meter and CT'
export const SECTION_BACKUP = 'Backup output port'
export const SECTION_EPS = 'EPS'
export const SECTION_DC = 'DC side and tuning'
export const SECTION_COMMANDS = 'Commands — cannot be undone'

/**
 * Every category, in the order the screen draws them.
 *
 * Meter first because it is what most Device Setting visits are actually for,
 * commands last because they are the rows you least want to meet by accident
 * while scrolling.
 */
export const SECTIONS: Array<{ title: string; note?: string; danger?: boolean }> = [
  {
    title: SECTION_METER,
    note: 'Which meter is fitted, where it sits, and how it is scaled.',
  },
  {
    title: SECTION_BACKUP,
    note: 'The off-grid output: whether it runs, and at what voltage and frequency.',
  },
  {
    title: SECTION_EPS,
    note: 'How the machine behaves when the grid goes away.',
  },
  {
    title: SECTION_DC,
    note: 'PV input and converter tuning. Leave these alone unless you know why you are changing them.',
  },
  {
    title: SECTION_COMMANDS,
    note: 'These fire immediately and there is no undo. Read and save your settings first.',
    danger: true,
  },
]

export const DEVICE_ROWS: DeviceRow[] = [
  /* ------------------------------------------------------------- meter -- */
  {
    address: METER_TYPE_LOCATION,
    label: 'Meter type',
    packedField: 'Meter Type',
    description:
      'Which meter is fitted. The low byte of 43140 — the high byte holds where it sits, in the row below. Written masked to its own byte, so picking a type cannot move the location.',
    kind: 'packed',
    section: SECTION_METER,
  },
  {
    address: METER_TYPE_LOCATION,
    label: 'Meter location',
    packedField: 'Meter Location',
    description:
      'Where the meter is installed. The high byte of the same register as the row above; SolisCloud draws these as two rows both labelled 43140, which is what they are.',
    kind: 'packed',
    section: SECTION_METER,
  },
  {
    address: METER_COMMS,
    label: 'Meter communication',
    description: 'How the meter is wired to the inverter. 0 is wired, 1 is wireless.',
    kind: 'value',
    section: SECTION_METER,
  },
  {
    address: METER_CT_PLACEMENT,
    label: 'Grid meter or CT',
    bitLabel: 'Meter/CT Selection Grid Side (1=CT)',
    description:
      'Whether the grid-side measurement comes from a meter or from a CT. Bit switch inside 43073 — the CT ratio below only does anything while this says CT.',
    kind: 'bit',
    section: SECTION_METER,
  },
  {
    address: CT_DIRECTION,
    label: 'CT direction',
    description:
      'Which way round the CT is clamped. If import and export read backwards, this is the setting, not the wiring.',
    kind: 'value',
    section: SECTION_METER,
  },
  {
    address: CT_RATIO,
    label: 'CT ratio',
    description:
      'Primary-to-secondary turns ratio of the grid CT, 1 to 30000. Only in force while the row above says CT.',
    kind: 'value',
    section: SECTION_METER,
  },
  {
    address: PT_RATIO,
    label: 'PT ratio',
    description:
      'Voltage-transformer ratio for meter 1, 1 to 30000. Left at 1 unless a PT is actually fitted.',
    kind: 'value',
    section: SECTION_METER,
  },

  /* ------------------------------------------------------------ backup -- */
  {
    address: BACKUP_ENABLE,
    label: 'Backup port enable',
    description:
      'Turns the backup (off-grid) output on and off. With this disabled nothing else in this section does anything.',
    kind: 'value',
    section: SECTION_BACKUP,
  },
  {
    address: BACKUP_VOLTAGE,
    label: 'Backup output voltage',
    description:
      'Phase voltage the backup port produces. Standard-voltage models 190–250 V, default 230 V; low-voltage models 110–140 V, default 132 V.',
    kind: 'value',
    section: SECTION_BACKUP,
  },
  {
    address: BACKUP_FREQUENCY,
    label: 'Backup output frequency',
    description: 'Frequency the backup port produces. Default 50 Hz.',
    kind: 'value',
    section: SECTION_BACKUP,
  },
  {
    address: VOLTAGE_DROOP,
    label: 'Voltage droop',
    description:
      'Lets the backup output sag under load instead of tripping, so a heavy start-up current does not drop the whole output.',
    kind: 'value',
    section: SECTION_BACKUP,
  },
  {
    address: DROOP_MIN_VOLTAGE,
    label: 'Minimum droop voltage',
    description:
      'How far the droop above is allowed to pull the voltage down. Standard-voltage models 120–230 V, default 180 V; low-voltage 70–130 V, default 100 V. Only in force while voltage droop is on.',
    kind: 'value',
    section: SECTION_BACKUP,
  },

  /* --------------------------------------------------------------- eps -- */
  {
    address: EPS_FUNCTION,
    label: 'EPS function',
    description:
      'The master switch for emergency power supply. Before this register existed, setting the switchover time to 0 was how EPS was turned off.',
    kind: 'value',
    section: SECTION_EPS,
  },
  {
    address: EPS_SWITCH_TIME,
    label: 'EPS switchover time',
    description:
      'How long the machine waits before taking the load over after the grid fails. Default 2000 ms.',
    kind: 'value',
    section: SECTION_EPS,
  },
  {
    address: EPS_DOD,
    label: 'EPS depth of discharge',
    description:
      'How far the battery may be discharged while running the backup load. Range 10–100 %; LV hybrids default 20 %, 3-phase HV default 10 %.',
    kind: 'value',
    section: SECTION_EPS,
  },

  /* ---------------------------------------------------------------- dc -- */
  {
    address: SPECIAL_FUNCTION,
    label: 'No boost',
    bitLabel: 'Boost Not Generate Wave Off',
    description:
      'SolisCloud calls this "No boost". Bit switch inside 43302, which also carries the AFCI self-check and grid-connection-type bits — so it is written masked, and the rest of the word is left alone.',
    kind: 'bit',
    section: SECTION_DC,
  },
  {
    address: CONST_VOLTAGE_SETPOINT,
    label: 'Constant voltage setpoint',
    description:
      'The DC bus voltage constant-voltage mode holds. Range 100–850 V, default 600 V. SolisCloud shows a separate "Constant Voltage Mode" switch at 43249; the gospel has no such bit in that register, so only the setpoint is offered here.',
    kind: 'value',
    section: SECTION_DC,
  },
  {
    address: VFB_ADJ_SCALE,
    label: 'VFB-Adj-Scale',
    description:
      'Grid feed-forward tuning parameter. Range 50–90, default 80. A factory tuning value — changing it without a reason from Solis is how a stable machine starts oscillating.',
    kind: 'value',
    section: SECTION_DC,
  },

  /* ---------------------------------------------------------- commands -- */
  {
    address: CLEAR_YIELD,
    label: 'Clear yield data',
    description:
      'Wipes the stored generation history. The register clears itself back to 0 once it is done.',
    kind: 'command',
    commandValue: 1,
    confirm:
      'Clear all stored yield and energy history on this inverter?\n\nThe generation record is deleted on the machine. It cannot be recovered from here.',
    section: SECTION_COMMANDS,
  },
  {
    address: RESTART_HMI,
    label: 'Restart HMI',
    description:
      'Reboots the display. A magic word, not an on/off — only 0xAA55 does anything. The documents say to do this after a factory reset.',
    kind: 'command',
    confirm:
      'Restart the display (HMI) now?\n\nThe screen reboots. The inverter keeps running and no settings are changed.',
    section: SECTION_COMMANDS,
  },
  {
    address: FACTORY_RESET,
    label: 'Factory reset',
    description:
      'Restores every setting to its factory default. Restart the HMI afterwards. There is no undo and nothing here keeps a copy.',
    kind: 'command',
    commandValue: 1,
    confirm:
      'Restore FACTORY SETTINGS on this inverter?\n\nEvery setting on the machine goes back to its default — work mode, battery setup, grid code, export limits, protections. There is no undo, and this tool does not keep a copy.\n\nRead and save the settings you need before continuing.',
    section: SECTION_COMMANDS,
  },
]

/* --------------------------------------------------------------- lookups -- */

/**
 * The value a command row writes.
 *
 * Prefers the gospel rule's `unlock_value`, so the magic word for Restart HMI
 * (0xAA55) is read from the rules file rather than typed here as well. Falls
 * back to the row's own `commandValue` for the plain "write 1" commands, which
 * have no unlock value because they are not unlock gates.
 *
 * Returns null when neither exists — the screen disables the row rather than
 * inventing a value to write into a destructive register.
 */
export function commandValueOf(row: DeviceRow): number | null {
  const unlock = (ruleFor(row.address) as any)?.unlock_value
  if (typeof unlock === 'number') return unlock
  return row.commandValue ?? null
}

/**
 * The bit a labelled row sits on, from the rules file first and the map's
 * `bit_flags` second.
 *
 * Two sources because the two bit words on this screen are described in
 * different places. 43073 has a rules entry naming BIT13; 43302 has none, and
 * its bit names live only in the map's `bit_flags` array. Reading both means
 * neither row has to carry a bit NUMBER — a renumbering in either source moves
 * the row with it.
 *
 * Returns null when the label has gone. Null, never a fallback number: these
 * words hold EPM switches and grid-connection types, and flipping a guessed
 * bit in one of them is not a cosmetic mistake.
 */
export function bitOf(address: number, label: string): number | null {
  const want = label.trim().toLowerCase()

  const rule: any = ruleFor(address)
  for (const [bit, name] of Object.entries(rule?.independent_bit_labels ?? {})) {
    if (String(name).trim().toLowerCase() === want) return Number(bit)
  }
  for (const g of rule?.bit_groups ?? []) {
    for (const [bit, name] of Object.entries(g.bit_labels ?? {})) {
      if (String(name).trim().toLowerCase() === want) return Number(bit)
    }
  }

  const flags = byAddress.get(address)?.bit_flags ?? []
  const i = flags.findIndex(
    (f) => String(f).trim().toLowerCase() === want,
  )
  return i >= 0 ? i : null
}

/**
 * The mask a bit row's write may claim: that one bit, and nothing else.
 *
 * Narrower than the rule's full mask on purpose, for the same reason Protect
 * Setting narrows its own. `mergeForWrite` only protects bits OUTSIDE the
 * mask, so claiming every bit the rule names would let this screen write stale
 * values over the EPM and FailSafe switches — which live in 43073 alongside
 * the one bit this screen actually shows, and which no row here can even
 * display.
 */
export function maskForBit(bit: number): number {
  return (1 << bit) & 0xffff
}

/**
 * The sub-field a packed row edits, looked up by name.
 *
 * Null when the table no longer carries it — the screen disables the row
 * rather than guessing a byte, for the same reason a missing bit label
 * disables a bit row.
 */
export function packedFieldOf(row: DeviceRow): PackedField | null {
  if (!row.packedField) return null
  const fields = PACKED_FIELDS[row.address] ?? []
  return fields.find((f) => f.name === row.packedField) ?? null
}

/** Is this register flagged irreversible by the rules file? */
export function isDestructive(address: number): boolean {
  const rule: any = ruleFor(address)
  return rule?.destructive === true || rule?.kind === 'destructive'
}

/** Rows of one category, in screen order. */
export function rowsOfSection(section: string): DeviceRow[] {
  return DEVICE_ROWS.filter((r) => r.section === section)
}

/** Every register this screen reads, for the range-button highlight. */
export function deviceAddresses(): number[] {
  return Array.from(new Set(DEVICE_ROWS.map((r) => r.address))).sort(
    (a, b) => a - b,
  )
}

/** Gospel entry for a row, or undefined when the map lost it. */
export function regOf(address: number) {
  return byAddress.get(address)
}

/**
 * The slot a row stages its edit into.
 *
 * Keyed by address for value rows. Bit rows key by address too — two bit rows
 * in the same word must share one staged word, or the second would stage
 * against a copy that does not carry the first one's change. Nothing on this
 * screen currently puts two bit rows in one register, but 43302 and 43073 both
 * have spare bits and the next row added to either would hit it.
 */
export function slotOf(row: DeviceRow): string {
  return String(row.address)
}
