/**
 * Battery Setting — one flat column, in the order an installer works.
 *
 * Replaces the two-column card grid of five banded cards. That put a
 * `1fr 1fr` grid inside an `overflowY: auto` box: grid tracks stretch to the
 * tallest cell, so uneven cards computed a height that fought the scroller,
 * and the labels clipped mid-word. The look and the scroll were the same bug.
 * `GroupPane` is a flex column, so a row's height is its own business.
 *
 * GROUPED BY JOB, NOT BY REGISTER
 * -------------------------------
 * The previous build put everything living in 43110 on one screen because it
 * shares a word. That is backwards — battery healing has nothing to do with
 * the storage work mode. Wake-up and healing (43110) and battery saving
 * (43284) are HERE, beside the battery they act on, because that is where the
 * installer looks. `ownedMask` already lets one bit be written from any
 * screen, so sharing a word forces nothing about which page owns the switch.
 *
 * NO WRITE BEFORE A READ
 * ----------------------
 * Every row passes `hasBeenRead`, and an unread row is un-editable. This
 * matters most on the two bit rows: their writes are read-modify-write, so
 * with no current word the write layer would have to guess the fifteen bits it
 * does not own and would silently clear whatever the installer had set.
 * `useRegisterWrite` refuses at that point, but a disabled editor is the
 * honest signal — an error after the click is not.
 *
 * NO SUB-HEADINGS INSIDE A TAB. The list stays flat; the tab strip is the
 * only navigation on the page.
 *
 * TABS ARE LENSES, NOT SECTIONS
 * -----------------------------
 * ALL is the default and holds the whole list. SOC, VOLTS and CURRENTS pull
 * out the rows of one kind, and a row appearing on two tabs is DELIBERATE: it
 * is the same `BatteryRow`, so `slotOf` gives it one staged edit and one Save
 * whichever tab it is being looked at through. Switching tab mid-edit cannot
 * lose the edit, and cannot send it twice.
 *
 * The register maths lives in `batterySetupModel.ts` and is proven in its
 * test. This file draws it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { HybridWriter } from '../settings/hybridWrite'
import { currentText, rawOf } from '../settings/GospelRows'
import {
  GroupPane,
  GroupStatus,
  RowEditor,
  RowOption,
  SettingRowOne,
} from '../settings/GroupView'
import {
  displayToRaw,
  editorFor,
  optionsFromValueMap,
  rawToDisplay,
} from '../../settings/editorFor'
import { ruleFor } from '../settings/GospelRows'
import { isSet, ownedMask } from '../../settings/bitRules'
import { byAddress } from '../../gospel/gospel'
import { C, chip } from '../settings/theme'
import {
  BATTERY_2_MODEL_SOURCE,
  BATTERY_TABS,
  BatteryRow,
  BatteryTabId,
  CONNECTION_MODE,
  FOLLOW_BATTERY_1,
  batteryAddresses,
  bitOf,
  dirtyTabs,
  dropHiddenRowEdits,
  isFollowingBattery1,
  rowsForTab,
  slotOf,
  wordForBit,
} from '../settings/batterySetupModel'

interface BatterySetupProps {
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
 * Registers this page reads, for the range-button row's highlight.
 *
 * Covers EVERY row, including the battery 2 rows that can be hidden: 43802
 * cannot be known to read 3 until the block holding it has been fetched.
 */
export const ADDRESSES = batteryAddresses()

