/**
 * Pure logic behind the one-column group settings kit.
 *
 * Kept out of `GroupView.tsx` so the safety rule can be tested without a DOM:
 * "no write before a read" is the reason this whole layout exists, and a rule
 * that only lives inside a rendered component is a rule nobody can prove.
 */

/** How a row's Save button behaves. See the plan's "three send behaviours". */
export type SendMode = 'immediate' | 'gated' | 'batch'

/** What the Save button last did. Drives its colour. */
export type SaveState = 'idle' | 'busy' | 'ok' | 'fail'

/** The shown-value text for a register the app may or may not have read. */
export const NOT_READ = 'not read'

/**
 * A row is editable only once a read has landed.
 *
 * Every bitfield in these groups is `read_modify_write`. Without a current
 * word the write layer would have to guess the fifteen bits it does not own,
 * silently clearing whatever the installer set. Staleness is a different
 * question: a row read ten minutes ago HAS a word, so it stays editable and
 * merely renders italic.
 */
export function rowIsEditable(opts: {
  hasBeenRead: boolean
  readOnly?: boolean
  busy?: boolean
}): boolean {
  return opts.hasBeenRead === true && !opts.readOnly && !opts.busy
}

/** Value text for a row: never blank, never a guessed zero. */
export function valueText(
  hasBeenRead: boolean,
  formatted: string | undefined | null,
): string {
  if (!hasBeenRead) return NOT_READ
  return formatted === undefined || formatted === null || formatted === ''
    ? NOT_READ
    : formatted
}

export interface GroupSummary {
  id: string
  label: string
  /** Rows in the group — shown in the rail so the whole map stays visible. */
  count: number
  active: boolean
}

/**
 * The rail's model. Counts come from the row lists the screen already built,
 * so the rail can never disagree with what the pane renders.
 */
export function railModel(
  groups: Array<{ id: string; label: string; rows: unknown[] }>,
  activeId: string,
): GroupSummary[] {
  return groups.map((g) => ({
    id: g.id,
    label: g.label,
    count: g.rows.length,
    active: g.id === activeId,
  }))
}

/**
 * Resolve a save click into the next button state.
 *
 * `batch` never writes from the row, so its click is a staging no-op that must
 * not flash green — the green belongs to the block Send that actually wrote.
 */
export function nextSaveState(mode: SendMode, ok: boolean): SaveState {
  if (mode === 'batch') return 'idle'
  return ok ? 'ok' : 'fail'
}

/**
 * Whether a gated row's dependants may be revealed.
 *
 * Only a write that RETURNED OK counts. A picked-but-unsaved dropdown shows
 * nothing new, because the sub-settings describe hardware state and showing
 * them before the device agreed would be a lie.
 */
export function gateOpen(mode: SendMode, lastSave: SaveState): boolean {
  return mode === 'gated' && lastSave === 'ok'
}
