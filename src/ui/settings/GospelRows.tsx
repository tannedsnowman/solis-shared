/**
 * Generic settings rows, entirely driven by the gospel map.
 *
 * A caller names registers; this decides for each one whether it is a
 * dropdown, a number box with a unit, a toggle or a packed pair, using
 * `editorFor`. No register knowledge is written here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { byAddress, byKey, GospelRegister } from '../../gospel/gospel'
import { displayValue } from '../../gospel/decodeGospel'
import {
  EditorOption,
  editorFor,
  optionsFromValueMap,
  rawToDisplay,
  displayToRaw,
} from '../../settings/editorFor'
import { decimalsForScale } from '../../decode/primitives'
import { packedFieldsFor, packField, unpackField } from '../../settings/packedFields'
import type { HybridWriter } from './hybridWrite'
import { rulesByAddress } from '../../gospel/gospel'
import type { RegisterRule } from '../../settings/index'

/*
 * The write rule for an address, straight off the shared map.
 *
 * The extension's `useRegisterWrite` exports an identical one-liner, and this
 * is deliberately a second copy rather than an import of it: that file is the
 * extension's TRANSPORT and a shared card must not reach into it. The DATA
 * this reads -- `rulesByAddress` -- is already shared, so both spellings
 * answer from the same map and cannot disagree.
 */
export const ruleFor = (address: number): RegisterRule | undefined =>
  // Rules keys are STRINGS and addresses are ABSOLUTE. Never add a 43000 base.
  rulesByAddress[String(address)]
import { ownedMask } from '../../settings/bitRules'
import { SettingRow, SettingsCard } from './SettingsShell'
import { visibleCards } from './tabModel'

/** One register the caller wants shown. */
export interface RowSpec {
  /** Gospel key ("battery2OverDischargeSoc") or absolute address. */
  key?: string
  address?: number
  /** Override the map's name. */
  label?: string
  /**
   * Hand-written options from the page, used ONLY while the register has no
   * `value_map` in the gospel. Delete the caller's table once the enum lands.
   */
  overrideOptions?: EditorOption[]
}

export interface CardSpec {
  title: string
  note?: string
  rows: RowSpec[]
  /**
   * Inner-tab this card belongs to. Untagged cards fall into the `ALL` group,
   * so every existing page keeps rendering as one list.
   */
  tab?: string
}

export interface GospelRowsProps {
  cards: CardSpec[]
  /** The scraped/read register values, keyed by gospel key. */
  variables: any
  id: string
  /** Reported upward so the header can show the dirty count. */
  onDirtyChange?: (count: number) => void
  /** Increment to make the pane re-read `variables` and drop edits. */
  revertToken?: number
  /** Increment to make the pane write every dirty row. */
  writeAllToken?: number
  /**
   * Inner tab to RENDER. Only rendering is filtered: edits, the dirty count
   * and WRITE ALL always span every card, so an edit hidden on another tab is
   * neither lost on switch nor skipped on write.
   */
  activeTab?: string
  /** Raw edit map, so a page can show a per-tab dirty badge. */
  onEditsChange?: (edits: Record<string, number>) => void
  /**
   * Where writes go.
   *
   * REQUIRED HERE, unlike in the extension's own copy. A shared card has no
   * app to fall back to: the extension hands in `useRegisterWrite`, its
   * Modbus-over-`sendModbusCommand` transport, and SolisConnect hands in its
   * own over the Tauri serial bridge. This file must not know which it got.
   */
  writer: HybridWriter
}

interface Resolved {
  reg: GospelRegister | undefined
  address: number
  key: string
  label: string
  spec: RowSpec
}

function resolve(spec: RowSpec): Resolved | null {
  const reg =
    spec.address !== undefined
      ? byAddress.get(spec.address)
      : spec.key
        ? byKey.get(spec.key)
        : undefined
  const address = spec.address ?? reg?.address_start
  if (address === undefined) return null
  return {
    reg,
    address,
    key: reg?.key ?? spec.key ?? String(address),
    label: spec.label ?? reg?.name ?? spec.key ?? String(address),
    spec,
  }
}

