/**
 * Storage Mode — everything SolisCloud's Storage Mode page has, on one screen.
 *
 * ONE COLUMN, FLAT LIST
 * ---------------------
 * Drawn on `GroupView`'s kit (`GroupFrame` / `GroupStatus` / `GroupPane` /
 * `SettingRowOne`), which replaced the two-column card grid built earlier the
 * same day. That grid was `1fr 1fr` inside an `overflowY: auto` box; grid rows
 * stretch to the tallest cell, so uneven cards computed a height that fought
 * the scroller, and the labels clipped mid-word. Going one column fixes both
 * and buys every row a full-width description line — which is where the range
 * note and the bit explanation live. There are deliberately NO sub-headings
 * inside the group: a flat list, as the mockup shows.
 *
 * SAVE IS PER ROW AND FIRES NOW
 * -----------------------------
 * There is no screen-wide WRITE ALL any more. Each row stages its own edit and
 * writes it on its own Save, which turns green on ok and red on failure. A
 * batch button hid which of a dozen registers actually refused the value.
 *
 * NO WRITE BEFORE A READ
 * ----------------------
 * Every row passes `hasBeenRead` from its OWN register, so a partial read locks
 * only the rows it missed. This is a safety rule, not a nicety: 43110 and 43483
 * are `read_modify_write`, so with no current word a write would guess the
 * fifteen bits it does not own and silently clear whatever the installer set —
 * battery wake-up, grid charge, the work mode.
 *
 * The register maths — which bit, which direction, what a mode change clears —
 * lives in `storageModeModel.ts` and is proven in its test. This file draws it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { HybridWriter } from '../settings/hybridWrite'
import { currentText, rawOf } from '../settings/GospelRows'
import {
  displayToRaw,
  rawToDisplay,
} from '../../settings/editorFor'
import { addressesOf } from '../settings/panelAddresses'
import {
  GroupStatus,
  GroupPane,
  RowOption,
  SaveResult,
  SettingRowOne,
} from '../settings/GroupView'
import { ruleFor } from '../settings/GospelRows'
import { byAddress } from '../../gospel/gospel'
import { C } from '../settings/theme'
import {
  ALLOW_EXPORT_BIT,
  BATTERY_RESERVE_SOC,
  GRID_IMPORT_POWER,
  NUMBER_ROWS,
  PEAK_SOC,
  UNBALANCE_CONTROL,
  EXPORT_CAL_U16,
  EXPORT_CAL_U32,
  EXPORT_CONTROL,
  GRID_IMPORT_LIMIT_BIT,
  GRID_IMPORT_POWER_HINT,
  MAX_EXPORT_U16,
  MAX_EXPORT_U32,
  PEAK_SHAVING_HELP,
  STORAGE_CONTROL,
  activeMode,
  allowExportFromWord,
  conflictsOfMode,
  gridImportLimitFromWord,
  modeOptions,
  ownedMaskOf,
  wordForAllowExport,
  wordForGridImportLimit,
  wordForMode,
} from './storageModeModel'

export { MAX_EXPORT_U16, MAX_EXPORT_U32 }

interface StorageModeProps {
  variables: any
  id: string
  /**
   * Where writes go.
   *
   * REQUIRED HERE, unlike in the extension's own copy. A shared card has no
   * app to fall back to: the extension hands in `useRegisterWrite`, its
   * transport, and SolisConnect hands in its own over the Tauri serial
   * bridge. This file must not know which it got.
   */
  writer: HybridWriter
}

const hex = (n: number) =>
  `0x${(n & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`

/**
 * Unbalance output — 43073 BIT06, NOT the whole of 43073.
 *
 * The register is a bit word: BIT04 EPM switch, BIT05 FailSafe, BIT06 power
 * control mode, BIT08/09 external EPM, BIT13 meter-vs-CT. The earlier build
 * drew it as a plain number input, which would have written a bare 0 or 1 and
 * cleared the EPM and FailSafe bits in one go — the exact failure the gospel's
 * revision note on this register warns about. It is a toggle on BIT06 here,
 * masked like every other bit row.
 */
const UNBALANCE_BIT_LABEL = 'Power Control Mode (1=3ph Individual)'

/**
 * The numeric registers this screen writes, in the order they are drawn.
 *
 * Each carries the description line the one-column layout exists to show. The
 * label and units still come from the gospel; only the prose is here, because
 * the map has no field for "what does changing this actually do".
 */


/**
 * Registers this page reads, for the range-button row's highlight.
 * Derived from the rows it renders plus the two bit words it drives by hand,
 * so it cannot drift out of step. See `panelAddresses.ts`.
 */
