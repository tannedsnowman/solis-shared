/**
 * Device Setting — SolisCloud's Device Setting page, grouped into categories.
 *
 * WHY THIS ONE HAS SUB-HEADINGS
 * -----------------------------
 * The other one-column screens are flat by design: six rows read faster
 * without headings. This screen carries twenty-odd rows spanning meters,
 * backup output, EPS, converter tuning and three one-shot commands, and a flat
 * list of that length is something you scroll through hunting rather than
 * read. `GroupSubHeading` divides it; the rows themselves are the same
 * `SettingRowOne` every other screen uses, so nothing about the row behaviour
 * changes with the grouping.
 *
 * FOUR KINDS OF ROW
 * -----------------
 * - `value`   an ordinary register. The editor comes from the gospel via
 *             `editorFor`, so an enum draws a dropdown and a scaled number
 *             draws a number box with its unit, with nothing typed here.
 * - `packed`  one BYTE of a register. 43140 holds the meter type in its low
 *             byte and the meter location in its high byte; each row writes
 *             masked to its own byte, so picking a type cannot move the
 *             location.
 * - `bit`     one BIT of a word this screen does not otherwise show. Masked to
 *             that single bit — 43073 also carries the EPM and FailSafe
 *             switches, which nothing here can display and nothing here may
 *             disturb.
 * - `command` a one-shot: write a value, something happens. These confirm
 *             before firing and are drawn last, under a red heading.
 *
 * The register maths and the row list live in `deviceSettingModel.ts` and are
 * proven in its test. This file draws them.
 */
import React, { useCallback, useEffect, useState } from 'react'
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
import { isSet, clearBit, setBit } from '../../settings/bitRules'
import { packField, unpackField } from '../../settings/packedFields'
import { byAddress } from '../../gospel/gospel'
import { C } from '../settings/theme'
import {
  DeviceRow,
  DEVICE_ROWS,
  SECTIONS,
  bitOf,
  commandValueOf,
  deviceAddresses,
  isDestructive,
  maskForBit,
  packedFieldOf,
  rowsOfSection,
  slotOf,
} from './deviceSettingModel'