/** Raw value the app last read for a register, or undefined when unread. */
/*
 * `rawOf` and `currentText` MOVED to `@solis/shared/ui`.
 *
 * Both are pure -- a store entry and a register record in, text out -- so
 * they belong beside the cards rather than in this file, which is welded to
 * the hybrid map and to `useRegisterWrite`. The PV settings screens import
 * them from the shared package direct; this re-export keeps the hybrid
 * callers below, and the `./GospelRows` imports elsewhere, working unchanged.
 *
 * Note `rawOf` is store-shape logic, NOT key-map logic: it is handed the
 * store to read. Which store, and under which key, stays each screen's own
 * business -- which is why the PV screens can share it at all.
 */
import { rawOf, currentText } from './reading'
export { rawOf, currentText }

/** Prose worth surfacing: the register's history and the rule's explanation. */
export function hintFor(
  reg: GospelRegister | undefined,
  address: number,
): string {
  const rule = ruleFor(address)
  return [reg?.revision_note, rule?.summary, rule?.explain, rule?.write_explain]
    .filter(Boolean)
    .join('\n\n')
}

const GospelRows: React.FC<GospelRowsProps> = ({
  cards,
  variables,
  id,
  onDirtyChange,
  revertToken = 0,
  writeAllToken = 0,
  activeTab,
  onEditsChange,
  writer,
}) => {
  const { write } = writer

  const resolved = useMemo(
    () =>
      cards.map((c) => ({
        ...c,
        rows: c.rows.map(resolve).filter((r): r is Resolved => r !== null),
      })),
    [cards],
  )

  /** What the pane draws. Filtering happens here and NOWHERE else. */
  const drawn = useMemo(
    () => visibleCards(resolved, activeTab),
    [resolved, activeTab],
  )

  // Editing state keyed by "address", or "address:fieldIndex" for packed words.
  // Deliberately NOT reset when `activeTab` changes: switching tabs is a view
  // change, not a revert.
  const [edits, setEdits] = useState<Record<string, number>>({})

  useEffect(() => {
    setEdits({})
  }, [revertToken, variables])

  const dirtyCount = Object.keys(edits).length
  useEffect(() => {
    onDirtyChange?.(dirtyCount)
  }, [dirtyCount, onDirtyChange])

  useEffect(() => {
    onEditsChange?.(edits)
  }, [edits, onEditsChange])

  const setEdit = (slot: string, v: number) =>
    setEdits((e) => ({ ...e, [slot]: v }))

  const clearEdits = (slots: string[]) =>
    setEdits((e) => {
      const next = { ...e }
      for (const s of slots) delete next[s]
      return next
    })

  /** The word to write for one register, folding in every packed edit. */
  const wordFor = (
    r: Resolved,
    raw: number | undefined,
    current: Record<string, number>,
  ): number | null => {
    const fields = packedFieldsFor(r.address)
    if (fields) {
      let word = raw ?? 0
      let touched = false
      fields.forEach((f, i) => {
        const v = current[`${r.address}:${i}`]
        if (v !== undefined) {
          word = packField(word, f, v)
          touched = true
        }
      })
      return touched ? word : null
    }
    const v = current[String(r.address)]
    return v === undefined ? null : v
  }

  const writeRow = useCallback(
    async (r: Resolved, current: Record<string, number>) => {
      const raw = rawOf(variables, r.key)
      const word = wordFor(r, raw, current)
      if (word === null) return
      const rule = ruleFor(r.address)
      const out = await write({
        address: r.address,
        value: word,
        currentValue: raw,
        // A bitfield register owns only the bits its rule describes; anything
        // else owns the whole word. Only consulted when the rule says rmw.
        ownedMask: rule?.kind === 'bitfield' ? ownedMask(rule) : 0xffff,
        variableKey: r.key,
        id,
      })
      if (out.ok) {
        const fields = packedFieldsFor(r.address)
        clearEdits(
          fields ? fields.map((_, i) => `${r.address}:${i}`) : [String(r.address)],
        )
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variables, id, write],
  )

  // WRITE ALL: every dirty row, in card order, one register at a time. A batch
  // must not run twice, so the token is remembered rather than compared.
  // `resolved`, not `shown` — WRITE ALL must reach the tabs nobody is looking at.
  const allRows = useMemo(() => resolved.flatMap((c) => c.rows), [resolved])
  const lastBatch = useRef(0)
  useEffect(() => {
    if (!writeAllToken || writeAllToken === lastBatch.current) return
    lastBatch.current = writeAllToken
    const snapshot = edits
    let cancelled = false
    const run = async () => {
      for (const r of allRows) {
        if (cancelled) return
        // eslint-disable-next-line no-await-in-loop
        await writeRow(r, snapshot)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writeAllToken])

  return (
    <>
      {drawn.map((card) => (
        <SettingsCard key={card.title} title={card.title} note={card.note}>
          {card.rows.flatMap((r, ri) => {
            const last = ri === card.rows.length - 1
            const raw = rawOf(variables, r.key)
            const rule = ruleFor(r.address)
            const editor = editorFor(r.reg, {
              rule,
              overrideOptions: r.spec.overrideOptions,
            })
            const hint = hintFor(r.reg, r.address)
            const current = currentText(r.reg, raw)
            const fields = editor.fields

            if (editor.kind === 'packed' && fields) {
              return fields.map((f, fi) => {
                const slot = `${r.address}:${fi}`
                const dirty = edits[slot] !== undefined
                const value =
                  edits[slot] ?? (raw === undefined ? '' : unpackField(raw, f))
                const currentLabel =
                  raw === undefined
                    ? 'not read'
                    : (f.options[String(unpackField(raw, f))] ??
                      String(unpackField(raw, f)))
                return (
                  <SettingRow
                    key={slot}
                    label={f.name}
                    reg={r.address}
                    current={currentLabel}
                    dirty={dirty}
                    last={last && fi === fields.length - 1}
                    readOnly={editor.readOnly}
                    hint={hint}
                    onSet={() => writeRow(r, edits)}
                    editor={{
                      kind: 'select',
                      value: value as number | '',
                      options: optionsFromValueMap(f.options),
                      onChange: (v) => setEdit(slot, v),
                    }}
                  />
                )
              })
            }

            const slot = String(r.address)
            const dirty = edits[slot] !== undefined
            const options = editor.options

            /*
             * A toggle needs TWO codes. `options[1]` is only a valid default
             * when there are two, and a `value_map` carrying one entry is not
             * hypothetical -- so a toggle that cannot name both codes falls
             * through to the normal editor below, which renders any number of
             * options as a select.
             *
             * The extension never noticed because it compiles without
             * `noUncheckedIndexedAccess`; there the missing option was
             * `undefined` and the row threw on `.value` at render time.
             */
            const onOpt =
              options?.find((o) => /^(on|enable[d]?|yes)$/i.test(o.label.trim())) ??
              options?.[1]
            const offOpt =
              options?.find((o) => /^(off|disable[d]?|no)$/i.test(o.label.trim())) ??
              options?.[0]

            if (editor.kind === 'toggle' && options && onOpt && offOpt) {
              // Which code means "on" comes from the map's labels, never from
              // an assumption about bit 0.
              const value = edits[slot] ?? raw
              return [
                <SettingRow
                  key={slot}
                  label={r.label}
                  reg={r.address}
                  current={current}
                  dirty={dirty}
                  last={last}
                  readOnly={editor.readOnly}
                  hint={hint}
                  onSet={() => writeRow(r, edits)}
                  editor={{
                    kind: 'toggle',
                    on: value === onOpt.value,
                    onToggle: () =>
                      setEdit(
                        slot,
                        value === onOpt.value ? offOpt.value : onOpt.value,
                      ),
                  }}
                />,
              ]
            }

            if (editor.kind === 'select' && options) {
              const value = edits[slot] ?? (raw === undefined ? '' : raw)
              return [
                <SettingRow
                  key={slot}
                  label={r.label}
                  reg={r.address}
                  current={current}
                  dirty={dirty}
                  last={last}
                  readOnly={editor.readOnly}
                  hint={hint}
                  onSet={() => writeRow(r, edits)}
                  editor={{
                    kind: 'select',
                    value: value as number | '',
                    options,
                    onChange: (v) => setEdit(slot, v),
                  }}
                />,
              ]
            }

            const scale = editor.scale ?? 1
            const shown =
              edits[slot] !== undefined
                ? rawToDisplay(edits[slot], scale)
                : raw === undefined
                  ? ''
                  : rawToDisplay(raw, scale)
            return [
              <SettingRow
                key={slot}
                label={r.label}
                reg={r.address}
                current={current}
                dirty={dirty}
                last={last}
                readOnly={editor.readOnly}
                hint={hint}
                onSet={() => writeRow(r, edits)}
                editor={{
                  kind: 'number',
                  value: shown as number | '',
                  unit: editor.units ?? '',
                  onChange: (v) => setEdit(slot, displayToRaw(v, scale)),
                }}
              />,
            ]
          })}
        </SettingsCard>
      ))}
    </>
  )
}

export default GospelRows
