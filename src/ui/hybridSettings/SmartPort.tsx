/**
 * Smart Port — two unrelated features on one flat, one-column list.
 *
 * The halves are NOT drawn apart with headings any more; the plan says flat,
 * and the full-width description line under every row is what keeps them
 * apart now. That line is the whole reason this layout is one column.
 *
 *   1. SMART PORT SELECTION (43365). What is physically bolted to the smart
 *      port: genset input, smart load output, AC coupled, or nothing.
 *
 *   2. AC COUPLED ON GRID PORT (44099). A bank of PV inverters on the GRID
 *      side. Nothing to do with the smart port — somebody would configure
 *      this with nothing on the smart port at all. Its registers (44220,
 *      44222, 43989, 43287, 43285) belong to it and to nothing else.
 *
 * BOTH are `sendMode: 'gated'`, and this screen is the main user of that mode.
 * A gated row writes the moment Save is clicked, and the settings that depend
 * on it appear ONLY once that write RETURNED OK. Picking "Genset input"
 * without saving shows nothing new: the sub-settings describe hardware state,
 * and showing them before the device agreed would be a lie.
 *
 * NO WRITE BEFORE A READ. Every row carries `hasBeenRead`, and an unread row
 * is un-editable. On 43365 and 43483 that is a safety rule, not a nicety: both
 * are read_modify_write, so with no current word a write would guess the
 * fifteen bits this screen does not own and silently clear the installer's
 * grid charge, battery wake-up and work mode.
 *
 * All register maths lives in `smartPortModel.ts`, where it is tested without
 * a renderer. This file is chrome.
 */
import React, { useCallback, useMemo, useState } from 'react'
import { at } from '../pv/captures'
import type { HybridWriter } from '../settings/hybridWrite'
import {
  GroupStatus,
  GroupPane,
  SaveResult,
  SettingRowOne,
  RowEditor,
} from '../settings/GroupView'
import { currentText, rawOf } from '../settings/GospelRows'
import {
  displayToRaw,
  rawToDisplay,
} from '../../settings/editorFor'
import { addressesOf } from '../settings/panelAddresses'
import { C } from '../settings/theme'
import { ruleFor } from '../settings/GospelRows'
import { byAddress } from '../../gospel/gospel'
import {
  AC_COUPLED_ROWS,
  GENSET_ROWS,
  RegRow,
  AC_COUPLED_ON_GRID,
  AC_COUPLING_MAX_EXPORT,
  AC_COUPLING_START_FREQ,
  AC_COUPLING_START_SOC,
  FUNCTION_CONTROL,
  GENSET_CHARGE_POWER,
  GENSET_ENABLE,
  GENSET_MODE,
  GENSET_RATED_POWER,
  GRID_TIED_INV_COUNT,
  GRID_TIED_INV_TOTAL_POWER,
  MAX_EXPORT_U16,
  MAX_EXPORT_U32,
  PORT_OPTIONS,
  PortChoice,
  SMART_PORT,
  acCoupledOnGridEnabled,
  choiceFromWord,
  conflictForChoice,
  smartPortOwnedMask,
  wordForChoice,
} from './smartPortModel'

