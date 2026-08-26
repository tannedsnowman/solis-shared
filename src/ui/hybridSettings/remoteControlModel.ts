/**
 * The three remote-control interfaces a hybrid inverter offers, and the
 * registers behind each of them.
 *
 * WHY THIS SCREEN IS SEPARATE FROM THE OTHER SETTINGS
 * --------------------------------------------------
 * Everything else in the settings rail configures the inverter and then leaves
 * it to run. These registers do the opposite: they take the machine off its
 * own control loop and drive it from outside, and — uniquely on this device —
 * they TIME OUT. Stop writing and the inverter reverts to local operation on
 * its own, in minutes.
 *
 * That makes them a different kind of thing from "set the battery type once at
 * commissioning", which is why they get their own section rather than being
 * mixed into Control Panel. A row you must keep re-sending to hold does not
 * belong next to a row you set and forget.
 *
 * THREE GENERATIONS, NOT THREE FEATURES
 * -------------------------------------
 * The inverter carries three overlapping remote-control interfaces, added at
 * different times and never retired:
 *
 *   1. REMOTE CONTROL, 43128-43136. The original. 16-bit, x10 W, and split
 *      into a battery half and a grid half that mutually cancel — enabling one
 *      resets the other's mode register to 0. The gospel says so in the
 *      description of both 43132 and 43135.
 *
 *   2. REMOTE DISPATCH, 44100-44107. The replacement. Adds a failsafe timeout
 *      you can set, system import/export caps, and one signed 32-bit setpoint
 *      instead of the old 16-bit pair.
 *
 *   3. POWER CONTROL, 44280-44287. The newest, at the very top of the map, and
 *      the only one that can command REACTIVE power. Three independent signed
 *      32-bit values at 1 W / 1 Var per step — no x10 scaling — each gated by
 *      its own port-selection word.
 *
 * They are listed oldest-first because that is the order of fallback: an
 * installer on old firmware has only the first, and the question this screen
 * has to answer is "which of these does the machine in front of me support".
 *
 * WHAT IS DELIBERATELY NOT COPIED FROM THE SolisConnect APP
 * ---------------------------------------------------------
 * The Tauri app renders 44102 as a four-value dropdown (0-3). The rules file
 * calls it a bitfield with `write: read_modify_write` and two independent bits
 * — BIT00 arms the import cap, BIT01 the export cap. A bare 0-3 write clears
 * whichever switch you did not name and nothing in the reply reports it. Here
 * it is two toggles over one masked word, which is what the rule describes.
 *
 * The app's 44105 dropdown also stops at 4. The gospel's own description for
 * that register lists 5 (self-consumption) and 6 (grid feed-in priority), so
 * both are offered here.
 */

/* ------------------------------------------------ 1. remote control, 43128+ */

/** Active power for the AC-grid-port flavour of grid control. s16, x10 W. */
export const RC_AC_PORT_POWER = 43128
/** Force-discharge power. u16, x10 W. */
export const RC_DISCHARGE_POWER = 43129
export const RC_CHARGE_LIMIT = 43130
export const RC_DISCHARGE_LIMIT = 43131
/** Grid adjustment mode. Enabling this resets 43135 to 0. */
export const RC_GRID_ADJUSTMENT = 43132
/** Active power at the system grid connection point. s16, x10 W. */
export const RC_SYS_POINT_ACTIVE = 43133
/** Reactive power at the system grid connection point. s16, x10 Var. */
export const RC_SYS_POINT_REACTIVE = 43134
/** Force charge/discharge mode. Enabling this resets 43132 to 0. */
export const RC_BATTERY_MODE = 43135
/** Force-charge power. u16, x10 W. */
export const RC_CHARGE_POWER = 43136

/* ----------------------------------------------- 2. remote dispatch, 44100+ */

export const RD_SWITCH = 44100
export const RD_FAILSAFE = 44101
/** Bitfield: BIT00 import cap, BIT01 export cap. read_modify_write. */
export const RD_LIMIT_SWITCH = 44102
export const RD_IMPORT_LIMIT = 44103
export const RD_EXPORT_LIMIT = 44104
export const RD_RT_MODE = 44105
/** s32 across 44106/44107, x10 W. The hook handles the pairing. */
export const RD_RT_POWER = 44106

/* ------------------------------------------------- 3. power control, 44280+ */