export const ADDRESSES = addressesOf(
  [
    [
      {
        title: 'storage mode',
        rows: Object.values(NUMBER_ROWS).map((r) => ({ address: r.address })),
      },
    ],
  ],
  [STORAGE_CONTROL, EXPORT_CONTROL, UNBALANCE_CONTROL],
)

/**
 * Registers whose width the map still gets wrong.
 *
 * 44225 is s32 in both v3.4 and v3.5, but the built map carries `kind: u16`
 * from the app import, under a note admitting the review was never done. Until
 * that is corrected the width has to be forced here, or the high word is left
 * holding whatever was there before and the inverter ACKs it anyway.
 *
 * 44227 needs no entry — its `kind` is already u32, so `useRegisterWrite`
 * derives function 16 from the gospel by itself.
 */
const WIDTH_OVERRIDES: Record<number, 32> = {
  [EXPORT_CAL_U32]: 32,
}

/** Age of a reading in ms, or undefined when it was never read. */
function ageOf(variables: any, key: string | undefined, now: number) {
  const stamp = key ? variables?.[key]?.lastUpdated : undefined
  if (!stamp) return undefined
  const t = new Date(stamp).getTime()
  return Number.isFinite(t) ? Math.max(0, now - t) : undefined
}

const StorageMode: React.FC<StorageModeProps> = ({ variables, id, writer }) => {
  const { write, busy, lastError } = writer
  const now = Date.now()

  const controlReg = byAddress.get(STORAGE_CONTROL)
  const exportReg = byAddress.get(EXPORT_CONTROL)
  const readControl = rawOf(variables, controlReg?.key ?? '')
  const readExport = rawOf(variables, exportReg?.key ?? '')

  /*
   * "Has a read landed" is per REGISTER, not per screen. A partial read must
   * lock only the rows it missed: a 43483 row unlocked by a 43110 reading
   * would read-modify-write against a word it never saw.
   */
  const controlRead = readControl !== undefined
  const exportRead = readExport !== undefined

  const unbalanceReg = byAddress.get(UNBALANCE_CONTROL)
  const readUnbalance = rawOf(variables, unbalanceReg?.key ?? '')
  const unbalanceRead = readUnbalance !== undefined

  /*
   * The two bit words are staged as WHOLE WORDS rather than as a set of bit
   * edits: the rules file's exclusivity is expressed as a word transform
   * (`applyBitChange`), so holding a word is the representation that already
   * matches. `undefined` means "no staged change", which is what keeps an
   * unread register from being written as 0.
   */
  const [stagedControl, setStagedControl] = useState<number | undefined>()
  const [stagedExport, setStagedExport] = useState<number | undefined>()
  const [stagedUnbalance, setStagedUnbalance] = useState<number | undefined>()
  /** Staged numeric edits, keyed by address, holding RAW register values. */
  const [numberEdits, setNumberEdits] = useState<Record<number, number>>({})

  // A fresh reading drops staged edits: what is on screen must be what the
  // device just said, not an edit typed against the previous word.
  useEffect(() => {
    setStagedControl(undefined)
    setStagedExport(undefined)
    setStagedUnbalance(undefined)
    setNumberEdits({})
  }, [variables])

  const controlWord = stagedControl ?? readControl
  const exportWord = stagedExport ?? readExport

  const modes = useMemo(() => modeOptions(), [])
  const selected = controlWord === undefined ? null : activeMode(controlWord)

  const controlRule = ruleFor(STORAGE_CONTROL)
  const bitLabel = (b: number) =>
    controlRule?.independent_bit_labels?.[String(b)] ?? `BIT${b}`

  const namedBit = useCallback(
    (label: string) =>
      Number(
        Object.entries(controlRule?.independent_bit_labels ?? {}).find(
          ([, l]) => l === label,
        )?.[0] ?? -1,
      ),
    [controlRule],
  )
  const gridChargeBit = useMemo(() => namedBit('Grid Charge'), [namedBit])

  /** Reserve Battery is in a mutually_exclusive group, not an independent bit. */
  const reserveBit = useMemo(() => {
    const g = (controlRule?.bit_groups ?? []).find(
      (x) => x.rule === 'mutually_exclusive',
    )
    const entry = Object.entries(g?.bit_labels ?? {}).find(
      ([, l]) => l === 'Reserve Battery',
    )
    return Number(entry?.[0] ?? -1)
  }, [controlRule])

  const isOn = (bit: number) =>
    controlWord !== undefined && ((controlWord >> bit) & 1) === 1

  /** Flip a free 43110 bit (reserve, grid charge) in the staged word. */
  const toggleControlBit = (bit: number) => {
    const word = controlWord ?? 0
    const on = ((word >> bit) & 1) === 1
    setStagedControl(
      on ? (word & ~(1 << bit)) & 0xffff : (word | (1 << bit)) & 0xffff,
    )
  }

  /**
   * Write one staged bit word, masked so bits outside the rule survive.
   *
   * Refuses outright when the register has not been read. The Save button is
   * already disabled in that case; this makes the rule hold even if something
   * else ever reaches the handler.
   */
  const saveBitWord = useCallback(
    async (
      address: number,
      staged: number | undefined,
      read: number | undefined,
    ): Promise<SaveResult> => {
      if (read === undefined) {
        return { ok: false, error: 'Not read — read the group first' }
      }
      const value = staged ?? read
      const reg = byAddress.get(address)
      const out = await write({
        address,
        value,
        // read_modify_write: this screen owns only the bits the rule names.
        ownedMask: ownedMaskOf(address),
        currentValue: read,
        variableKey: reg?.key,
        id,
      })
      return { ok: out.ok, error: out.error }
    },
    [write, id],
  )

  const saveControl = useCallback(
    () => saveBitWord(STORAGE_CONTROL, stagedControl, readControl),
    [saveBitWord, stagedControl, readControl],
  )
  const saveExport = useCallback(
    () => saveBitWord(EXPORT_CONTROL, stagedExport, readExport),
    [saveBitWord, stagedExport, readExport],
  )
  const saveUnbalance = useCallback(
    () => saveBitWord(UNBALANCE_CONTROL, stagedUnbalance, readUnbalance),
    [saveBitWord, stagedUnbalance, readUnbalance],
  )

  /* Asked for by its rules-file label, never counted, so a renumbering in the
     gospel moves the toggle with it. */
  const unbalanceBit = useMemo(() => {
    const labels = ruleFor(UNBALANCE_CONTROL)?.independent_bit_labels ?? {}
    return Number(
      Object.entries(labels).find(([, l]) => l === UNBALANCE_BIT_LABEL)?.[0] ??
        -1,
    )
  }, [])

  const unbalanceWord = stagedUnbalance ?? readUnbalance
  const unbalanceOn =
    unbalanceWord !== undefined && ((unbalanceWord >> unbalanceBit) & 1) === 1
  const unbalanceDirty =
    stagedUnbalance !== undefined && stagedUnbalance !== readUnbalance

  const controlDirty = stagedControl !== undefined && stagedControl !== readControl
  const exportDirty = stagedExport !== undefined && stagedExport !== readExport

  const allowExport =
    exportWord === undefined ? false : allowExportFromWord(exportWord)
  const gridImportLimit =
    exportWord === undefined ? false : gridImportLimitFromWord(exportWord)

  /* What the pending mode pick will silently switch off, so it is never quiet. */
  const conflicts =
    stagedControl !== undefined && readControl !== undefined && selected
      ? conflictsOfMode(readControl, selected.bit)
      : []

  const modeOpts: RowOption[] = modes.map((m) => ({
    value: m.bit,
    label: m.label,
  }))

  /**
   * The work-mode row's current-value text.
   *
   * An unrecognised word is INFORMATION, not an error to smooth over. Two mode
   * bits set, or none, is exactly the state a debug tool exists to reveal — so
   * it is printed and no segment lights up. Never snapped to the nearest.
   */
  const modeText =
    controlWord === undefined
      ? undefined
      : selected
        ? `${selected.label} · ${hex(controlWord)}`
        : `Unknown (${hex(controlWord)})`

  /** One numeric row, staged into the page's edit map, saved on its own. */
  const numberRow = (address: number, last = false) => {
    const spec = NUMBER_ROWS[address]
    /*
     * A row asked for by an address the table does not describe. Not
     * hypothetical: the row lists are built from the gospel, so a register
     * dropped from the map reaches here. Saying so beats drawing a row with
     * an undefined label and no description.
     */
    if (!spec) return null
    const reg = byAddress.get(address)
    const scale = reg?.scale ?? 1
    const raw = rawOf(variables, reg?.key ?? '')
    const hasBeenRead = raw !== undefined
    const staged = numberEdits[address]
    const shown =
      staged !== undefined
        ? rawToDisplay(staged, scale)
        : raw === undefined
          ? ''
          : rawToDisplay(raw, scale)

    return (
      <div key={address} data-testid={`row-${address}`}>
        <SettingRowOne
          label={spec.label}
          reg={address}
          description={spec.description}
          current={currentText(reg, raw)}
          hasBeenRead={hasBeenRead}
          ageMs={ageOf(variables, reg?.key, now)}
          dirty={staged !== undefined}
          hint={reg?.revision_note ?? spec.description}
          last={last}
          sendMode="immediate"
          editor={{
            kind: 'number',
            value: shown === '' ? '' : Number(shown),
            unit: reg?.units ?? '',
            // DELIBERATELY NO CLAMP. 43488's real ceiling is a property of the
            // model — about 4x rated power, observed as 200000 W on one and
            // 500000 W on another. The inverter is the thing that knows.
            onChange: (v) =>
              setNumberEdits((e) => ({ ...e, [address]: displayToRaw(v, scale) })),
          }}
          onSave={async () => {
            const value = staged ?? raw
            if (value === undefined) {
              return { ok: false, error: 'Not read — read the group first' }
            }
            const out = await write({
              address,
              value,
              currentValue: raw,
              variableKey: reg?.key,
              id,
              ...(WIDTH_OVERRIDES[address]
                ? { width: WIDTH_OVERRIDES[address] }
                : {}),
            })
            return { ok: out.ok, error: out.error }
          }}
        />
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        width: '100%',
      }}
    >
      <GroupStatus
        lastReadAt={
          controlReg?.key && variables?.[controlReg.key]?.lastUpdated
            ? new Date(variables[controlReg.key].lastUpdated).getTime()
            : null
        }
        /* No read button here: ALL on the range-button row above is the one
           route to the wire, and it already sweeps exactly the blocks this
           page needs. */
        now={now}
      />

      <GroupPane>
        {/* Storage mode. Segmented: four exclusive choices, exactly one on. */}
        <div data-testid={`row-${STORAGE_CONTROL}`}>
          <SettingRowOne
            label="Storage mode"
            reg={STORAGE_CONTROL}
            description={
              conflicts.length
                ? conflicts.join(' ')
                : `Exactly one of bits ${modes
                    .map((m) => m.bit)
                    .join('/')} in ${STORAGE_CONTROL}. Picking one clears the others; grid charge and battery wake-up are left alone.`
            }
            current={modeText}
            hasBeenRead={controlRead}
            ageMs={ageOf(variables, controlReg?.key, now)}
            dirty={controlDirty}
            hint={controlRule?.summary}
            sendMode="immediate"
            editor={{
              kind: 'segmented',
              // '' when no single mode is named, so nothing lights up.
              value: selected ? selected.bit : '',
              options: modeOpts,
              onChange: (bit) => setStagedControl(wordForMode(controlWord ?? 0, bit)),
            }}
            onSave={saveControl}
          />
        </div>

        {/* Battery reserve switch, then its target value. */}
        <div data-testid={`row-${STORAGE_CONTROL}-reserve`}>
          <SettingRowOne
            label="Battery reserve"
            reg={`${STORAGE_CONTROL} BIT0${reserveBit}`}
            description={`Holds charge back for a power cut. Bit switch inside ${STORAGE_CONTROL}; cannot be on at the same time as the Peak-Shaving work mode.`}
            current={controlWord === undefined ? undefined : hex(controlWord)}
            hasBeenRead={controlRead}
            ageMs={ageOf(variables, controlReg?.key, now)}
            dirty={controlDirty}
            sendMode="immediate"
            editor={{
              kind: 'toggle',
              on: isOn(reserveBit),
              onChange: () => toggleControlBit(reserveBit),
            }}
            onSave={saveControl}
          />
        </div>

        {numberRow(BATTERY_RESERVE_SOC)}

        <div data-testid={`row-${STORAGE_CONTROL}-gridcharge`}>
          <SettingRowOne
            label={bitLabel(gridChargeBit)}
            reg={`${STORAGE_CONTROL} BIT0${gridChargeBit}`}
            description={`Sets whether the system may charge the battery from the grid. Bit switch inside ${STORAGE_CONTROL}; independent of the work mode.`}
            current={controlWord === undefined ? undefined : hex(controlWord)}
            hasBeenRead={controlRead}
            ageMs={ageOf(variables, controlReg?.key, now)}
            dirty={controlDirty}
            sendMode="immediate"
            editor={{
              kind: 'toggle',
              on: isOn(gridChargeBit),
              onChange: () => toggleControlBit(gridChargeBit),
            }}
            onSave={saveControl}
          />
        </div>

        {/*
          Allow export. ACTIVE-LOW on the wire: 0 = allowed. The inversion
          happens once, in `storageModeModel`; there is deliberately no second
          one here, or the screen would disable a customer's export while
          politely showing them "allowed".
        */}
        <div data-testid={`row-${EXPORT_CONTROL}-export`}>
          <SettingRowOne
            label="Allow export"
            reg={`${EXPORT_CONTROL} BIT0${ALLOW_EXPORT_BIT}`}
            description={`Bit switch inside ${EXPORT_CONTROL}. ACTIVE-LOW on the wire — 0 means export is allowed — so the toggle reads the way you expect and the inversion happens once, at the bit layer.`}
            current={exportWord === undefined ? undefined : hex(exportWord)}
            hasBeenRead={exportRead}
            ageMs={ageOf(variables, exportReg?.key, now)}
            dirty={exportDirty}
            sendMode="immediate"
            editor={{
              kind: 'toggle',
              on: allowExport,
              onChange: () =>
                setStagedExport(wordForAllowExport(exportWord ?? 0, !allowExport)),
            }}
            onSave={saveExport}
          />
        </div>

        {/*
          The peak-shaving SWITCH and its two parameters. The `?` is here
          because two unrelated features carry the name and both are on this
          screen — see PEAK_SHAVING_HELP.
        */}
        <div data-testid={`row-${EXPORT_CONTROL}-peak`}>
          <SettingRowOne
            label="Peak shaving (grid import limit)"
            reg={`${EXPORT_CONTROL} BIT0${GRID_IMPORT_LIMIT_BIT}`}
            description={`Bit switch inside ${EXPORT_CONTROL}. Caps battery charging so total grid import stays under the limit below — "battery charge limit dependent on dynamic loads". NOT the ${STORAGE_CONTROL} peak-shaving work mode. Press ? for the difference.`}
            current={exportWord === undefined ? undefined : hex(exportWord)}
            hasBeenRead={exportRead}
            ageMs={ageOf(variables, exportReg?.key, now)}
            dirty={exportDirty}
            help={PEAK_SHAVING_HELP}
            helpTitle="Two things are called peak shaving"
            sendMode="immediate"
            editor={{
              kind: 'toggle',
              on: gridImportLimit,
              onChange: () =>
                setStagedExport(
                  wordForGridImportLimit(exportWord ?? 0, !gridImportLimit),
                ),
            }}
            onSave={saveExport}
          />
        </div>

        {numberRow(GRID_IMPORT_POWER)}
        {numberRow(PEAK_SOC)}

        {/*
          Max export power and export calibration on BOTH platforms at once.
          Two different registers do each job on two different model families.
          The screen never sniffs the model: it offers both, each labelled with
          its address and its platform. On a machine that only has one of them
          the other write fails and shows its error — honest, where guessing is
          not.
        */}
        {numberRow(MAX_EXPORT_U16)}
        {numberRow(MAX_EXPORT_U32)}
        {numberRow(EXPORT_CAL_U16)}
        {numberRow(EXPORT_CAL_U32)}

        {/* Unbalance output — one BIT of 43073, masked. See UNBALANCE_CONTROL. */}
        <div data-testid={`row-${UNBALANCE_CONTROL}`}>
          <SettingRowOne
            label="Unbalance output"
            reg={`${UNBALANCE_CONTROL} BIT0${unbalanceBit}`}
            description={`Bit switch inside ${UNBALANCE_CONTROL}. ON lets the three phases carry different currents (three-phase independent control); OFF forces them balanced. The rest of ${UNBALANCE_CONTROL} holds the EPM and FailSafe switches, so only this bit is written.`}
            current={unbalanceWord === undefined ? undefined : hex(unbalanceWord)}
            hasBeenRead={unbalanceRead}
            ageMs={ageOf(variables, unbalanceReg?.key, now)}
            dirty={unbalanceDirty}
            hint={ruleFor(UNBALANCE_CONTROL)?.summary}
            last
            sendMode="immediate"
            editor={{
              kind: 'toggle',
              on: unbalanceOn,
              onChange: () => {
                const word = unbalanceWord ?? 0
                setStagedUnbalance(
                  unbalanceOn
                    ? (word & ~(1 << unbalanceBit)) & 0xffff
                    : (word | (1 << unbalanceBit)) & 0xffff,
                )
              },
            }}
            onSave={saveUnbalance}
          />
        </div>

        {lastError && (
          <div
            style={{
              padding: '5px 8px',
              font: '600 9px/1.4 Helvetica,Arial',
              color: C.red,
            }}
          >
            {lastError}
          </div>
        )}
      </GroupPane>
    </div>
  )
}

export default StorageMode
