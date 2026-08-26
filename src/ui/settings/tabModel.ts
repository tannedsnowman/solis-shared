/**
 * Inner tabs for a long settings page.
 *
 * The popup is hard-capped at 800x600, so a 48-register page cannot be one
 * scroll. A page tags each `CardSpec` with a `tab` and the kit shows one
 * group at a time.
 *
 * Everything correctness-critical lives here as pure functions, because the
 * dangerous bug is a *silent* one: hiding a card must never hide its unsent
 * edit from the dirty count or from WRITE ALL. `editSlotsOf` therefore takes
 * ALL cards and knows nothing about which tab is showing.
 */
import { CardSpec, RowSpec } from './GospelRows'
import { byAddress, byKey } from '../../gospel/gospel'
import { packedFieldsFor } from '../../settings/packedFields'

export interface TabSpec {
  id: string
  label: string
}

/** The tab bar, in first-appearance order. Untagged cards land in `fallback`. */
export function tabsOf(cards: CardSpec[], fallback = 'ALL'): TabSpec[] {
  const seen: string[] = []
  for (const c of cards) {
    const id = c.tab ?? fallback
    if (!seen.includes(id)) seen.push(id)
  }
  return seen.map((id) => ({ id, label: id }))
}

/**
 * The cards to RENDER. An unknown or absent `activeTab` shows everything, so
 * a page that forgets to pass one degrades to today's single long scroll
 * rather than to a blank pane.
 */
export function visibleCards<T extends { tab?: string }>(
  cards: T[],
  activeTab?: string,
  fallback = 'ALL',
): T[] {
  if (!activeTab) return cards
  const picked = cards.filter((c) => (c.tab ?? fallback) === activeTab)
  return picked.length ? picked : cards
}

/** The absolute address of a row, or null when the gospel does not know it. */
export function addressOf(spec: RowSpec): number | null {
  if (spec.address !== undefined) return spec.address
  const reg = spec.key ? byKey.get(spec.key) : undefined
  return reg?.address_start ?? null
}

/**
 * Every edit slot a set of cards could own — `"address"`, or
 * `"address:field"` for a packed word. This is the key insight for tabs: the
 * slot name is derived from the register, never from the tab, so an edit made
 * on one tab is found by a lookup made from another.
 */
export function editSlotsOf(cards: CardSpec[]): string[] {
  const out: string[] = []
  for (const c of cards) {
    for (const r of c.rows) {
      const address = addressOf(r)
      if (address === null) continue
      const fields = packedFieldsFor(address)
      if (fields) fields.forEach((_, i) => out.push(`${address}:${i}`))
      else out.push(String(address))
    }
  }
  return out
}

/**
 * How many unsent edits sit on each tab, INCLUDING the tabs that are hidden.
 * This is what makes a stale edit on another tab discoverable instead of a
 * surprise at WRITE ALL time.
 */
export function dirtyByTab(
  cards: CardSpec[],
  edits: Record<string, unknown>,
  fallback = 'ALL',
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of cards) {
    const id = c.tab ?? fallback
    out[id] = out[id] ?? 0
    for (const slot of editSlotsOf([c])) {
      if (edits[slot] !== undefined) out[id] += 1
    }
  }
  return out
}

/** Total unsent edits across every tab — what the header pill must show. */
export function totalDirty(
  cards: CardSpec[],
  edits: Record<string, unknown>,
): number {
  return editSlotsOf(cards).filter((s) => edits[s] !== undefined).length
}

/** Only used by tests/consumers wanting the register behind a label. */
export function registerOf(spec: RowSpec) {
  const address = addressOf(spec)
  return address === null ? undefined : byAddress.get(address)
}
