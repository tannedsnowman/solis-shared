/**
 * Turn `hybrid_rules.json` bit-group vocabulary into concrete bit operations.
 *
 * Every rule here is read from the data. No bit number is written in this
 * file: 43110's exclusive group happens to be bits 0/2/6/9 today and could be
 * corrected tomorrow, and this code must follow it without being edited.
 */

export type BitGroupRule =
  | 'exactly_one'
  | 'at_most_one'
  | 'mutually_exclusive'
  | 'mutually_exclusive_with_register'
  | string

export interface BitGroup {
  name: string
  rule: BitGroupRule
  bits: number[]
  explain?: string
  bit_labels?: Record<string, string>
}

export type WriteMode =
  | 'read_modify_write'
  | 'read_only'
  | 'plain'
  | 'write_together'
  | 'unlock_code'
  | 'single_register_only'
  | string

export interface RegisterRule {
  title?: string
  kind?: 'bitfield' | 'enum' | 'value' | 'unlock' | 'destructive' | string
  summary?: string
  explain?: string
  write?: WriteMode
  write_explain?: string
  bit_groups?: BitGroup[]
  independent_bits?: number[]
  independent_bit_labels?: Record<string, string>
  independent_explain?: string
  related_registers?: number[]
  related_explain?: string
  confidence?: string
  note?: string
}

export interface BitDescriptor {
  bit: number
  label: string
  /** The group that owns it, or null for a free toggle. */
  group: BitGroup | null
}

const WORD = 0xffff

export const isSet = (word: number, bit: number): boolean =>
  ((word >> bit) & 1) === 1

export const setBit = (word: number, bit: number): number =>
  (word | (1 << bit)) & WORD

export const clearBit = (word: number, bit: number): number =>
  (word & ~(1 << bit)) & WORD

/**
 * The group whose `rule` behaves like a selector — one member on at a time.
 * `exactly_one` and `at_most_one` differ only in whether the last one may be
 * turned back off.
 */
export const isSelectorGroup = (g: BitGroup): boolean =>
  g.rule === 'exactly_one' || g.rule === 'at_most_one'

/** Groups whose bits belong to a mode selector, in rule order. */
export function selectorGroups(rule: RegisterRule): BitGroup[] {
  return (rule.bit_groups ?? []).filter(isSelectorGroup)
}

/** Bits the rule calls free toggles, plus any group member not in a selector. */
export function modifierBits(rule: RegisterRule): BitDescriptor[] {
  const inSelector = new Set(selectorGroups(rule).flatMap((g) => g.bits))
  const out: BitDescriptor[] = []
  const seen = new Set<number>()

  for (const bit of rule.independent_bits ?? []) {
    if (inSelector.has(bit) || seen.has(bit)) continue
    seen.add(bit)
    out.push({
      bit,
      label: rule.independent_bit_labels?.[String(bit)] ?? `BIT${bit}`,
      group: null,
    })
  }
  // A bit in a non-selector group (e.g. mutually_exclusive) is still a free
  // checkbox in the UI — its group only constrains what happens when it goes on.
  for (const g of rule.bit_groups ?? []) {
    if (isSelectorGroup(g)) continue
    for (const bit of g.bits) {
      if (inSelector.has(bit) || seen.has(bit)) continue
      seen.add(bit)
      out.push({
        bit,
        label: g.bit_labels?.[String(bit)] ?? `BIT${bit}`,
        group: g,
      })
    }
  }
  return out.sort((a, b) => a.bit - b.bit)
}

/** Bits of the selector groups, as buttons. */
export function exclusiveBits(rule: RegisterRule): BitDescriptor[] {
  return selectorGroups(rule)
    .flatMap((g) =>
      g.bits.map((bit) => ({
        bit,
        label: g.bit_labels?.[String(bit)] ?? `BIT${bit}`,
        group: g,
      })),
    )
    .sort((a, b) => a.bit - b.bit)
}

/** Label for any bit the rule knows about; falls back to the map's bit_flags. */
export function labelForBit(
  rule: RegisterRule | undefined,
  bit: number,
  bitFlags?: string[] | null,
): string | null {
  if (rule) {
    for (const g of rule.bit_groups ?? []) {
      const l = g.bit_labels?.[String(bit)]
      if (l) return l
    }
    const l = rule.independent_bit_labels?.[String(bit)]
    if (l) return l
  }
  const flag = bitFlags?.[bit]
  return flag && flag !== 'Reserve' ? flag : null
}

/**
 * Apply a user's intent to one bit, honouring every rule the register carries.
 *
 * - a selector bit turning on clears its siblings (`exactly_one`,
 *   `at_most_one`)
 * - a selector bit turning off is refused under `exactly_one` — one is always
 *   selected — and allowed under `at_most_one`
 * - any bit turning on clears its partners in every `mutually_exclusive` group
 *   it belongs to
 *
 * Returns the new word. Bits outside the rules are never touched.
 */
export function applyBitChange(
  rule: RegisterRule,
  word: number,
  bit: number,
  turnOn: boolean,
): number {
  const groups = rule.bit_groups ?? []
  const owningSelector = groups.find((g) => isSelectorGroup(g) && g.bits.includes(bit))

  let next = word

  if (owningSelector) {
    if (!turnOn) {
      // exactly_one: one member must stay on, so a bare "off" is a no-op.
      if (owningSelector.rule === 'exactly_one') return word
      return clearBit(next, bit)
    }
    for (const sibling of owningSelector.bits) next = clearBit(next, sibling)
    next = setBit(next, bit)
  } else {
    next = turnOn ? setBit(next, bit) : clearBit(next, bit)
  }

  if (turnOn) {
    // Every mutually_exclusive group this bit is in loses its other members.
    for (const g of groups) {
      if (g.rule !== 'mutually_exclusive' || !g.bits.includes(bit)) continue
      for (const other of g.bits) {
        if (other !== bit) next = clearBit(next, other)
      }
    }
  }

  return next & WORD
}

/** Toggle helper: reads the current state and flips it through the rules. */
export function toggleBitByRule(
  rule: RegisterRule,
  word: number,
  bit: number,
): number {
  return applyBitChange(rule, word, bit, !isSet(word, bit))
}

/**
 * Read-modify-write: take the register as it is on the inverter, overwrite only
 * the bits this UI owns, and hand back the whole word.
 *
 * `ownedMask` is every bit the editor is allowed to change. Anything outside it
 * — reserved bits, switches a newer firmware added — survives untouched. This
 * is the whole point of `write: "read_modify_write"`.
 */
export function mergeForWrite(
  currentWord: number,
  desiredWord: number,
  ownedMask: number,
): number {
  return (((currentWord & ~ownedMask) | (desiredWord & ownedMask)) & WORD) >>> 0
}

/** Every bit the rule describes — the mask a bitfield editor owns. */
export function ownedMask(rule: RegisterRule): number {
  let mask = 0
  for (const g of rule.bit_groups ?? []) for (const b of g.bits) mask |= 1 << b
  for (const b of rule.independent_bits ?? []) mask |= 1 << b
  return mask & WORD
}

export const isReadOnly = (rule?: RegisterRule): boolean =>
  rule?.write === 'read_only'

export const needsReadModifyWrite = (rule?: RegisterRule): boolean =>
  rule?.write === 'read_modify_write'
