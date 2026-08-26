/**
 * Control Panel — inverter on/off and the grid-support modes.
 *
 * Replaces the old card-based `ControlPanel.tsx`, which held only the on/off
 * switch. Built on `GroupView`'s kit, one flat column, no sub-headings.
 *
 * WHAT MAKES THIS SCREEN DIFFERENT
 * --------------------------------
 * Eight of these rows are bits in ONE register (43451), and six of those eight
 * fight over the same physical quantity — the reactive power the inverter puts
 * out. Turning one on must turn the other five off. That exclusivity is
 * enforced by the gospel rule via `applyBitChange`, not by anything typed here.
 *
 * Because the six are exclusive, a staged edit to any of them is a staged edit
 * to ALL of them: picking Fixed PF clears Volt-var in the same word. So the
 * mode rows stage into ONE shared slot keyed by the register, not per row —
 * the opposite of the Battery screen, where two rows on 43110 needed separate
 * slots precisely because they were independent. Sharing the slot is what
 * makes the other five rows show their new off state the moment you pick one,
 * before anything is sent.
 *
 * NO WRITE BEFORE A READ
 * ----------------------
 * Every row passes `hasBeenRead` from its own register. 43451 is
 * `read_modify_write`; with no current word a write would guess the bits it
 * does not own and could switch on a grid-support mode nobody asked for.
 *
 * SETPOINTS SAY WHEN THEY ARE IDLE
 * --------------------------------
 * The PF and reactive setpoints are only obeyed while their mode is running.
 * The row stays editable — reading and setting a value ahead of enabling the
 * mode is legitimate — but it says plainly that the mode is off, rather than
 * letting a number look like it is doing something.
 *
 * The register maths lives in `controlPanelModel.ts` and is proven in its test.
 * This file draws it.
 */
import React, { useCallback, useMemo, useState } from 'react'
import type { HybridWriter } from '../settings/hybridWrite'
import { currentText, rawOf } from '../settings/GospelRows'
import {
  displayToRaw,
  editorFor,
  optionsFromValueMap,
  rawToDisplay,
} from '../../settings/editorFor'
import {
  GroupStatus,
  GroupPane,
  RowEditor,
  RowOption,
  SettingRowOne,
} from '../settings/GroupView'
import { ruleFor } from '../settings/GospelRows'
import { ownedMask } from '../../settings/bitRules'
import { byAddress } from '../../gospel/gospel'
import {
  CONTROL_ROWS,
  ControlRow,
  MODE_SWITCH,
  bitOf,
  controlAddresses,
  modeIsOn,
  modeRule,
  slotOf,
  wordForMode,
} from './controlPanelModel'