/** Epoch ms of a reading, or null when the store carries no stamp. */
function stampOf(variables: any, key: string): number | null {
  const raw = variables?.[key]?.lastUpdated
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * One row of the flat list, value or bit.
 *
 * Both kinds are drawn by the same component because the screen is one list:
 * a separate BitRow would drift into its own layout, and the two would stop
 * looking like neighbours. What differs is only how a value is read out of the
 * word and what gets written back, which is a handful of lines below.
 *
 * Every row is `sendMode: 'immediate'` — its own Save, fired now, green on ok
 * and red on fail. There is no batch on this screen: these are independent
 * hardware limits, not a block of time slots.
 */
const BatteryRowView: React.FC<{
  row: BatteryRow
  variables: any
  id: string
  staged: number | undefined
  onStage: (raw: number) => void
  onSaved: () => void
  last?: boolean
  /** Threaded down from the page, so one seam serves every row. */
  writer: HybridWriter
}> = ({ row, variables, id, staged, onStage, onSaved, last, writer }) => {
  const { address, bitLabel, activeLow = false } = row
  const reg = byAddress.get(address)
  const rule = ruleFor(address)
  const word = rawOf(variables, reg?.key ?? '')
  const { write } = writer

  const bit = bitLabel ? bitOf(rule, bitLabel) : null

  /*
   * A bit row whose label the rules file no longer carries is REPORTED, never
   * guessed at. `bitOf` returns null rather than a fallback number for exactly
   * this case — flipping bit 3 on a guess is how the wrong switch gets thrown.
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

  /* ------------------------------------------------------------ bit row */

  if (bit !== null) {
    /*
     * The ONE inversion. `on` is what the user means; `isSet` is what the wire
     * holds, and for an active-low bit those are opposites. Everything below
     * this line speaks the user's language, and `flip` inverts back exactly
     * once on the way out. A second inversion anywhere would look right on
     * screen and write the opposite of what the toggle says.
     */
    const wire = hasBeenRead && isSet(word!, bit)
    const read = activeLow ? !wire : wire
    const on = staged !== undefined ? (activeLow ? !isSet(staged, bit) : isSet(staged, bit)) : read

    const save = async () => {
      if (word === undefined) return { ok: false, error: 'not read' }
      const value = staged ?? wordForBit(rule!, word, bit, activeLow ? !on : on)
      const out = await write({
        address,
        value,
        // read_modify_write: this row owns only the bits the rule names, so
        // grid charge, time-of-use and the work mode survive untouched.
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
        reg={`${address} BIT${String(bit).padStart(2, '0')}${activeLow ? ' active-low' : ''}`}
        description={row.description}
        current={hasBeenRead ? (read ? 'on' : 'off') : undefined}
        hasBeenRead={hasBeenRead}
        ageMs={ageMs}
        hint={[rule?.summary, rule?.write_explain].filter(Boolean).join('\n\n')}
        sendMode="immediate"
        /* A staged word that lands on the state already read is NOT an
           edit. `staged !== undefined` marked the row dirty for a toggle
           flipped and flipped back, so the row offered a Save that would
           write the word it had just read. Compare the MEANING, not the
           presence of a staged word -- the rule every other screen uses. */
        dirty={staged !== undefined && on !== read}
        editor={{
          kind: 'toggle',
          on,
          onChange: (next) =>
            onStage(wordForBit(rule!, word ?? 0, bit, activeLow ? !next : next)),
        }}
        onSave={save}
        last={last}
      />
    )
  }

  /* ---------------------------------------------------------- value row */

  /*
   * 43803 has no `value_map` of its own but uses battery 1's numbering, so it
   * borrows 43009's map. `editorFor` decides everything else — dropdown from a
   * real map, dropdown from an override list, or a number box with its unit.
   */
  const borrowed =
    address === 43803
      ? byAddress.get(BATTERY_2_MODEL_SOURCE)?.value_map ?? undefined
      : undefined

  const spec = editorFor(reg, {
    rule,
    overrideOptions: borrowed
      ? optionsFromValueMap(borrowed)
      : row.overrideOptions,
    // Always a dropdown, never the two-chip toggle shorthand: a value row on
    // this screen is a code, and a code shows its number.
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

  return (
    <SettingRowOne
      label={row.label}
      reg={address}
      description={row.description}
      current={hasBeenRead ? currentText(reg, word) : undefined}
      hasBeenRead={hasBeenRead}
      ageMs={ageMs}
      readOnly={spec.readOnly}
      hint={reg?.revision_note ?? row.description}
      sendMode="immediate"
      /* Staged-equals-read is not an edit -- see the bit row above. */
      dirty={staged !== undefined && staged !== word}
      editor={editor}
      onSave={save}
      last={last}
    />
  )
}

const BatterySetup: React.FC<BatterySetupProps> = ({ variables, id, writer }) => {
  /** Staged edits, keyed by address, holding RAW register values. */
  const [edits, setEdits] = useState<Record<string, number>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTab] = useState<BatteryTabId>('battery')

  const connectionKey = byAddress.get(CONNECTION_MODE)?.key ?? ''
  const connectionRaw = rawOf(variables, connectionKey)

  /* A staged edit counts here BEFORE it is read back from `variables`, so the
     battery 2 rows vanish the moment the user picks 1Batt1DC rather than only
     after the write lands. */
  const stagedConnection = edits[String(CONNECTION_MODE)]
  const effectiveConnection = stagedConnection ?? connectionRaw

  /* 43814, read the same way and for the same reason: switching follow on
     should hide battery 2's limits as the dropdown is changed, not one
     round-trip later. */
  const followKey = byAddress.get(FOLLOW_BATTERY_1.address)?.key ?? ''
  const followRaw = rawOf(variables, followKey)
  const effectiveFollow = edits[String(FOLLOW_BATTERY_1.address)] ?? followRaw

  const rows = useMemo(
    () => rowsForTab(effectiveConnection, tab, effectiveFollow),
    [effectiveConnection, tab, effectiveFollow],
  )

  const stage = useCallback((slot: string, raw: number) => {
    setEdits((e) => ({ ...e, [slot]: raw }))
  }, [])

  /* A successful write makes the staged value the truth, so the row stops
     showing as dirty. The reading itself is marked stale by `hideValue` inside
     the write, which is what makes the row re-read. */
  const clearStage = useCallback((slot: string) => {
    setEdits((e) => {
      if (e[slot] === undefined) return e
      const next = { ...e }
      delete next[slot]
      return next
    })
  }, [])

  /*
   * Declaring a single battery drops any battery 2 edit still sitting unsent,
   * and says so. The alternative — keeping it hidden — means a later Save
   * sends a current limit for a battery the user has just told us is not
   * fitted, with nothing on screen having mentioned it. That is the silent
   * write this screen exists to prevent.
   */
  useEffect(() => {
    const { edits: kept, dropped } = dropHiddenRowEdits(
      edits,
      effectiveConnection,
      effectiveFollow,
    )
    if (!dropped.length) return
    setEdits(kept)
    const why =
      effectiveConnection === 3
        ? 'this inverter is set to a single battery (1Batt1DC)'
        : 'battery 2 is set to follow battery 1, so its own limits are inert'
    setNotice(
      `${dropped.length} unsent Battery 2 ${dropped.length === 1 ? 'edit was' : 'edits were'} dropped — ${why}.`,
    )
  }, [edits, effectiveConnection, effectiveFollow])

  // The notice is about one decision; a later change of mind clears it.
  useEffect(() => {
    if (effectiveConnection !== 3 && !isFollowingBattery1(effectiveFollow)) {
      setNotice(null)
    }
  }, [effectiveConnection, effectiveFollow])

  /*
   * Which tabs hold unsent edits, for the dots.
   *
   * `isEdited` lives here, not in the model, because deciding it needs the
   * store: a bit row is edited when its MEANING differs from what was read
   * (active-low included), a value row when the staged word differs. Same
   * test the rows themselves use to draw the dirty mark, so a dot and a row
   * can never disagree.
   */
  const dirty = useMemo(
    () =>
      dirtyTabs(edits, effectiveConnection, effectiveFollow, (row, staged) => {
        const reg = byAddress.get(row.address)
        const word = rawOf(variables, reg?.key ?? '')
        if (word === undefined) return false
        if (!row.bitLabel) return staged !== word
        const rule = ruleFor(row.address)
        const bit = bitOf(rule, row.bitLabel)
        if (bit === null) return false
        return isSet(staged, bit) !== isSet(word, bit)
      }),
    [edits, effectiveConnection, effectiveFollow, variables],
  )

  /*
   * The freshest reading on the page, for the header.
   *
   * Every other screen in the rail carries `GroupStatus`; this one did not, so
   * it was the one settings screen that never said how old its numbers were.
   * Built from ADDRESSES, so it covers the rows the current tab is hiding too
   * -- the block was read as a block, and its age does not change with a lens.
   */
  const lastReadAt = useMemo(() => {
    const stamps = ADDRESSES.map((a) =>
      stampOf(variables, byAddress.get(a)?.key ?? ''),
    ).filter((t): t is number => t !== null)
    return stamps.length ? Math.max(...stamps) : null
  }, [variables])

  return (
    /*
     * The same flex column every sibling screen has. A bare fragment left the
     * tab strip and the pane as loose children of whatever mounted this, so
     * `GroupPane`'s `flex: 1; minHeight: 0` had no column to size against.
     */
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
      <div
        data-testid="battery-tabs"
        style={{
          flex: 'none',
          display: 'flex',
          gap: 4,
          padding: '5px 6px',
          background: C.headBg,
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        {BATTERY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={t.id === tab}
            onClick={() => setTab(t.id)}
            style={{
              ...chip(t.id === tab),
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>{t.label}</span>
            {/* Loud on an INACTIVE tab: on a screen of lenses, an edit you
                cannot currently see is the one worth warning about. */}
            {dirty.has(t.id) && (
              <span
                aria-label="unsent edits"
                data-testid={`battery-tab-dirty-${t.id}`}
                style={{
                  flex: 'none',
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  background: t.id === tab ? C.white : C.accent,
                }}
              />
            )}
          </button>
        ))}
      </div>
      <GroupPane>
      {notice && (
        <div
          data-testid="battery-notice"
          style={{
            flex: 'none',
            padding: '5px 8px',
            font: '500 10px/1.4 Helvetica,Arial',
            color: C.ink,
            background: C.headBg,
            borderBottom: `1px solid ${C.line}`,
          }}
        >
          {notice}
        </div>
      )}
      {/* A lens with nothing in it says so. Rendering an empty pane would
          read as "this screen failed to load" rather than "these rows are
          hidden because this inverter has one battery". */}
      {rows.length === 0 && (
        <div
          data-testid="battery-empty"
          style={{
            flex: 'none',
            padding: '10px 8px',
            font: '500 10px/1.4 Helvetica,Arial',
            color: C.mute,
          }}
        >
          No rows on this tab for this inverter.
        </div>
      )}
      {rows.map((row, i) => {
        /* `slotOf`, not the address: 43110 carries two rows here (wake-up and
           healing), and an address-keyed slot would make them share one staged
           word — staging either would dirty both, and saving one would send
           the other's edit. */
        const slot = slotOf(row)
        return (
          <BatteryRowView
            key={slot}
            row={row}
            variables={variables}
            id={id}
            staged={edits[slot]}
            onStage={(raw) => stage(slot, raw)}
            onSaved={() => clearStage(slot)}
            last={i === rows.length - 1}
            writer={writer}
          />
        )
      })}
      </GroupPane>
    </div>
  )
}

export default BatterySetup
