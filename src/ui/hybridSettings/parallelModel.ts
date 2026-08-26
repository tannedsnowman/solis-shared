/**
 * The register list behind the Parallel screen.
 *
 * SolisCloud's own "Parallel setting" page shows three rows — 43391, 43382 and
 * 43006. Those three come first here, in that order, because that is the page
 * an installer is looking at when they come to this tool for a second opinion.
 *
 * The rest of the parallel block follows. Leaving it out would mean the only
 * way to reach the wiring and sizing registers is the raw table, and those are
 * exactly the ones that have to be right before a bank will come up at all.
 *
 * NOTHING HERE IS A BIT WORD
 * --------------------------
 * Every row is a whole register — an enum or a plain number. That is why this
 * screen has no `applyBitChange`, no `ownedMask` and no shared staging slot:
 * unlike Control Panel and Storage Mode, no two rows share a word, so each one
 * stages and saves on its own.
 *
 * OVERRIDES, AND WHY THEY ARE HERE AND NOT INVENTED
 * ------------------------------------------------
 * Four registers spell their enum out in the gospel's `description` but carry
 * no `value_map`. Each override below is a transcription of that prose, and is
 * marked with the register it came from. `editorFor` prefers a real
 * `value_map` over an override, so each of these disappears on its own the day
 * the map gains one — no edit needed here.
 *
 * 43382's polarity is settled and needs no warning: 0=Slave, 1=Master,
 * confirmed against the SolisConnect Tauri app, which writes 1 to make a unit
 * master. The app outranks the documents under the standing precedence.
 *
 * 43389 is a DIFFERENT register whose documented labels read the opposite way
 * round (0=Host, 1=Slave). Nothing proves the two must share a polarity, so
 * its gospel labels stand and the row says where they came from.
 */

/** Standalone or parallel. The switch the whole page hangs off. */
export const STANDALONE_PARALLEL = 43391
/** Manual master/slave. 0=Slave, 1=Master — app-confirmed. */
export const MANUAL_MASTER_SLAVE = 43382
/** Modbus slave address of this inverter. SolisCloud calls this row "ID". */
export const SLAVE_ADDRESS = 43006

export const SINGLE_FUNCTION = 43378
export const PHYSICAL_ADDRESS_ID = 43380
export const MASTER_CREATE_METHOD = 43381
export const COMMS_MASTER_SLAVE = 43389

export const CONNECTED_PHASE = 43384
export const BATTERY_CONNECTED_MODE = 43385
export const CRITICAL_LOAD_ON_PHASE = 43383

export const SYNC_REQUEST = 43386
export const SYNC_LOCK = 43390

export const INVERTERS_CONNECTED = 43388
export const RATED_BATTERY_CAPACITY = 43387

export const FORCE_CHARGE_POWER_LIMIT = 43392
export const GENERATOR_CHARGE_POWER = 43393
/*
 * MOVED TO THE STORAGE MODE SCREEN.
 *
 * 43394 is the Battery Reserve function's own grid-charge ceiling -- the map
 * calls it "Grid charge power limit for battery reserve function" -- and the
 * switch that arms it (43110 BIT04) and its SOC target (43024) are both on
 * Storage mode. Sitting here it read as a parallel setting, which it is not:
 * the parallel system only changes its LOWER limit.
 *
 * Kept exported because the address is still referenced by name.
 */
export const RESERVE_GRID_CHARGE_LIMIT = 43394

/** One row on the screen. */
export interface ParallelRow {
  address: number
  label: string
  description: string
  /**
   * Enum labels for a register whose gospel entry has no `value_map`.
   *
   * Transcribed from that register's own `description`, never guessed. A real
   * `value_map` wins over this in `editorFor`, so an override is self-retiring.
   */
  overrideOptions?: Array<{ value: number; label: string }>
}

/**
 * The screen, in the order an installer works.
 *
 * Standalone/parallel first: it decides whether anything below it means
 * anything. Then who is master, then this unit's address — the three rows
 * SolisCloud shows. Wiring and system size next, because those are set once at
 * commissioning. Synchronisation and the power limits last: they are the
 * running adjustments, made after the bank is already up.
 */
