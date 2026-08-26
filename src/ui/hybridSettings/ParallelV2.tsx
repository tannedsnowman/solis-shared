/**
 * Parallel — standalone/parallel, who leads the bank, and how it is wired.
 *
 * Built on `GroupView`'s kit, one flat column, no sub-headings, exactly like
 * Control Panel, Storage Mode, Battery Setup and Smart Port. Replaces the
 * card-grid `Parallel.tsx`, which is on the older `SettingsShell` and is left
 * in place until every screen has moved across.
 *
 * WHY THIS SCREEN IS THE SIMPLE ONE
 * ---------------------------------
 * Not one row here is a bit inside a shared word. Every row owns a whole
 * register, so there is no read-modify-write, no `ownedMask`, and no shared
 * staging slot — each row stages and saves entirely on its own. Control Panel
 * needed all three because eight of its rows live in 43451; nothing on this
 * page does, and adding that machinery anyway would be scaffolding around an
 * empty space.
 *
 * NO WRITE BEFORE A READ
 * ----------------------
 * Every row passes `hasBeenRead` and an unread row is un-editable, the same as
 * every other screen. The reason is weaker here than on a bit screen — there
 * are no unowned bits to clobber — but it is the same promise everywhere: the
 * tool does not send a value it has not first shown you.
 *
 * The register list and the enum overrides live in `parallelModel.ts`, where
 * they are proven without a renderer. This file draws them.
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
import { byAddress } from '../../gospel/gospel'
import {
  PARALLEL_ROWS,
  ParallelRow,
  STANDALONE_PARALLEL,
  parallelAddresses,
  slotOf,
} from './parallelModel'

interface ParallelV2Props {
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
export const ADDRESSES = parallelAddresses()

/** Epoch ms of a reading, or null when the store carries no stamp. */
function stampOf(variables: any, key: string): number | null {
  const raw = variables?.[key]?.lastUpdated
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * One row.
 *
 * `staged` is the raw register value, always — there are no bit rows on this
 * screen, so there is no second meaning for it to carry.
 */
const ParallelRowView: React.FC<{
  row: ParallelRow
  variables: any
  id: string
  staged: number | undefined
  onStage: (raw: number) => void
  onSaved: () => void
  /**
   * Whether the bank is actually in parallel mode. Undefined until 43391 has
   * been read. Rows other than 43391 itself say when it is off.
   */
  parallelOn?: boolean
  last?: boolean
  /** Threaded down from the page, so one seam serves every row. */
  writer: HybridWriter
}> = ({ row, variables, id, staged, onStage, onSaved, parallelOn, last, writer }) => {
  const { address } = row
  const reg = byAddress.get(address)
  const rule = ruleFor(address)
  const word = rawOf(variables, reg?.key ?? '')
  const { write } = writer

  /*
   * A register the gospel no longer carries is REPORTED, not drawn as an empty
   * row. Silence would look like a setting that simply has no value yet.
   */
  if (!reg) {
    return (
      <SettingRowOne
        label={row.label}
        reg={`${address} ?`}
        description={`${address} is not in the register map, so this row cannot be read or written. The gospel changed under this screen.`}
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
    const t = stampOf(variables, reg.key ?? '')
    return t === null ? undefined : Math.max(0, Date.now() - t)
  })()

  const spec = editorFor(reg, {
    rule,
    /* A real `value_map` from the gospel first; the row's transcription of the
       description only when there is none. `editorFor` applies that order —
       the override is passed unconditionally and loses on its own. */
    overrideOptions: reg.value_map
      ? optionsFromValueMap(reg.value_map)
      : row.overrideOptions,
    /* Enums here are real numbered choices — standalone/parallel,
       master/slave, which phase — so they show as a dropdown of those codes
       rather than a toggle that hides the number being sent. */
    allowToggle: false,
  })

  const scale = reg.scale ?? 1
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
          unit: reg.units && reg.units.length <= 4 ? reg.units : '',
          onChange: (shown) => onStage(displayToRaw(shown, scale)),
        }

  const save = async () => {
    if (word === undefined) return { ok: false, error: 'not read' }
    const out = await write({
      address,
      value: staged ?? word,
      currentValue: word,
      variableKey: reg.key,
      id,
    })
    if (out.ok) onSaved()
    return out
  }

  /*
   * A row that only bites in a parallel bank says so rather than being locked.
   * Locking would stop an installer setting the whole page up before flipping
   * 43391, which is the normal order of work; saying nothing would let these
   * numbers read as if they were already in force on a standalone machine.
   */
  const description =
    address !== STANDALONE_PARALLEL && parallelOn === false
      ? `${row.description} Not in force right now — this inverter is set to standalone.`
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
      hint={reg.revision_note ?? rule?.summary}
      sendMode="immediate"
      dirty={staged !== undefined && staged !== word}
      editor={editor}
      onSave={save}
      last={last}
    />
  )
}

const ParallelV2: React.FC<ParallelV2Props> = ({ variables, id, writer }) => {
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

  /* Staged wins, so the "standalone" note on every other row clears the
     instant you pick Parallel — before the write goes out. */
  const modeKey = byAddress.get(STANDALONE_PARALLEL)?.key ?? ''
  const modeRaw = edits[String(STANDALONE_PARALLEL)] ?? rawOf(variables, modeKey)
  const parallelOn = modeRaw === undefined ? undefined : modeRaw === 1

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
        {PARALLEL_ROWS.map((row, i) => {
          const slot = slotOf(row)
          return (
            <ParallelRowView
              key={slot}
              row={row}
              variables={variables}
              id={id}
              staged={edits[slot]}
              onStage={(raw) => stage(slot, raw)}
              onSaved={() => clearStage(slot)}
              parallelOn={parallelOn}
              last={i === PARALLEL_ROWS.length - 1}
              writer={writer}
            />
          )
        })}
      </GroupPane>
    </div>
  )
}

export default ParallelV2