interface SmartPortProps {
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

/**
 * What the `?` on the grid-side row says.
 *
 * Written for installers who do not speak English as a first language: short
 * sentences, no idiom, the second-meter workaround spelled out because it is
 * the step people get wrong and there is no error message when they do.
 */
const AC_COUPLED_HELP = [
  'AC COUPLED ON GRID PORT — what this is',
  '',
  'This is a group of PV inverters (solar inverters) on the GRID side of the',
  'hybrid. They are NOT connected to the smart port. The hybrid watches them',
  'and controls them.',
  '',
  'How the hybrid sees how much they are making:',
  '',
  '1. SOLIS inverters. The hybrid reads them directly over RS485. Wire the',
  '   RS485 line and it can see them.',
  '',
  '2. OTHER BRANDS. The hybrid cannot talk to them. So you must fit a SECOND',
  '   METER at Modbus address 2. Then, in Meter settings, set that second',
  '   meter’s location to "Grid + PV". The hybrid then works out the PV',
  '   power from what that meter reads.',
  '',
  'What it does with this:',
  '',
  'The hybrid turns the PV bank down (curtails it) so that the power sent to',
  'the grid stays below the max export setting.',
].join('\n')


/**
 * Registers this page reads, for the range-button row's highlight.
 *
 * Every row plus the two words the page reads itself: 43365, which the
 * selector owns, and 43483, which it only reads to detect the clash.
 * See `panelAddresses.ts`.
 */
export const ADDRESSES = addressesOf(
  [
    [
      {
        title: 'SMART PORT',
        rows: [...GENSET_ROWS, ...AC_COUPLED_ROWS, { address: AC_COUPLED_ON_GRID }],
      },
    ],
  ],
  [SMART_PORT, FUNCTION_CONTROL],
)

/* ── Reading `variables` ────────────────────────────────────────────── */

/** Age of a reading in ms, or undefined when the store has no timestamp. */
function ageOf(variables: any, key: string, now: number): number | undefined {
  const stamp = variables?.[key]?.lastUpdated
  if (!stamp) return undefined
  const t = new Date(stamp).getTime()
  return Number.isFinite(t) ? Math.max(0, now - t) : undefined
}

const conflictStyle: React.CSSProperties = {
  font: '600 10px/1.4 Helvetica,Arial',
  color: C.red,
  background: '#fff0ee',
  borderTop: `1px solid ${C.red}`,
  borderBottom: `1px solid ${C.red}`,
  padding: '6px 8px',
}

const SmartPort: React.FC<SmartPortProps> = ({ variables, id, writer }) => {
  const { write } = writer
  const now = Date.now()

  const portWord = rawOf(variables, 'generatorSettingSwitch')
  const functionWord = rawOf(variables, 'hybridFunctionControlWord')
  const gateWord = rawOf(variables, 'acCouplingConnectedToAcSide')

  /**
   * The 43365 selector is editable only when BOTH words have been read.
   *
   * 43365 because the write is a masked read-modify-write; 43483 because the
   * clash it must not cross lives there. An unread 43483 means the screen
   * cannot know whether a genset is even legal, so it must not offer one.
   */
  const portRead = portWord !== undefined && functionWord !== undefined

  const readChoice = choiceFromWord(portWord)

  /** What the installer has picked but not yet saved. */
  const [picked, setPicked] = useState<PortChoice | null>(null)
  const choice = picked ?? readChoice

  /**
   * The gate for the genset settings.
   *
   * Seeded from the DEVICE's own word, so a port already wired as a genset
   * shows its settings on first paint. After that only a write that returned
   * OK moves it — that is what `sendMode: 'gated'` means here.
   */
  const [gensetGate, setGensetGate] = useState<boolean | null>(null)
  const gensetOpen = gensetGate ?? readChoice === 'genset'

  /** The same pattern for the grid-side PV bank, gated on 44099. */
  const [acGate, setAcGate] = useState<boolean | null>(null)
  const [acPick, setAcPick] = useState<boolean | null>(null)
  const acRead = gateWord !== undefined
  const acOn = acPick ?? acCoupledOnGridEnabled(gateWord)
  const acOpen = acGate ?? acCoupledOnGridEnabled(gateWord)

  const conflict = choice ? conflictForChoice(choice, functionWord) : null

  /**
   * Write 43365 for the picked option.
   *
   * Refuses on a clash rather than resolving it: clearing 43483's AC Coupling
   * bit for the installer would silently undo a decision made on another
   * screen. The refusal returns `ok: false`, so the gate stays shut and the
   * Save button goes red — the honest signal.
   */
  const savePort = useCallback(async (): Promise<SaveResult> => {
    if (!portRead || !choice) return { ok: false, error: 'not read' }
    if (conflict) return { ok: false, error: conflict.message }
    const out = await write({
      address: SMART_PORT,
      value: wordForChoice(portWord ?? 0, choice),
      currentValue: portWord,
      ownedMask: smartPortOwnedMask(),
      variableKey: 'generatorSettingSwitch',
      id,
    })
    // Only a genset opens the genset settings. Saving any other option is
    // what closes them again.
    if (out.ok) setGensetGate(choice === 'genset')
    return out
  }, [portRead, choice, conflict, portWord, write, id])

  const saveAcGate = useCallback(async (): Promise<SaveResult> => {
    if (!acRead) return { ok: false, error: 'not read' }
    const out = await write({
      address: AC_COUPLED_ON_GRID,
      value: acOn ? 1 : 0,
      currentValue: gateWord,
      variableKey: 'acCouplingConnectedToAcSide',
      id,
    })
    if (out.ok) setAcGate(acOn)
    return out
  }, [acRead, acOn, gateWord, write, id])

  /** Unsaved edits on the plain register rows, keyed by address. */
  const [edits, setEdits] = useState<Record<number, number>>({})

  /**
   * Turn one gospel register into a row.
   *
   * Everything a row needs — editor kind, scale, units, options, read-only —
   * is derived from the gospel here, so a corrected map changes the screen
   * without an edit to this file.
   */
  const renderRegRow = useCallback(
    (r: RegRow, last: boolean) => {
      const reg = byAddress.get(r.address)
      const key = reg?.key ?? String(r.address)
      const raw = rawOf(variables, key)
      const hasBeenRead = raw !== undefined
      const scale = reg?.scale ?? 1
      const staged = edits[r.address]
      const value = staged ?? raw

      const editor: RowEditor = reg?.value_map
        ? {
            kind: 'select',
            value: value ?? '',
            /*
             * A code whose label is missing is DROPPED, not drawn.
             * `value_map` is generated, so a gap is possible, and an option
             * reading "undefined" in a dropdown is worse than one fewer
             * choice -- the user cannot tell what they would be writing.
             */
            options: Object.entries(reg.value_map)
              .flatMap(([k, label]) =>
                label === undefined ? [] : [{ value: Number(k), label }],
              )
              .sort((a, b) => a.value - b.value),
            onChange: (v) => setEdits((e) => ({ ...e, [r.address]: v })),
          }
        : {
            kind: 'number',
            value: value === undefined ? '' : rawToDisplay(value, scale),
            unit: reg?.units ?? '',
            onChange: (v) =>
              setEdits((e) => ({ ...e, [r.address]: displayToRaw(v, scale) })),
          }

      return (
        <SettingRowOne
          key={r.address}
          label={r.label}
          reg={r.address}
          description={r.description}
          current={currentText(reg, raw)}
          hasBeenRead={hasBeenRead}
          ageMs={ageOf(variables, key, now)}
          readOnly={ruleFor(r.address)?.write === 'read_only'}
          dirty={staged !== undefined && staged !== raw}
          editor={editor}
          sendMode="immediate"
          last={last}
          hint={reg?.revision_note ?? undefined}
          onSave={async () => {
            if (value === undefined) return { ok: false, error: 'not read' }
            const out = await write({
              address: r.address,
              value,
              currentValue: raw,
              variableKey: key,
              id,
            })
            return out
          }}
        />
      )
    },
    [variables, edits, now, write, id],
  )

  /** The rows actually on screen right now. Both gates decide this. */
  const rows = useMemo(() => {
    const out: React.ReactNode[] = []

    out.push(
      <SettingRowOne
        key={SMART_PORT}
        label="Smart port selection"
        reg={SMART_PORT}
        description={`What is physically wired to the smart port. Bitfield inside ${SMART_PORT}; the settings below it appear only after the write is accepted.`}
        current={
          readChoice
            ? (PORT_OPTIONS.find((o) => o.id === readChoice)?.label ?? readChoice)
            : undefined
        }
        hasBeenRead={portRead}
        ageMs={ageOf(variables, 'generatorSettingSwitch', now)}
        dirty={picked !== null && picked !== readChoice}
        hint={PORT_OPTIONS.map((o) => `${o.label}: ${o.hint}`).join('\n')}
        editor={{
          kind: 'segmented',
          // The choices are strings in the model and numbers in the kit, so
          // the index is the transport. The model stays the authority on what
          // the options ARE and in what order.
          value: choice ? PORT_OPTIONS.findIndex((o) => o.id === choice) : '',
          options: PORT_OPTIONS.map((o, i) => ({ value: i, label: o.label })),
          onChange: (i) => setPicked(at(PORT_OPTIONS, i, 'PORT_OPTIONS').id),
        }}
        sendMode="gated"
        onSave={savePort}
        onGateChange={(open) => {
          // A failed write must never leave the settings on screen.
          if (!open) setGensetGate(false)
        }}
      />,
    )

    if (conflict) {
      // Shown, never resolved. Clearing 43483 for the installer would undo a
      // decision made on another screen, silently.
      out.push(
        <div key="conflict" style={conflictStyle} title={conflict.explain}>
          {conflict.message}
        </div>,
      )
    }

    if (gensetOpen) {
      GENSET_ROWS.forEach((r) => out.push(renderRegRow(r, false)))
    }

    out.push(
      <SettingRowOne
        key={AC_COUPLED_ON_GRID}
        label="AC coupled on grid port"
        reg={AC_COUPLED_ON_GRID}
        description="A bank of PV inverters on the GRID side — a different feature from the smart port's AC Coupled option. Press ? for what it is and how to wire it."
        help={AC_COUPLED_HELP}
        helpTitle="AC coupled on grid port"
        current={
          gateWord === undefined
            ? undefined
            : acCoupledOnGridEnabled(gateWord)
              ? 'Enabled'
              : 'Disabled'
        }
        hasBeenRead={acRead}
        ageMs={ageOf(variables, 'acCouplingConnectedToAcSide', now)}
        dirty={acPick !== null && acPick !== acCoupledOnGridEnabled(gateWord)}
        editor={{
          kind: 'toggle',
          on: acOn,
          onChange: (on) => setAcPick(on),
        }}
        sendMode="gated"
        onSave={saveAcGate}
        onGateChange={(open) => {
          if (!open) setAcGate(false)
        }}
      />,
    )

    if (acOpen) {
      AC_COUPLED_ROWS.forEach((r, i) =>
        out.push(renderRegRow(r, i === AC_COUPLED_ROWS.length - 1)),
      )
    }

    return out
  }, [
    readChoice,
    portRead,
    picked,
    choice,
    conflict,
    gensetOpen,
    gateWord,
    acRead,
    acOn,
    acPick,
    acOpen,
    variables,
    now,
    savePort,
    saveAcGate,
    renderRegRow,
  ])

  /** Newest reading anywhere on the screen, for the header's "read Nm ago". */
  const lastReadAt = useMemo(() => {
    let newest: number | null = null
    for (const v of Object.values(variables ?? {}) as any[]) {
      const t = v?.lastUpdated ? new Date(v.lastUpdated).getTime() : NaN
      if (Number.isFinite(t)) newest = newest === null ? t : Math.max(newest, t)
    }
    return newest
  }, [variables])

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
        lastReadAt={lastReadAt}
        now={now}
        // No read button here: ALL on the range-button row above is the one
        // route to the wire. The `?` moved onto the AC-coupled row itself:
        // in the header it explained one row from a place that looked like it
        // described the whole screen.
      />
      <GroupPane>{rows}</GroupPane>
    </div>
  )
}

export default SmartPort