interface DeviceSettingProps {
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

/** Registers this page reads, for the range-button row's highlight. */
export const ADDRESSES = deviceAddresses()

function stampOf(variables: any, key: string): number | null {
  const raw = variables?.[key]?.lastUpdated
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * The confirm sheet for a command row.
 *
 * A modal rather than a second click on the same button: the question has to
 * name what is about to happen, and a button that quietly becomes "really?"
 * says nothing to somebody who clicked it by accident.
 */
const ConfirmSheet: React.FC<{
  title: string
  body: string
  danger: boolean
  onConfirm: () => void
  onCancel: () => void
}> = ({ title, body, danger, onConfirm, onCancel }) => (
  <div
    data-testid="command-confirm"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    style={{
      position: 'fixed',
      inset: 0,
      zIndex: 40,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(51,41,31,.45)',
      padding: 16,
    }}
    onClick={onCancel}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        maxWidth: 380,
        width: '100%',
        maxHeight: '80vh',
        overflowY: 'auto',
        background: C.cardBg,
        border: `1px solid ${danger ? C.red : C.line}`,
        borderRadius: 3,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          padding: '6px 8px',
          background: danger ? C.red : C.orange,
          color: C.white,
          font: '700 10px/1.2 Helvetica,Arial',
          letterSpacing: '.06em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </div>
      <div
        style={{
          padding: 10,
          font: '400 10px/1.5 Helvetica,Arial',
          color: C.ink,
          whiteSpace: 'pre-wrap',
        }}
      >
        {body}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 6,
          justifyContent: 'flex-end',
          padding: '0 10px 10px',
        }}
      >
        <button
          type="button"
          data-testid="command-cancel"
          onClick={onCancel}
          style={{
            font: '600 10px/1 Helvetica,Arial',
            padding: '6px 10px',
            cursor: 'pointer',
            color: C.ink2,
            background: C.headBg,
            border: `1px solid ${C.line}`,
            borderRadius: 2,
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="command-confirm-go"
          onClick={onConfirm}
          style={{
            font: '700 10px/1 Helvetica,Arial',
            padding: '6px 10px',
            cursor: 'pointer',
            color: C.white,
            background: danger ? C.red : C.accent,
            border: `1px solid ${danger ? C.red : C.accent}`,
            borderRadius: 2,
          }}
        >
          {danger ? 'Yes, do it' : 'Confirm'}
        </button>
      </div>
    </div>
  </div>
)

const DeviceSetting: React.FC<DeviceSettingProps> = ({ variables, id, writer }) => {
  const { write, lastError } = writer
  const now = Date.now()

  /** Staged edits by slot, holding whole RAW register words. */
  const [edits, setEdits] = useState<Record<string, number>>({})
  /** The command row awaiting confirmation, if any. */
  const [pending, setPending] = useState<DeviceRow | null>(null)

  // A fresh reading drops staged edits: what is on screen must be what the
  // device just said, not an edit made against the previous word.
  useEffect(() => {
    setEdits({})
    setPending(null)
  }, [variables])

  const stage = useCallback((slot: string, raw: number) => {
    setEdits((e) => ({ ...e, [slot]: raw }))
  }, [])

  const clearStage = useCallback((slot: string) => {
    setEdits((e) => {
      const next = { ...e }
      delete next[slot]
      return next
    })
  }, [])

  /**
   * Write one register, claiming only the bits this row owns.
   *
   * `ownedMask` is passed for bit and packed rows and omitted for plain ones.
   * The narrowness matters: 43073 holds the EPM and FailSafe switches
   * alongside the one bit this screen shows, so a full-word write from here
   * would push a stale value over settings no row on this page can display.
   */
  const saveRegister = useCallback(
    async (
      address: number,
      value: number | undefined,
      read: number | undefined,
      ownedMask?: number,
    ): Promise<SaveResult> => {
      if (read === undefined) {
        return { ok: false, error: 'Not read — read the group first' }
      }
      const reg = byAddress.get(address)
      const out = await write({
        address,
        value: value ?? read,
        ...(ownedMask !== undefined ? { ownedMask } : {}),
        variableKey: reg?.key,
        id,
      })
      return { ok: out.ok, error: out.error }
    },
    [write, id],
  )

  /** One row of any kind. */
  const renderRow = (row: DeviceRow, last: boolean) => {
    const { address } = row
    const reg = byAddress.get(address)
    const rule = ruleFor(address)
    const read = rawOf(variables, reg?.key ?? '')
    const hasBeenRead = read !== undefined
    const slot = slotOf(row)
    const staged = edits[slot]
    const word = staged ?? read
    const ageMs = (() => {
      const t = stampOf(variables, reg?.key ?? '')
      return t === null ? undefined : Math.max(0, now - t)
    })()
    const testid = `row-${address}${row.packedField ? `-${row.packedField.replace(/\s+/g, '')}` : ''}${row.bitLabel ? '-bit' : ''}`

    /* ------------------------------------------------------- command row */
    if (row.kind === 'command') {
      const value = commandValueOf(row)
      const danger = isDestructive(address)

      /*
       * A command needs no reading to fire — it writes a fixed value and the
       * register's current contents are irrelevant. That is why these rows are
       * NOT gated on `hasBeenRead` the way every other row is: requiring a
       * read first would stop you restarting an HMI you cannot read.
       */
      return (
        <div key={`${address}:${row.label}`} data-testid={testid}>
          <SettingRowOne
            label={row.label}
            reg={address}
            description={
              value === null
                ? `${row.description} — DISABLED: the gospel no longer says what value fires this, and this screen will not guess one.`
                : `${row.description} Writes ${value} (${hex(value)}).`
            }
            current={hasBeenRead ? currentText(reg, read) : undefined}
            hasBeenRead
            ageMs={ageMs}
            readOnly={value === null}
            hint={[rule?.summary, (rule as any)?.destructive_explain]
              .filter(Boolean)
              .join('\n\n')}
            help={row.confirm}
            helpTitle={row.label}
            last={last}
            sendMode="immediate"
            editor={{
              kind: 'toggle',
              on: false,
              onChange: () => value !== null && setPending(row),
            }}
            /* Save opens the same confirm the toggle does. The write itself
               happens in `fireCommand`, once, after the question is answered —
               so there is no path from this row straight to the wire. */
            onSave={async () => {
              if (value === null) {
                return { ok: false, error: 'No command value in the gospel' }
              }
              setPending(row)
              return { ok: true }
            }}
          />
        </div>
      )
    }

    /* ---------------------------------------------------------- bit row */
    if (row.kind === 'bit') {
      const bit = bitOf(address, row.bitLabel ?? '')
      if (bit === null) {
        return (
          <div key={`${address}:${row.label}`} data-testid={testid}>
            <SettingRowOne
              label={row.label}
              reg={`${address} ?`}
              description={`No bit called "${row.bitLabel}" in the data for ${address}. The row is disabled rather than guessing a bit number.`}
              hasBeenRead={false}
              readOnly
              sendMode="immediate"
              editor={{ kind: 'toggle', on: false, onChange: () => {} }}
              last={last}
            />
          </div>
        )
      }
      const on = word !== undefined && isSet(word, bit)
      return (
        <div key={`${address}:${row.label}`} data-testid={testid}>
          <SettingRowOne
            label={row.label}
            reg={`${address} BIT${String(bit).padStart(2, '0')}`}
            description={row.description}
            current={word === undefined ? undefined : hex(word)}
            hasBeenRead={hasBeenRead}
            ageMs={ageMs}
            dirty={staged !== undefined && staged !== read}
            hint={rule?.summary}
            last={last}
            sendMode="immediate"
            editor={{
              kind: 'toggle',
              on,
              onChange: (next) =>
                stage(slot, next ? setBit(word ?? 0, bit) : clearBit(word ?? 0, bit)),
            }}
            onSave={async () => {
              const out = await saveRegister(
                address,
                staged,
                read,
                maskForBit(bit),
              )
              if (out.ok) clearStage(slot)
              return out
            }}
          />
        </div>
      )
    }

    /* ------------------------------------------------------- packed row */
    if (row.kind === 'packed') {
      const field = packedFieldOf(row)
      if (!field) {
        return (
          <div key={`${address}:${row.label}`} data-testid={testid}>
            <SettingRowOne
              label={row.label}
              reg={`${address} ?`}
              description={`No sub-field called "${row.packedField}" for ${address}. The row is disabled rather than guessing a byte.`}
              hasBeenRead={false}
              readOnly
              sendMode="immediate"
              editor={{ kind: 'select', value: '', options: [], onChange: () => {} }}
              last={last}
            />
          </div>
        )
      }
      const shown = word === undefined ? '' : unpackField(word, field)
      const options: RowOption[] = Object.entries(field.options)
        .map(([v, label]) => ({ value: Number(v), label }))
        .sort((a, b) => a.value - b.value)

      return (
        <div key={`${address}:${row.label}`} data-testid={testid}>
          <SettingRowOne
            label={row.label}
            reg={`${address} ${field.mask === 0x00ff ? 'low byte' : 'high byte'}`}
            description={row.description}
            current={
              word === undefined
                ? undefined
                : `${field.options[String(unpackField(word, field))] ?? unpackField(word, field)} · ${hex(word)}`
            }
            hasBeenRead={hasBeenRead}
            ageMs={ageMs}
            dirty={staged !== undefined && staged !== read}
            last={last}
            sendMode="immediate"
            editor={{
              kind: 'select',
              value: shown,
              options,
              /* The whole word goes into the shared slot, so the sibling byte's
                 row redraws from the same staged value rather than from a copy
                 that has not seen this edit. */
              onChange: (v) => stage(slot, packField(word ?? 0, field, v)),
            }}
            onSave={async () => {
              const out = await saveRegister(address, staged, read, field.mask)
              if (out.ok) clearStage(slot)
              return out
            }}
          />
        </div>
      )
    }

    /* -------------------------------------------------------- value row */
    const spec = editorFor(reg, {
      rule,
      overrideOptions: reg?.value_map
        ? optionsFromValueMap(reg.value_map)
        : undefined,
    })
    const scale = reg?.scale ?? 1

    const editor: RowEditor =
      spec.kind === 'select' || spec.kind === 'toggle'
        ? {
            kind: 'select',
            value: word ?? '',
            options: (spec.options ?? []) as RowOption[],
            onChange: (v) => stage(slot, v),
          }
        : {
            kind: 'number',
            value: word === undefined ? '' : rawToDisplay(word, scale),
            unit: reg?.units && reg.units.length <= 4 ? reg.units : '',
            onChange: (shown) => stage(slot, displayToRaw(shown, scale)),
          }

    return (
      <div key={`${address}:${row.label}`} data-testid={testid}>
        <SettingRowOne
          label={row.label}
          reg={address}
          description={row.description}
          current={hasBeenRead ? currentText(reg, read) : undefined}
          hasBeenRead={hasBeenRead}
          ageMs={ageMs}
          readOnly={spec.readOnly}
          dirty={staged !== undefined && staged !== read}
          hint={reg?.revision_note ?? row.description}
          last={last}
          sendMode="immediate"
          editor={editor}
          onSave={async () => {
            const out = await saveRegister(address, staged, read)
            if (out.ok) clearStage(slot)
            return out
          }}
        />
      </div>
    )
  }

  /** Fire the confirmed command. The only path from this screen to a command. */
  const fireCommand = async () => {
    const row = pending
    setPending(null)
    if (!row) return
    const value = commandValueOf(row)
    if (value === null) return
    const reg = byAddress.get(row.address)
    /*
     * No mask and no current value. A command register is not read-modify-write
     * — it takes a fixed magic value and acts on it, and reading it first would
     * be both pointless and, on a machine whose HMI has locked up, impossible.
     */
    await write({
      address: row.address,
      value,
      variableKey: reg?.key,
      id,
    })
  }

  const lastReadAt = (() => {
    const stamps = ADDRESSES.map((a) =>
      stampOf(variables, byAddress.get(a)?.key ?? ''),
    ).filter((t): t is number => t !== null)
    return stamps.length ? Math.max(...stamps) : null
  })()

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
      />

      <GroupPane>
        {SECTIONS.map((section, si) => {
          const rows = rowsOfSection(section.title)
          return (
            <React.Fragment key={section.title}>
              <GroupSubHeading
                title={section.title}
                note={section.note}
                tone={section.danger ? 'danger' : 'normal'}
                first={si === 0}
              />
              {rows.map((row, ri) => renderRow(row, ri === rows.length - 1))}
            </React.Fragment>
          )
        })}

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

      {pending && (
        <ConfirmSheet
          title={pending.label}
          body={pending.confirm ?? 'Run this command?'}
          danger={isDestructive(pending.address)}
          onConfirm={fireCommand}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}

export default DeviceSetting
