/**
 * Required regex capture groups, as non-optional strings.
 *
 * WHY THIS EXISTS
 * ---------------
 * This package compiles with `noUncheckedIndexedAccess`, so `m[1]` on a
 * `RegExpMatchArray` is typed `string | undefined` -- correct in general,
 * because a group inside `(...)?` or an alternation genuinely can go unset.
 *
 * Every use in the PV models is the other case: a group that is NOT optional
 * in its pattern, read from a match that already succeeded. Those groups are
 * always present, and the eighteen call sites that read them were each
 * written knowing it.
 *
 * The choice was between eighteen `!` assertions and one helper. `!` silences
 * the checker wherever it is written, including at the sites where the group
 * really is optional and the value really can be undefined -- so a later edit
 * that makes a group optional keeps compiling and starts producing "undefined"
 * in a register label. This throws instead, naming the pattern, so that same
 * edit fails loudly the first time it runs.
 *
 * Use `group` for a group that must be set, and plain `m[n]` with a guard
 * where the pattern genuinely allows it to be missing.
 */

/**
 * Read a capture group that the pattern guarantees.
 *
 * Throws if the group is unset, which means the pattern and the call have
 * drifted apart -- a bug here, not bad input.
 */
export function group(m: RegExpMatchArray, n: number): string {
  const v = m[n]
  if (v === undefined) {
    throw new Error(
      `capture group ${n} is unset in /${m[0]}/ -- the pattern and its reader disagree`,
    )
  }
  return v
}

/**
 * The first element of an array already known to be non-empty.
 *
 * Same reasoning as `group`: the call sites check `.length` immediately
 * before, so the value is present, but the checker cannot carry that fact
 * across the index.
 */
export function first<T>(xs: readonly T[]): T {
  const v = xs[0]
  if (v === undefined) {
    throw new Error('first() called on an empty array')
  }
  return v
}
