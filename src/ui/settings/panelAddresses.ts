/**
 * Which registers each settings page reads.
 *
 * The DATA panels answer this by construction: building a tab calls the raw
 * reader for exactly the registers it draws, so `read.touched()` IS the list
 * (see `withAddresses` in tabModel). The SETTINGS pages have no such reader —
 * they take the parsed `variables` prop and declare their registers up front
 * as `CardSpec` rows — so the list has to be derived from those declarations
 * instead.
 *
 * Deriving it from the SAME constant the page renders from is the point. A
 * hand-kept second list beside each page would drift the moment a row was
 * added, and it would drift silently: the range row would simply stop
 * highlighting a block, which looks like "that block isn't needed" rather
 * than like a bug.
 */
import { byAddress, byKey } from '../../gospel/gospel'
import type { CardSpec, RowSpec } from './GospelRows'

/**
 * Every address one row occupies.
 *
 * Mirrors `resolve()` in GospelRows — a row may be identified by gospel key
 * rather than by address, and a wide register spans a run of words. Listing
 * only the start word would under-report a 32-bit reading that straddles a
 * block boundary, which is exactly the case where the highlight matters.
 */
function addressesOfRow(spec: RowSpec): number[] {
  const reg =
    spec.address !== undefined
      ? byAddress.get(spec.address)
      : spec.key
        ? byKey.get(spec.key)
        : undefined
  const start = spec.address ?? reg?.address_start
  if (start === undefined) return []

  const out = [start]
  /* Contiguous wide registers cover start..end. */
  const end = reg?.address_end
  if (typeof end === 'number' && end > start) {
    for (let a = start + 1; a <= end; a++) out.push(a)
  }
  /* A few 32-bit readings keep their high word somewhere else entirely. */
  const high = (reg as { high_word_address?: number | null } | undefined)
    ?.high_word_address
  if (typeof high === 'number') out.push(high)
  return out
}

/**
 * Every address a set of cards draws.
 *
 * Sorted and de-duplicated: cards routinely repeat an address (a gating bit
 * word shown beside the rows it gates), and the range row only cares about
 * the set.
 */
export function addressesOfCards(...groups: CardSpec[][]): number[] {
  const out = new Set<number>()
  for (const cards of groups) {
    for (const card of cards) {
      for (const row of card.rows) {
        for (const address of addressesOfRow(row)) out.add(address)
      }
    }
  }
  return Array.from(out).sort((a, b) => a - b)
}

/** Merge card addresses with any extra registers a page reads directly. */
export function addressesOf(
  cards: CardSpec[][],
  extra: number[] = [],
): number[] {
  return Array.from(new Set([...addressesOfCards(...cards), ...extra])).sort(
    (a, b) => a - b,
  )
}

/**
 * A contiguous run of registers, as the scheduling pages declare them.
 *
 * TimeCharging, TimeChargingV2, GeneratorCharging, SmartLoadTimeOfUse and
 * HeatPumpSchedule build their addresses arithmetically from a base and a
 * stride rather than listing them, so they report runs instead of rows.
 */
export function run(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i)
}