export const PARALLEL_ROWS: ParallelRow[] = [
  {
    address: STANDALONE_PARALLEL,
    label: 'Standalone / parallel',
    description:
      'Whether this inverter runs on its own or as part of a parallel bank. 0 is standalone, 1 is parallel; default 0. Nothing else on this screen does anything until this says parallel.',
    // 43391 description: "0 – Standalone, 1 – Parallel; default 0."
    overrideOptions: [
      { value: 0, label: 'Standalone' },
      { value: 1, label: 'Parallel' },
    ],
  },
  {
    address: MANUAL_MASTER_SLAVE,
    label: 'Master / slave',
    description:
      'Which unit leads the bank. 0 is slave, 1 is master — confirmed against the SolisConnect app, which writes 1 to make a unit master. Only obeyed while Master create method is set to Manual.',
  },
  {
    address: SLAVE_ADDRESS,
    label: 'Inverter ID (Modbus slave address)',
    description:
      'This inverter’s Modbus address. Give every unit in the bank a different one, numbered in sequence. Changing it changes the address this tool must talk to, so the next read will need the new slave ID.',
  },
  {
    address: MASTER_CREATE_METHOD,
    label: 'Master create method',
    description:
      'How the bank decides who leads. Automatic competition lets the units settle it between themselves; Manual set makes the Master / slave row above the answer. Default 1 (manual).',
    // 43381 description: "0：Automatic competition；1：Manual Set"
    overrideOptions: [
      { value: 0, label: 'Automatic competition' },
      { value: 1, label: 'Manual set' },
    ],
  },
  {
    address: PHYSICAL_ADDRESS_ID,
    label: 'Physical address ID',
    description:
      'Position of this unit in the bank, 1 to 10. 0 means not set. Separate from the Modbus slave address above.',
  },
  {
    address: COMMS_MASTER_SLAVE,
    label: 'Communication master / slave',
    description:
      'Which unit carries the datalogger and the meter. Documented the opposite way round from the row above: here 0 is host and 1 is slave. The labels are the gospel’s own, left as documented because nothing proves the two registers share a polarity.',
  },
  {
    address: CONNECTED_PHASE,
    label: 'Inverter connected phase',
    description:
      'Which phase this unit is wired to, or single-phase / split-phase. Must match the actual wiring — the bank balances against this.',
  },
  {
    address: BATTERY_CONNECTED_MODE,
    label: 'Battery connection mode',
    description:
      'Whether the units share one battery bank or each has its own. Parallel balances off the inverters’ rated power off-grid; Individual balances off each battery.',
  },
  {
    address: CRITICAL_LOAD_ON_PHASE,
    label: 'Critical load on this phase',
    description:
      'Size of the backed-up load on this unit’s phase, in kVA. Range 0 to 50.0 kVA, default 4.0.',
  },
  {
    address: INVERTERS_CONNECTED,
    label: 'Inverters connected',
    description:
      'How many units are in the bank, 2 to 10. Default 2. Parallel systems only.',
  },
  {
    address: RATED_BATTERY_CAPACITY,
    label: 'Rated battery capacity',
    description:
      'Total rated capacity of the batteries on the bank, in kWh. Range 0 to 50.0 kWh, default 3.0.',
  },
  {
    address: SYNC_REQUEST,
    label: 'Parameter synchronisation request',
    description:
      'Asks the bank to push the master’s settings out to the slaves. The datalogger reads this at a fixed interval; set it to 1 to request a sync.',
  },
  {
    address: SYNC_LOCK,
    label: 'Synchronisation lock',
    description:
      'Locks a slave so the master stops overwriting its settings. 0 unlocked, 1 locked; default 0.',
    // 43390 description: "0- Unlocked, 1- Locked; Default 0"
    overrideOptions: [
      { value: 0, label: 'Unlocked' },
      { value: 1, label: 'Locked' },
    ],
  },
  {
    address: FORCE_CHARGE_POWER_LIMIT,
    label: 'Force-charge power limit',
    description:
      'Ceiling on force-charging the battery across the bank, in watts. From 1000 W up to the bank’s total rated power — the unit’s rating times the number of units.',
  },
  {
    address: GENERATOR_CHARGE_POWER,
    label: 'Generator charging power',
    description:
      'How much generator output may charge the battery across the bank, in kW. 0 up to the bank’s total rated power.',
  },
]

/** Every register this screen reads, for the range-button highlight. */
export function parallelAddresses(): number[] {
  return Array.from(new Set(PARALLEL_ROWS.map((r) => r.address))).sort(
    (a, b) => a - b,
  )
}

/**
 * The edit slot a row stages into.
 *
 * The address is enough here, unlike Control Panel: no two rows on this screen
 * share a register, so there is nothing for a compound key to separate.
 */
export function slotOf(row: ParallelRow): string {
  return String(row.address)
}
