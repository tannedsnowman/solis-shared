/**
 * The gospel decides which editor a register gets. Nothing else does.
 *
 * Order, highest first:
 *   1. rules file says `kind: 'bitfield'`  -> the bitwise layout
 *   2. this app knows the word is packed   -> two or more sub-field selects
 *   3. record has a `value_map`            -> dropdown built FROM the map
 *   4. a caller passed an override list    -> dropdown, until the enum lands
 *   5. numeric kind + scale + units        -> number input with a unit suffix
 *
 * An override only wins over the numeric fallback, never over a real
 * `value_map` — the map is the source of truth and the hand-written tables in
 * the pages are a stopgap.
 */
import type { GospelRegister } from '../gospel/gospel'
import type { RegisterRule } from './bitRules'
import { packedFieldsFor, PackedField } from './packedFields'
// One definition of scale->decimals, in the decoder. This file used to
// carry a third (string-slicing) implementation; phase 2 deleted it.
import { decimalsForScale } from '../decode/primitives'

export type EditorKind = 'bitfield' | 'packed' | 'select' | 'number' | 'toggle'

export interface EditorOption {
  /** Raw register value. */
  value: number
  label: string
}

export interface EditorSpec {
  kind: EditorKind
  /** Present for `select`. Built from value_map, or from an override. */
  options?: EditorOption[]
  /** Present for `packed`. */
  fields?: PackedField[]
  /** Present for `number`: symbol only, scale already stripped. */
  units?: string
  /** Present for `number`: multiply raw by this to get the shown value. */
  scale?: number
  /** Decimal places implied by the scale. */
  decimals?: number
  /** True when the rules file forbids writing. */
  readOnly: boolean
  /** Where the options came from — shown as a hint, and useful in tests. */
  source: 'rules' | 'packed' | 'value_map' | 'override' | 'numeric'
}


/** A gospel `value_map` becomes dropdown options, in numeric key order. */
export function optionsFromValueMap(
  valueMap: Record<string, string>,
): EditorOption[] {
  return Object.keys(valueMap)
    // `!`: k came from Object.keys(valueMap), so the lookup always hits.
    .map((k) => ({ value: Number(k), label: valueMap[k]! }))
    .sort((a, b) => a.value - b.value)
}

/**
 * A two-entry value_map that reads like on/off deserves the toggle chip rather
 * than a two-item dropdown. Purely cosmetic — the written values are the same.
 */
const ON_OFF = /^(on|off|enable[d]?|disable[d]?|yes|no)$/i

export function looksLikeToggle(options: EditorOption[]): boolean {
  return (
    options.length === 2 &&
    options.every((o) => ON_OFF.test(o.label.trim()))
  )
}

export interface EditorContext {
  /** From `rulesByAddress[String(address)]`, if any. */
  rule?: RegisterRule
  /**
   * Hand-written option table from the existing page, used ONLY while the
   * register has no `value_map`. Delete the caller's table once the enum lands.
   */
  overrideOptions?: EditorOption[]
  /** Set false to suppress the toggle shorthand and always show a dropdown. */
  allowToggle?: boolean
}

export function editorFor(
  reg: GospelRegister | undefined,
  ctx: EditorContext = {},
): EditorSpec {
  const readOnly = ctx.rule?.write === 'read_only'

  if (ctx.rule?.kind === 'bitfield') {
    return { kind: 'bitfield', readOnly, source: 'rules' }
  }

  if (reg) {
    const packed = packedFieldsFor(reg.address_start)
    if (packed) {
      return { kind: 'packed', fields: packed, readOnly, source: 'packed' }
    }

    if (reg.value_map) {
      const options = optionsFromValueMap(reg.value_map)
      const kind =
        ctx.allowToggle !== false && looksLikeToggle(options) ? 'toggle' : 'select'
      return { kind, options, readOnly, source: 'value_map' }
    }
  }

  if (ctx.overrideOptions && ctx.overrideOptions.length) {
    return {
      kind: 'select',
      options: ctx.overrideOptions,
      readOnly,
      source: 'override',
    }
  }

  const scale = reg?.scale ?? 1
  return {
    kind: 'number',
    units: reg?.units ?? '',
    scale,
    decimals: decimalsForScale(scale),
    readOnly,
    source: 'numeric',
  }
}

/** Raw register value -> what the user sees in a number box. */
export const rawToDisplay = (raw: number, scale: number): number =>
  Number((raw * scale).toFixed(decimalsForScale(scale)))

/** What the user typed -> the raw value to write. */
export const displayToRaw = (shown: number, scale: number): number =>
  Math.round(shown / (scale || 1))