interface ControlPanelV2Props {
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

/** Registers this page reads, for the range-button row's highlight. */
export const ADDRESSES = controlAddresses()

/** Epoch ms of a reading, or null when the store carries no stamp. */
function stampOf(variables: any, key: string): number | null {
  const raw = variables?.[key]?.lastUpdated
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * One row, bit or value.
 *
 * `staged` is the whole 43451 word for a mode row, and a raw register value
 * for everything else — which is why the mode rows share one slot.
 */
const ControlRowView: React.FC<{
  row: ControlRow
  variables: any
  id: string
  staged: number | undefined
  onStage: (raw: number) => void
  onSaved: () => void
  /** Whether the mode this row depends on is currently on. Value rows only. */
  gateOn?: boolean
  last?: boolean
  /** Threaded down from the page, so one seam serves every row. */
  writer: HybridWriter
}> = ({ row, variables, id, staged, onStage, onSaved, gateOn, last, writer }) => {
  const { address, bitLabel } = row
  const reg = byAddress.get(address)
  const rule = ruleFor(address)
  const word = rawOf(variables, reg?.key ?? '')
  const { write } = writer

  const bit = bitLabel ? bitOf(modeRule(), bitLabel) : null

  /*
   * A mode whose label the rules file no longer carries is REPORTED, never
   * guessed at. Switching on a grid-support mode by guessing a bit number is
   * the kind of mistake that shows up as a compliance failure months later.
   */
  if (bitLabel && (!rule || bit === null)) {
    return (
      <SettingRowOne
        label={row.label}
        reg={`${address} ?`}
        description={`No bit called "${bitLabel}" in the rules for ${address}. The row is disabled rather than guessing a bit number.`}
        hasBeenRead={false}
        readOnly
        sendMode="immediate"
        editor={{ kind: 'toggle', on: false, onChange: () => {} }}
        last={last}
      />
    )
  }

  const hasBeenRead = word !== undefined
  const ageMs = (() => {
    const t = stampOf(variables, reg?.key ?? '')
    return t === null ? undefined : Math.max(0, Date.now() - t)
  })()

  /* ----------------------------------------------------------- mode row */

  if (bit !== null) {
    const read = hasBeenRead && modeIsOn(word!, bit)
    const on = staged !== undefined ? modeIsOn(staged, bit) : read

    const save = async () => {
      if (word === undefined) return { ok: false, error: 'not read' }
      const value = staged ?? wordForMode(rule!, word, bit, on)
      const out = await write({
        address,
        value,
        // Only the bits the rule names. The reserved top byte and anything
        // else living in this word survives untouched.
        ownedMask: ownedMask(rule!),
        currentValue: word,
        variableKey: reg?.key,
        id,
      })
      if (out.ok) onSaved()
      return out
    }

    return (
      <SettingRowOne
        label={row.label}
        reg={`${address} BIT${String(bit).padStart(2, '0')}`}
        description={row.description}
        current={hasBeenRead ? (read ? 'on' : 'off') : undefined}
        hasBeenRead={hasBeenRead}
        ageMs={ageMs}
        hint={[rule?.summary, rule?.write_explain].filter(Boolean).join('\n\n')}
        sendMode="immediate"
        dirty={staged !== undefined && on !== read}
        editor={{
          kind: 'toggle',
          on,
          /* The whole word goes into the shared slot, so the five siblings
             this change clears redraw as off straight away. */
          onChange: (next) =>
            onStage(wordForMode(rule!, staged ?? word ?? 0, bit, next)),
        }}
        onSave={save}
        last={last}
      />
    )
  }

  /* ---------------------------------------------------------- value row */

  const spec = editorFor(reg, {
    rule,
    overrideOptions: reg?.value_map
      ? optionsFromValueMap(reg.value_map)
      : undefined,
    // On/off is a real enum (190/222), so it must show as a dropdown of those
    // codes rather than a two-state toggle that hides which number is sent.
    allowToggle: false,
  })

  const scale = reg?.scale ?? 1
  const shownRaw = staged ?? word

  const editor: RowEditor =
    spec.kind === 'select'
      ? {
          kind: 'select',
          value: shownRaw ?? '',
          options: (spec.options ?? []) as RowOption[],
          onChange: onStage,
        }
      : {
          kind: 'number',
          value: shownRaw === undefined ? '' : rawToDisplay(shownRaw, scale),
          unit: reg?.units && reg.units.length <= 4 ? reg.units : '',
          onChange: (shown) => onStage(displayToRaw(shown, scale)),
        }

  const save = async () => {
    if (word === undefined) return { ok: false, error: 'not read' }
    const out = await write({
      address,
      value: staged ?? word,
      currentValue: word,
      variableKey: reg?.key,
      id,
    })
    if (out.ok) onSaved()
    return out
  }

  /*
   * An idle setpoint says so in its own description rather than being locked.
   * Locking it would stop an installer setting the value BEFORE enabling the
   * mode, which is a normal way to work; saying nothing would let a stale
   * number read as if it were in force.
   */
  const description =
    row.requiresBitLabel && gateOn === false
      ? `${row.description} Not in force right now — ${row.requiresBitLabel} is off.`
      : row.description

  return (
    <SettingRowOne
      label={row.label}
      reg={address}
      description={description}
      current={hasBeenRead ? currentText(reg, word) : undefined}
      hasBeenRead={hasBeenRead}
      ageMs={ageMs}
      readOnly={spec.readOnly}
      hint={reg?.revision_note ?? row.description}
      sendMode="immediate"
      dirty={staged !== undefined && staged !== word}
      editor={editor}
      onSave={save}
      last={last}
    />
  )
}

const ControlPanelV2: React.FC<ControlPanelV2Props> = ({ variables, id, writer }) => {
  /** Staged edits by slot, holding RAW register values. */
  const [edits, setEdits] = useState<Record<string, number>>({})

  const stage = useCallback((slot: string, raw: number) => {
    setEdits((e) => ({ ...e, [slot]: raw }))
  }, [])

  const clearStage = useCallback((slot: string) => {
    setEdits((e) => {
      if (e[slot] === undefined) return e
      const next = { ...e }
      delete next[slot]
      return next
    })
  }, [])

  const modeKey = byAddress.get(MODE_SWITCH)?.key ?? ''
  const modeWordRead = rawOf(variables, modeKey)
  /* Staged wins, so a setpoint's "mode is off" note updates the instant you
     pick a different mode — before the write goes out. */
  const modeWord = edits[String(MODE_SWITCH)] ?? modeWordRead

  const gateFor = useCallback(
    (label: string | undefined): boolean | undefined => {
      if (!label || modeWord === undefined) return undefined
      const bit = bitOf(modeRule(), label)
      return bit === null ? undefined : modeIsOn(modeWord, bit)
    },
    [modeWord],
  )

  const lastReadAt = useMemo(() => {
    const stamps = ADDRESSES.map((a) =>
      stampOf(variables, byAddress.get(a)?.key ?? ''),
    ).filter((t): t is number => t !== null)
    return stamps.length ? Math.max(...stamps) : null
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
      <GroupStatus lastReadAt={lastReadAt} />

      <GroupPane>
        {CONTROL_ROWS.map((row, i) => {
          /* Mode rows share ONE slot keyed by the register, because they share
             one word and picking one clears the others. Value rows get their
             own address-keyed slot. `slotOf` is the single place that decides
             which, so the screen and its test cannot disagree. */
          const slot = row.bitLabel ? String(row.address) : slotOf(row)
          return (
            <ControlRowView
              key={`${row.address}:${row.label}`}
              row={row}
              variables={variables}
              id={id}
              staged={edits[slot]}
              onStage={(raw) => stage(slot, raw)}
              onSaved={() => clearStage(slot)}
              gateOn={gateFor(row.requiresBitLabel)}
              last={i === CONTROL_ROWS.length - 1}
              writer={writer}
            />
          )
        })}
      </GroupPane>
    </div>
  )
}

export default ControlPanelV2