/** Packs two nibbles: BIT00-03 active port, BIT04-07 PV shutdown. */
export const PC_ACTIVE_PORT = 44280
export const PC_REACTIVE_PORT = 44281
/** s32, 1 W per step. Needs active port = 4. */
export const PC_BATTERY_POWER = 44282
/** s32, 1 W per step. Needs active port = 2. */
export const PC_AC_POWER = 44284
/** s32, 1 Var per step. Needs reactive port = 2. */
export const PC_REACTIVE_POWER = 44286

/** Which of the three interfaces a row belongs to. */
export type RemoteSection = 'control' | 'dispatch' | 'power'

/** One plain whole-register row. */
export interface RemoteRow {
  address: number
  label: string
  description: string
  section: RemoteSection
  /**
   * Enum labels for a register whose gospel entry carries no `value_map`.
   *
   * Transcribed from that register's own `description`, never invented. A real
   * `value_map` wins over this in `editorFor`, so an override retires itself
   * the day the map gains one.
   */
  overrideOptions?: Array<{ value: number; label: string }>
  /** Long-form prose, opened from the `?` beside the register. */
  help?: string
}

/**
 * 43132 and 43135 cancel each other, and the gospel says so on both.
 *
 * Worth a modal rather than a tooltip: it is the single most surprising thing
 * about the old interface, and an installer who does not know it will set
 * battery mode, then set grid mode, and be left wondering why the battery
 * command stopped.
 */
const MUTUAL_RESET_HELP = `The old remote control interface has two halves that cannot both run.

Battery control lives at 43135 (with its powers at 43129 and 43136). Grid control lives at 43132 (with its powers at 43128, 43133 and 43134).

Turning one on turns the other OFF. The inverter does this itself: the register description for 43132 says that after it receives an enable command, 43135 is restored to 0 — and the description for 43135 says the same about 43132. Nothing in the write reply tells you it happened.

So pick the half you want and set that one. If a battery command seems to stop working, check whether something enabled grid control after it.

Both halves also revert to 0 on their own if no fresh command arrives inside the timeout at 43282 (default 5 minutes). That is a safety feature, not a fault: it means a controller that dies cannot leave the inverter stuck under remote command.`

/** The port words at 44280/44281 are the gate on everything below them. */
const PORT_GATE_HELP = `The three power values below do nothing until a port is opened for them.

44280 selects the port for ACTIVE power, and it packs two separate things into one word:
  • BIT00-03 — which port: 0 disabled, 2 the AC grid port, 4 the battery port
  • BIT04-07 — PV shutdown: 1 shuts the PV input down

Active power goes to the AC grid port OR the battery port, one or the other, never both. PV shutdown is a separate nibble, so it can be set at the same time as either.

44281 selects the port for REACTIVE power: 0 disabled, 2 the AC reactive grid port.

Both port words reset themselves to 0 if no valid command arrives inside the timeout at 43282 (default 5 minutes). Re-send them to hold remote control open.

These are the only registers on the inverter that can command reactive power as a signed 32-bit value at 1 Var per step. The older interfaces top out at a 16-bit x10 Var figure at the system grid point.`

/**
 * Every plain row on the screen, in the order it is drawn.
 *
 * The bit rows of 44102 and the two packed nibbles of 44280 are NOT here —
 * they are drawn from `LIMIT_BITS` and the port model below, because a row
 * that owns part of a word needs a mask and a bit number that this shape has
 * no field for.
 */
