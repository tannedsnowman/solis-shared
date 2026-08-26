/**
 * Remote Control — the three interfaces that drive the inverter from outside.
 *
 * Built on `GroupView`'s kit, one flat column, exactly like Control Panel,
 * Storage Mode, Battery Setup, Smart Port and Parallel. The register list, the
 * enum overrides and the bit maths live in `remoteControlModel.ts`, where they
 * are proven without a renderer. This file draws them.
 *
 * WHY THIS ONE HAS SUB-HEADINGS WHEN THE OTHERS DO NOT
 * ---------------------------------------------------
 * The other screens are one job each, so a flat list reads fine. This screen
 * is three overlapping generations of the same job — see the model's header
 * for what separates them. Which block a row belongs to is the single most
 * important thing about it, because the whole question an installer brings to
 * this page is "which of these does this machine support". Sub-headings are
 * the answer to that question, not decoration.
 *
 * THREE SHAPES OF ROW
 * -------------------
 *   • Plain rows own a whole register and stage on the address alone.
 *   • The two switches of 44102 share a word and stage into one slot, merged
 *     under a mask — writing a bare value there clears the switch you did not
 *     name, silently.
 *   • The port selectors at 44280 pack two nibbles into one word, so the port
 *     dropdown and the PV-shutdown toggle likewise stage into a single slot.
 *
 * NO WRITE BEFORE A READ
 * ----------------------
 * Every row passes `hasBeenRead` and an unread row is un-editable. That
 * promise matters more here than anywhere else in the rail: these registers
 * command power flow, and a write built on a word this screen never read is a
 * guess about what the machine is currently doing.
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
  GroupSubHeading,
  RowEditor,
  RowOption,
  SaveResult,
  SettingRowOne,
} from '../settings/GroupView'
import { ruleFor } from '../settings/GospelRows'
import { byAddress } from '../../gospel/gospel'
import {
  ACTIVE_PORT_OPTIONS,
  LIMIT_BITS,
  LIMIT_OWNED_MASK,
  PC_ACTIVE_PORT,
  PC_REACTIVE_PORT,
  RD_LIMIT_SWITCH,
  RD_SWITCH,
  REACTIVE_PORT_OPTIONS,
  REMOTE_ROWS,
  RemoteRow,
  RemoteSection,
  changedMask,
  portOf,
  portWord,
  pvShutdownOf,
  remoteControlAddresses,
  slotOf,
  withBit,
} from './remoteControlModel'

interface RemoteControlProps {
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
export const ADDRESSES = remoteControlAddresses()

const hex = (n: number) =>
  `0x${(n & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`

/** BIT07 rather than BIT7 — matches how the documents and SolisCloud print it. */
const bitRef = (address: number, bit: number) =>
  `${address} BIT${String(bit).padStart(2, '0')}`

/** Epoch ms of a reading, or null when the store carries no stamp. */
function stampOf(variables: any, key: string): number | null {
  const raw = variables?.[key]?.lastUpdated
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : null
}

/** Age of a reading in ms, or undefined when it was never read. */
function ageOf(variables: any, key: string | undefined, now: number) {
  const t = key ? stampOf(variables, key) : null
  return t === null ? undefined : Math.max(0, now - t)
}

/**
 * One plain row: a whole register, staged and saved on its own.
 *
 * `staged` is always the raw register value. The 32-bit setpoints go through
 * the same path as everything else — `useRegisterWrite` reads the width from
 * the gospel and sends function 16 for them, so nothing here has to know which
 * rows are wide.
 */