export const REMOTE_ROWS: RemoteRow[] = [
  /* ---- 1. remote control, the original 16-bit interface ---- */
  {
    address: RC_BATTERY_MODE,
    label: 'Battery force charge / discharge',
    description:
      'Drives the battery directly: off, force charge, or force discharge. Turning this on sets grid adjustment (43132) back to 0 — the two halves of this interface cannot both run.',
    section: 'control',
    help: MUTUAL_RESET_HELP,
  },
  {
    address: RC_CHARGE_POWER,
    label: 'Force-charge power',
    description:
      'How hard to charge while the row above says Charge. Only read while battery mode is Charge.',
    section: 'control',
  },
  {
    address: RC_DISCHARGE_POWER,
    label: 'Force-discharge power',
    description:
      'How hard to discharge while the mode above says Discharge. Only read while battery mode is Discharge.',
    section: 'control',
  },
  {
    address: RC_CHARGE_LIMIT,
    label: 'Charge power limit',
    description:
      'Ceiling on charging while under this interface, whatever the commanded power asks for.',
    section: 'control',
  },
  {
    address: RC_DISCHARGE_LIMIT,
    label: 'Discharge power limit',
    description:
      'Ceiling on discharging while under this interface, whatever the commanded power asks for.',
    section: 'control',
  },
  {
    address: RC_GRID_ADJUSTMENT,
    label: 'Grid adjustment',
    description:
      'Commands power at the grid instead of at the battery. Off, at the system grid connection point, or at the inverter AC grid port. Turning this on sets battery mode (43135) back to 0.',
    section: 'control',
    help: MUTUAL_RESET_HELP,
  },
  {
    address: RC_SYS_POINT_ACTIVE,
    label: 'Active power — system grid point',
    description:
      'The setpoint used when grid adjustment is set to the system grid connection point. Positive exports to the grid, negative imports from it.',
    section: 'control',
  },
  {
    address: RC_SYS_POINT_REACTIVE,
    label: 'Reactive power — system grid point',
    description:
      'Reactive setpoint at the system grid connection point. Used with the row above, not with the AC grid port mode.',
    section: 'control',
  },
  {
    address: RC_AC_PORT_POWER,
    label: 'Active power — inverter AC grid port',
    description:
      'The setpoint used instead when grid adjustment is set to the inverter AC grid port. A different register from the system-grid-point row above; the mode decides which one the inverter reads.',
    section: 'control',
  },

  /* ---- 2. remote dispatch, the 44100 block ---- */
  {
    address: RD_SWITCH,
    label: 'Remote dispatch',
    description:
      'The master switch for this whole interface. Nothing else in this section does anything until this is enabled.',
    section: 'dispatch',
  },
  {
    address: RD_FAILSAFE,
    label: 'Failsafe timeout',
    description:
      'How long the inverter waits for a fresh command before giving up and returning to local operation. 1 to 1440 minutes, default 5. Write to the real-time control registers at least this often to hold dispatch open.',
    section: 'dispatch',
  },
  {
    address: RD_IMPORT_LIMIT,
    label: 'System import limit',
    description:
      'Cap on active power drawn from the grid, for the whole system. Only in force while the import switch above is on. Writing 0xFFFF (65535) restores the default.',
    section: 'dispatch',
  },
  {
    address: RD_EXPORT_LIMIT,
    label: 'System export limit',
    description:
      'Cap on active power fed into the grid, for the whole system. Only in force while the export switch above is on. Writing 0xFFFF (65535) restores the default.',
    section: 'dispatch',
  },
  {
    address: RD_RT_MODE,
    label: 'Real-time control mode',
    description:
      'What the setpoint below means. The gospel lists six modes for this register — two more than the SolisConnect app offers.',
    section: 'dispatch',
    // 44105 description: "1 - Battery Standby Control ... 6 - Grid Feed-in Priority Control"
    overrideOptions: [
      { value: 1, label: '1 — Battery standby (no charge, no discharge)' },
      { value: 2, label: '2 — Battery charge / discharge' },
      { value: 3, label: '3 — Grid connection point import / export' },
      { value: 4, label: '4 — AC grid port import / export' },
      { value: 5, label: '5 — Self-consumption' },
      { value: 6, label: '6 — Grid feed-in priority' },
    ],
  },
  {
    address: RD_RT_POWER,
    label: 'Real-time setpoint',
    description:
      'The commanded power, meaning set by the mode above. Signed 32-bit across 44106 and 44107 — the write goes out as function 16, not function 6. Not used in standby mode.',
    section: 'dispatch',
  },

  /* ---- 3. power control, the 44280 block ---- */
  {
    address: PC_BATTERY_POWER,
    label: 'Battery power',
    description:
      'Positive charges the battery, negative discharges it. 1 W per step, signed 32-bit. Needs the active port set to Battery.',
    section: 'power',
    help: PORT_GATE_HELP,
  },
  {
    address: PC_AC_POWER,
    label: 'AC power',
    description:
      'Positive exports to the grid, negative imports from it. 1 W per step, signed 32-bit. Needs the active port set to AC grid port.',
    section: 'power',
    help: PORT_GATE_HELP,
  },
  {
    address: PC_REACTIVE_POWER,
    label: 'Reactive power',
    description:
      'Positive is inductive (lagging, absorbed by the load); negative is capacitive (leading, supplied to the load). 1 Var per step, signed 32-bit. Needs the reactive port enabled.',
    section: 'power',
    help: PORT_GATE_HELP,
  },
]