const PlainRow: React.FC<{
  row: RemoteRow
  variables: any
  id: string
  now: number
  staged: number | undefined
  onStage: (raw: number) => void
  onSaved: () => void
  /** Appended to the description when the row is not currently in force. */
  inactiveNote?: string
  last?: boolean
  /** Threaded down from the page, so one seam serves every row. */
  writer: HybridWriter
}> = ({
  row,
  variables,
  id,
  now,
  staged,
  onStage,
  onSaved,
  inactiveNote,
  last,
  writer,
}) => {
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

  const spec = editorFor(reg, {
    rule,
    /* A real `value_map` from the gospel first; the row's transcription of the
       description only when there is none. `editorFor` applies that order —
       the override is passed unconditionally and loses on its own. */
    overrideOptions: reg.value_map
      ? optionsFromValueMap(reg.value_map)
      : row.overrideOptions,
    /* Modes here are real numbered choices — which port, which control mode —
       so they show as a dropdown of those codes rather than a toggle that
       hides the number being sent. The dispatch master switch is the one
       genuine on/off, and its gospel value_map is a two-value map, so
       `editorFor` renders it as a toggle on its own. */
    allowToggle: address === RD_SWITCH,
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
      : spec.kind === 'toggle'
        ? {
            kind: 'toggle',
            on: shownRaw === 1,
            onChange: (on) => onStage(on ? 1 : 0),
          }
        : {
            kind: 'number',
            value: shownRaw === undefined ? '' : rawToDisplay(shownRaw, scale),
            /* `units` on some of these registers holds a whole sentence rather
               than a unit — 44100's says "Remote dispatch enable". Anything
               that long is prose that escaped into the wrong field, so it is
               not drawn as a suffix. */
            unit: reg.units && reg.units.length <= 4 ? reg.units : '',
            onChange: (shown) => onStage(displayToRaw(shown, scale)),
          }

  const save = async (): Promise<SaveResult> => {
    if (word === undefined) return { ok: false, error: 'not read' }
    const out = await write({
      address,
      value: staged ?? word,
      currentValue: word,
      variableKey: reg.key,
      id,
    })
    if (out.ok) onSaved()
    return { ok: out.ok, error: out.error }
  }

  return (
    <SettingRowOne
      label={row.label}
      reg={address}
      description={
        inactiveNote ? `${row.description} ${inactiveNote}` : row.description
      }
      current={hasBeenRead ? currentText(reg, word) : undefined}
      hasBeenRead={hasBeenRead}
      ageMs={ageOf(variables, reg.key, now)}
      readOnly={spec.readOnly}
      hint={reg.revision_note ?? rule?.summary}
      help={row.help}
      sendMode="immediate"
      dirty={staged !== undefined && staged !== word}
      editor={editor}
      onSave={save}
      last={last}
    />
  )
}

const SECTION_TITLES: Record<RemoteSection, { title: string; note: string }> = {
  control: {
    title: 'Remote control · 43128-43136',
    note: 'The original interface. 16-bit, x10 W. Its battery half and grid half cancel each other — turning one on resets the other to 0.',
  },
  dispatch: {
    title: 'Remote dispatch · 44100-44107',
    note: 'The replacement. Adds a settable failsafe timeout, system import/export caps, and one signed 32-bit setpoint instead of a 16-bit pair.',
  },
  power: {
    title: 'Power control · 44280-44287',
    note: 'The newest, and the only one that commands reactive power. Three signed 32-bit values at 1 W / 1 Var per step, each gated by a port word.',
  },
}

const RemoteControl: React.FC<RemoteControlProps> = ({ variables, id, writer }) => {
  /** Staged edits by slot, holding RAW register values. */
  const [edits, setEdits] = useState<Record<string, number>>({})
  const { write } = writer

  /* One timestamp for the whole render. Calling Date.now() inside each row
     would date otherwise-identical readings a millisecond apart. */
  const now = Date.now()

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

  /*
   * The dispatch master switch, staged-first.
   *
   * Staged wins so the "dispatch is off" note on the rows below clears the
   * instant you enable it, before the write goes out — the same rule Parallel
   * follows for standalone/parallel.
   */
  const dispatchReg = byAddress.get(RD_SWITCH)
  const dispatchRaw =
    edits[String(RD_SWITCH)] ?? rawOf(variables, dispatchReg?.key ?? '')
  const dispatchOn = dispatchRaw === undefined ? undefined : dispatchRaw !== 0

  /* ------------------------------------------------ 44102, two masked bits */

  const limitReg = byAddress.get(RD_LIMIT_SWITCH)
  const limitWord = rawOf(variables, limitReg?.key ?? '')
  const limitSlot = String(RD_LIMIT_SWITCH)
  const limitStaged = edits[limitSlot]
  const limitShown = limitStaged ?? limitWord

  /**
   * Save 44102 under a mask.
   *
   * The mask is the bits that MOVED, bounded by the two this screen draws. A
   * bare write of 0-3 would clear whichever switch was not named and nothing
   * in the reply would report it — which is exactly the bug the SolisConnect
   * app's four-value dropdown has.
   */
  const saveLimitWord = useCallback(async (): Promise<SaveResult> => {
    if (limitWord === undefined) {
      return { ok: false, error: 'Not read — read the block first' }
    }
    const out = await write({
      address: RD_LIMIT_SWITCH,
      value: limitStaged ?? limitWord,
      ownedMask: changedMask(limitWord, limitStaged) & LIMIT_OWNED_MASK,
      currentValue: limitWord,
      variableKey: limitReg?.key,
      id,
    })
    if (out.ok) clearStage(limitSlot)
    return { ok: out.ok, error: out.error }
  }, [write, limitWord, limitStaged, limitReg, id, clearStage, limitSlot])

  /* -------------------------------------- 44280, two nibbles in one word */

  const activePortReg = byAddress.get(PC_ACTIVE_PORT)
  const activePortWord = rawOf(variables, activePortReg?.key ?? '')
  const activePortSlot = String(PC_ACTIVE_PORT)
  const activePortStaged = edits[activePortSlot]
  const activePortShown = activePortStaged ?? activePortWord

  const saveActivePort = useCallback(async (): Promise<SaveResult> => {
    if (activePortWord === undefined) {
      return { ok: false, error: 'Not read — read the block first' }
    }
    const out = await write({
      address: PC_ACTIVE_PORT,
      value: activePortStaged ?? activePortWord,
      currentValue: activePortWord,
      variableKey: activePortReg?.key,
      id,
    })
    if (out.ok) clearStage(activePortSlot)
    return { ok: out.ok, error: out.error }
  }, [write, activePortWord, activePortStaged, activePortReg, id, clearStage, activePortSlot])

  const lastReadAt = useMemo(() => {
    const stamps = ADDRESSES.map((a) =>
      stampOf(variables, byAddress.get(a)?.key ?? ''),
    ).filter((t): t is number => t !== null)
    return stamps.length ? Math.max(...stamps) : null
  }, [variables])

  /** The rows of one generation, in model order. */
  const rowsIn = (section: RemoteSection) =>
    REMOTE_ROWS.filter((r) => r.section === section)

  /**
   * A dispatch row that is not in force says so rather than being locked.
   *
   * Locking would stop an installer setting the caps and the setpoint up
   * before flipping the master switch, which is the normal order of work.
   * Saying nothing would let these numbers read as though they were already
   * commanding the machine.
   */
  const dispatchNote = (address: number) =>
    address !== RD_SWITCH && dispatchOn === false
      ? 'Not in force right now — remote dispatch is switched off.'
      : undefined

  const plain = (
    row: RemoteRow,
    opts: { last?: boolean; inactiveNote?: string } = {},
  ) => {
    const slot = slotOf(row)
    return (
      <PlainRow
        key={slot}
        row={row}
        variables={variables}
        id={id}
        now={now}
        staged={edits[slot]}
        onStage={(raw) => stage(slot, raw)}
        onSaved={() => clearStage(slot)}
        inactiveNote={opts.inactiveNote}
        last={opts.last}
        writer={writer}
      />
    )
  }

  const dispatchRows = rowsIn('dispatch')
  const powerRows = rowsIn('power')

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
        {/* ---- 1. remote control, 43128-43136 ---- */}
        <GroupSubHeading
          title={SECTION_TITLES.control.title}
          note={SECTION_TITLES.control.note}
          first
        />
        {rowsIn('control').map((row) => plain(row))}

        {/* ---- 2. remote dispatch, 44100-44107 ---- */}
        <GroupSubHeading
          title={SECTION_TITLES.dispatch.title}
          note={SECTION_TITLES.dispatch.note}
        />
        {/* The master switch and the failsafe come first, then the two limit
            bits, then the caps they arm — so a switch sits directly above the
            value it governs. */}
        {dispatchRows.slice(0, 2).map((row) =>
          plain(row, { inactiveNote: dispatchNote(row.address) }),
        )}
        {LIMIT_BITS.map((b) => (
          <SettingRowOne
            key={`limit-${b.bit}`}
            label={b.label}
            reg={bitRef(RD_LIMIT_SWITCH, b.bit)}
            description={
              dispatchOn === false
                ? `${b.description} Not in force right now — remote dispatch is switched off.`
                : b.description
            }
            /* The raw word, so the row says both things at once: the toggle
               says whether the cap is armed, the hex says what is actually in
               the register. */
            current={limitWord === undefined ? undefined : hex(limitWord)}
            hasBeenRead={limitWord !== undefined}
            ageMs={ageOf(variables, limitReg?.key, now)}
            hint={ruleFor(RD_LIMIT_SWITCH)?.summary}
            dirty={limitStaged !== undefined && limitStaged !== limitWord}
            sendMode="immediate"
            editor={{
              kind: 'toggle',
              on:
                limitShown === undefined
                  ? false
                  : (limitShown & (1 << b.bit)) !== 0,
              onChange: (on) =>
                stage(limitSlot, withBit(limitShown ?? 0, b.bit, on)),
            }}
            onSave={saveLimitWord}
          />
        ))}
        {dispatchRows.slice(2).map((row, i) =>
          plain(row, {
            inactiveNote: dispatchNote(row.address),
            last: i === dispatchRows.length - 3,
          }),
        )}

        {/* ---- 3. power control, 44280-44287 ---- */}
        <GroupSubHeading
          title={SECTION_TITLES.power.title}
          note={SECTION_TITLES.power.note}
        />
        {/* Both port words first: they are the gate on the three values below,
            and a value written with its port shut does nothing at all. */}
        <SettingRowOne
          label="Active power port"
          reg={PC_ACTIVE_PORT}
          description="Which port active power is commanded on — the AC grid port or the battery port, one or the other. Resets itself to 0 if no command arrives inside the timeout at 43282."
          current={
            activePortWord === undefined
              ? undefined
              : `port ${portOf(activePortWord)}, PV ${pvShutdownOf(activePortWord) ? 'shutdown' : 'normal'} · ${hex(activePortWord)}`
          }
          hasBeenRead={activePortWord !== undefined}
          ageMs={ageOf(variables, activePortReg?.key, now)}
          help={REMOTE_ROWS.find((r) => r.section === 'power')?.help}
          helpTitle="Power control ports"
          dirty={
            activePortStaged !== undefined && activePortStaged !== activePortWord
          }
          sendMode="immediate"
          editor={{
            kind: 'select',
            value:
              activePortShown === undefined ? '' : portOf(activePortShown),
            options: ACTIVE_PORT_OPTIONS,
            onChange: (port) =>
              stage(
                activePortSlot,
                portWord(
                  activePortShown ?? 0,
                  port,
                  pvShutdownOf(activePortShown ?? 0),
                ),
              ),
          }}
          onSave={saveActivePort}
        />
        <SettingRowOne
          label="PV shutdown"
          reg={bitRef(PC_ACTIVE_PORT, 4)}
          description="Shuts the PV input down. A separate nibble of the same word as the port above, so it can be set alongside either port — the two do not compete."
          current={
            activePortWord === undefined ? undefined : hex(activePortWord)
          }
          hasBeenRead={activePortWord !== undefined}
          ageMs={ageOf(variables, activePortReg?.key, now)}
          dirty={
            activePortStaged !== undefined && activePortStaged !== activePortWord
          }
          sendMode="immediate"
          editor={{
            kind: 'toggle',
            on:
              activePortShown === undefined
                ? false
                : pvShutdownOf(activePortShown),
            onChange: (on) =>
              stage(
                activePortSlot,
                portWord(
                  activePortShown ?? 0,
                  portOf(activePortShown ?? 0),
                  on,
                ),
              ),
          }}
          onSave={saveActivePort}
        />
        {/* 44281 owns its whole word, so it goes through the plain path with a
            transcribed enum rather than the nibble maths above. */}
        <PlainRow
          row={{
            address: PC_REACTIVE_PORT,
            label: 'Reactive power port',
            description:
              'Opens the port for the reactive setpoint below. Resets itself to 0 if no command arrives inside the timeout at 43282.',
            section: 'power',
            overrideOptions: REACTIVE_PORT_OPTIONS,
          }}
          variables={variables}
          id={id}
          now={now}
          staged={edits[String(PC_REACTIVE_PORT)]}
          onStage={(raw) => stage(String(PC_REACTIVE_PORT), raw)}
          onSaved={() => clearStage(String(PC_REACTIVE_PORT))}
          writer={writer}
        />
        {powerRows.map((row, i) =>
          plain(row, { last: i === powerRows.length - 1 }),
        )}
      </GroupPane>
    </div>
  )
}

export default RemoteControl