/**
 * The two independent switches inside 44102.
 *
 * Drawn as toggles rather than as one 0-3 dropdown because the rules file says
 * `read_modify_write` over `independent_bits: [0, 1]`. Writing a bare 0-3
 * clears whichever switch was not named, silently. The SolisConnect app has
 * exactly that bug; this screen does not reproduce it.
 */
export const LIMIT_BITS: Array<{
  bit: number
  label: string
  description: string
}> = [
  {
    bit: 0,
    label: 'Import limit switch',
    description:
      'Arms the system power-draw (import) cap, whose value lives at 44103. Independent of the export switch — either, both, or neither.',
  },
  {
    bit: 1,
    label: 'Export limit switch',
    description:
      'Arms the system feed-in (export) cap, whose value lives at 44104. Independent of the import switch — either, both, or neither.',
  },
]

/**
 * The bits of 44102 this screen actually draws.
 *
 * Bounded to BIT00 and BIT01 — the two the rules file names. A bit a later
 * firmware adds to this word is not ours to move, and masking to what we draw
 * is what leaves it alone.
 */
export const LIMIT_OWNED_MASK = LIMIT_BITS.reduce(
  (mask, b) => mask | (1 << b.bit),
  0,
)

/**
 * The bits the user MOVED, not every bit we could claim.
 *
 * Claiming the whole owned mask would let a stale page revert the switch
 * nobody touched: the pre-write re-read would faithfully merge in a value the
 * screen only believes because it read it a minute ago. Returns 0 when nothing
 * is staged, which writes the word back unchanged rather than asserting
 * anything about it.
 */
export function changedMask(read: number, staged: number | undefined): number {
  if (staged === undefined) return 0
  return (read ^ staged) & 0xffff
}

/** Set or clear one bit of a word. */
export const withBit = (word: number, bit: number, on: boolean): number =>
  on ? word | (1 << bit) : word & ~(1 << bit) & 0xffff

/** Active-port choices, the low nibble of 44280. */
export const ACTIVE_PORT_OPTIONS = [
  { value: 0, label: '0 — Disabled' },
  { value: 2, label: '2 — AC grid port' },
  { value: 4, label: '4 — Battery port' },
]

/** Reactive-port choices, the low nibble of 44281. */
export const REACTIVE_PORT_OPTIONS = [
  { value: 0, label: '0 — Disabled' },
  { value: 2, label: '2 — AC reactive grid port' },
]

/** The active port a word selects — its low nibble. */
export const portOf = (word: number): number => word & 0x0f

/** Whether 44280 is asking for PV shutdown — its second nibble. */
export const pvShutdownOf = (word: number): boolean =>
  ((word >> 4) & 0x0f) === 1

/** Rebuild 44280 from its two nibbles, leaving the high byte alone. */
export const portWord = (
  word: number,
  port: number,
  pvShutdown: boolean,
): number => (word & 0xff00) | ((pvShutdown ? 1 : 0) << 4) | (port & 0x0f)

/** Every register this screen reads, for the range-button highlight. */
export function remoteControlAddresses(): number[] {
  const out = new Set<number>([
    ...REMOTE_ROWS.map((r) => r.address),
    RD_LIMIT_SWITCH,
    PC_ACTIVE_PORT,
    PC_REACTIVE_PORT,
  ])
  /* The three 32-bit values occupy their second word too. The range buttons
     shade whole blocks, so a setpoint whose high word sits in the next block
     must claim both or that block reads as unwanted. */
  for (const wide of [RD_RT_POWER, PC_BATTERY_POWER, PC_AC_POWER, PC_REACTIVE_POWER]) {
    out.add(wide + 1)
  }
  return Array.from(out).sort((a, b) => a - b)
}

/**
 * The edit slot a row stages into.
 *
 * Plain rows key on the address alone. The bit rows of 44102 and the two
 * nibbles of 44280 share a word, so they stage into one slot per WORD and the
 * screen merges them — the same rule Control Panel and Protect Setting follow.
 */
export function slotOf(row: RemoteRow): string {
  return String(row.address)
}
