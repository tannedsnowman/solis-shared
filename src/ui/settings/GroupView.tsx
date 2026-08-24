/**
 * One-column settings chrome: a group rail on the left, a full-width row list
 * on the right.
 *
 * This replaces the two-column card grid, which put a `1fr 1fr` grid inside an
 * `overflowY: auto` box. Grid rows stretch to the tallest item, so uneven
 * cards computed a height that fought the scroller — the look and the scroll
 * were the same bug. Here the pane is a flex COLUMN, so a row's height is its
 * own business and the scroller measures what it actually contains.
 *
 * Going one-column buys the row a full-width description line, which is where
 * range notes and bit explanations live. SolisCloud truncates those into an
 * unreadable column; having room for them is the entire point.
 *
 * `SettingsShell.tsx` still serves the older pages and is untouched.
 */
import React, { CSSProperties, ReactNode, useCallback, useState } from 'react'
import { staleStyle } from './tableTheme'
import {
  C,
  MONO_FAMILY,
  dirtyPill,
  editBase,
  numberEdit,
  revertBtn,
  toggleEdit,
  writeBtn,
} from './theme'
import {
  GroupSummary,
  NOT_READ,
  SaveState,
  SendMode,
  gateOpen,
  nextSaveState,
  rowIsEditable,
  valueText,
} from '../../settings/index'

export type { GroupSummary, SendMode, SaveState } from '../../settings/index'

/* ------------------------------------------------------------------ rail */

export interface GroupRailProps {
  groups: GroupSummary[]
  onSelect: (id: string) => void
  /** Extra chrome under the list — a legend, a device chip. */
  footer?: ReactNode
}

const RAIL_W = 132

/**
 * The whole map, always visible.
 *
 * The rail has its own scroller rather than sharing the pane's: at 800x600 the
 * three built groups fit, but a screen that adds a fourth must push the rows
 * out of view, never the rail out of reach.
 */
export const GroupRail: React.FC<GroupRailProps> = ({
  groups,
  onSelect,
  footer,
}) => (
  <nav
    style={{
      width: RAIL_W,
      flex: 'none',
      display: 'flex',
      flexDirection: 'column',
      background: C.headBg,
      borderRight: `1px solid ${C.line}`,
      boxSizing: 'border-box',
      overflowY: 'auto',
      scrollbarWidth: 'thin',
      scrollbarColor: `${C.scrollThumb} ${C.headBg}`,
    }}
  >
    {groups.map((g) => (
      <button
        key={g.id}
        type="button"
        aria-current={g.active ? 'true' : 'false'}
        onClick={() => onSelect(g.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
          width: '100%',
          textAlign: 'left',
          font: '600 10px/1.2 Helvetica,Arial',
          letterSpacing: '.03em',
          cursor: 'pointer',
          padding: '7px 8px',
          boxSizing: 'border-box',
          border: 'none',
          borderLeft: `3px solid ${g.active ? C.accent : 'transparent'}`,
          borderBottom: `1px solid ${C.line}`,
          background: g.active ? C.white : 'transparent',
          color: g.active ? C.accent : C.mute3,
        }}
      >
        <span>{g.label}</span>
        <span
          style={{
            font: `400 8px/1 ${MONO_FAMILY}`,
            color: g.active ? C.accent2 : C.mute2,
            flex: 'none',
          }}
        >
          {g.count}
        </span>
      </button>
    ))}
    {footer}
  </nav>
)

/* ---------------------------------------------------------------- status */

/**
 * THE TITLE BAR IS GONE, AND ONLY THE TITLE WENT WITH IT.
 *
 * This used to be `GroupHeader`: a 30px orange bar carrying the screen's name
 * ("CONTROL PANEL"), its read-age, and on EPM/AX a batch of REVERT / WRITE
 * ALL. The name was removed on purpose — you reached this screen by clicking
 * its own name in the rail one inch to the left, so the bar spent its height
 * telling you something you had just typed. Every family carried a different
 * mix of bar/no-bar, which is the inconsistency this removal fixes.
 *
 * What the bar ALSO carried is not decorative and did not go:
 *
 *   - `lastReadText` is the only per-screen answer to "is what I am reading
 *     current?". Rows carry their own italics for staleness, but a screen
 *     whose registers were never read at all has no italics to show — every
 *     row is simply blank, which looks like a device with nothing set rather
 *     than a screen nobody has fetched. Dropping this would make "never read"
 *     and "all zeroes" pixel-identical.
 *
 *   - `right` holds `BatchButtons` on all EPM and AX screens, which is the
 *     ONLY route to a batch write on those families. There is no per-row Save
 *     there; the batch IS the write path.
 *
 * So the bar became this strip: no name, no orange, one line of small grey
 * text on the left and the batch slot on the right. It collapses to nothing
 * when a screen has neither (`lastReadAt === null` with no `right`), so the
 * hybrid and PV screens that only ever passed a title now render no chrome at
 * all — which is the "just show me the settings" result the rename was for.
 */
export interface GroupStatusProps {
  /** Epoch ms of the newest reading in this group, or null when never read. */
  lastReadAt: number | null
  /** Right-hand slot: the EPM/AX batch, a dirty pill, a `?`. */
  right?: ReactNode
  now?: number
}

/** "3m ago" / "never read". Coarse on purpose — the row italics carry detail. */
export function lastReadText(lastReadAt: number | null, now: number): string {
  if (lastReadAt === null || !Number.isFinite(lastReadAt)) return 'never read'
  const age = Math.max(0, now - lastReadAt)
  if (age < 60_000) return 'read just now'
  const mins = Math.floor(age / 60_000)
  if (mins < 60) return `read ${mins}m ago`
  return `read ${Math.floor(mins / 60)}h ago`
}

export const GroupStatus: React.FC<GroupStatusProps> = ({
  lastReadAt,
  right,
  now = Date.now(),
}) => {
  /* Nothing to say and nothing to press: draw nothing rather than an empty
     20px rule. A screen with no batch that has never been read is the very
     first thing a user sees, and an empty bar there reads as a broken header
     rather than as deliberate quiet. */
  const unread = lastReadAt === null || !Number.isFinite(lastReadAt)
  if (unread && !right) return null

  return (
    <div
      data-testid="group-status"
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 20,
        padding: '2px 7px',
        borderBottom: `1px solid ${C.line}`,
        boxSizing: 'border-box',
      }}
    >
      <span
        data-testid="group-status-read"
        style={{
          font: `400 9px/1 ${MONO_FAMILY}`,
          color: C.mute,
          whiteSpace: 'nowrap',
        }}
      >
        {lastReadText(lastReadAt, now)}
      </span>
      <span style={{ flex: 1 }} />
      {right}
    </div>
  )
}

/**
 * REVERT / WRITE ALL / the unsent pill, for a `GroupStatus`'s `right` slot.
 *
 * The strip carries no batch of its own on purpose — see the note above it —
 * because the hybrid screens it was built for write one row at a time and a
 * WRITE ALL sitting next to a row's own Save is the same "two buttons, one
 * job" trap.
 *
 * The EPM and AX screens are the exception, and were before this chrome
 * existed: their old `SettingsHeader` always carried a batch, so it is lifted
 * here verbatim rather than dropped. It survived the title bar's removal for
 * the same reason: it is the only write path those two families have. It uses the SAME `theme.ts` helpers the
 * old header used, so the three controls are pixel-identical to what they
 * replace — only the bar around them changed.
 */
export const BatchButtons: React.FC<{
  /** Unsent edits across every group, never just the visible ones. */
  dirty: number
  onRevert: () => void
  onWriteAll: () => void
  busy?: boolean
}> = ({ dirty, onRevert, onWriteAll, busy }) => (
  <>
    <span data-testid="dirty-pill" style={dirtyPill(dirty)}>
      {dirty ? `${dirty} UNSENT` : 'SYNCED'}
    </span>
    <button
      type="button"
      data-testid="batch-revert"
      onClick={onRevert}
      style={revertBtn()}
    >
      REVERT
    </button>
    <button
      type="button"
      data-testid="batch-write-all"
      onClick={onWriteAll}
      disabled={!dirty || busy}
      style={{ ...writeBtn(), opacity: dirty && !busy ? 1 : 0.45 }}
    >
      {busy ? 'WRITING…' : 'WRITE ALL'}
    </button>
  </>
)

/**
 * A sub-heading inside a group, dividing one long screen into categories.
 *
 * The one-column screens deliberately had NO sub-headings while they were
 * short: a flat list of six rows reads faster without them, and SolisCloud's
 * own pages have none. Device Setting is the screen that changed the argument
 * — it carries twenty-odd rows spanning meters, backup output, EPS and two
 * irreversible commands, and a flat list of that length makes an installer
 * scroll hunting for the one they came for.
 *
 * Deliberately quiet: small caps, a rule, no background block. It has to
 * separate without competing with anything above it. Since the orange title
 * bar was removed this is now the LOUDEST thing on a screen, so it stays quiet
 * on its own merits rather than by deference to a header that no longer
 * exists.
 *
 * `tone="danger"` turns it red for the block holding factory reset and HMI
 * restart, so the one region of the screen that cannot be undone does not look
 * like the twenty rows that can.
 */
export const GroupSubHeading: React.FC<{
  title: string
  /** Optional line under the title: what this category is for. */
  note?: string
  tone?: 'normal' | 'danger'
  first?: boolean
}> = ({ title, note, tone = 'normal', first }) => {
  const fg = tone === 'danger' ? C.red : C.mute3
  return (
    <div
      data-testid={`subheading-${title}`}
      style={{
        flex: 'none',
        padding: first ? '6px 8px 4px' : '12px 8px 4px',
        borderTop: first ? 'none' : `1px solid ${C.line}`,
        marginTop: first ? 0 : 2,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          font: '700 9px/1.2 Helvetica,Arial',
          letterSpacing: '.09em',
          textTransform: 'uppercase',
          color: fg,
        }}
      >
        {title}
      </div>
      {note && (
        <div
          style={{
            marginTop: 2,
            font: '400 9px/1.35 Helvetica,Arial',
            color: tone === 'danger' ? C.red : C.mute,
          }}
        >
          {note}
        </div>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- row */

export interface RowOption {
  value: number
  label: string
}

export type RowEditor =
  | { kind: 'toggle'; on: boolean; onChange: (on: boolean) => void }
  | {
      kind: 'select'
      value: number | ''
      options: RowOption[]
      onChange: (v: number) => void
    }
  | {
      kind: 'segmented'
      value: number | ''
      options: RowOption[]
      onChange: (v: number) => void
    }
  | {
      kind: 'number'
      value: number | ''
      unit: string
      onChange: (v: number) => void
    }

export interface SaveResult {
  ok: boolean
  error?: string
}

export interface SettingRowOneProps {
  label: string
  /** Absolute register, shown in grey beside the label. */
  reg: string | number
  /**
   * The full-width line under the row: the range note
   * ("0 ~ 500000, must be a multiple of 100") or the bit's home
   * ("Bit switch inside 43483"). The reason this layout is one column.
   */
  description?: string
  /** Formatted current reading. Ignored when `hasBeenRead` is false. */
  current?: string
  /**
   * Has a read landed for this register? NOT "is it fresh".
   *
   * False disables the editor and the Save button. Every bitfield here is
   * read_modify_write: with no current word a write would guess the fifteen
   * bits it does not own and silently clear whatever the installer set.
   */
  hasBeenRead: boolean
  /** Age of that reading in ms. Only decides italics; never locks the row. */
  ageMs?: number
  /** The rules file says the register cannot be written. */
  readOnly?: boolean
  editor: RowEditor
  sendMode: SendMode
  /**
   * Perform the write. Required for 'immediate' and 'gated'; ignored for
   * 'batch', which stages only and leaves the write to the block Send.
   */
  onSave?: () => Promise<SaveResult>
  /**
   * 'gated' only: true once a write RETURNED ok, false when it failed. The
   * screen decides what appears — a picked-but-unsaved value reveals nothing,
   * because the sub-settings describe hardware state.
   */
  onGateChange?: (open: boolean) => void
  /** Unsent edit sitting on this row. Tints the editor border. */
  dirty?: boolean
  last?: boolean
  /** Tooltip prose: revision_note, rule summary. */
  hint?: string
  /**
   * Long-form explanation, opened in a modal by a `?` beside the register.
   *
   * Distinct from `hint`, which is the browser tooltip: a tooltip cannot be
   * read at leisure, cannot be selected, and vanishes the moment the pointer
   * moves. Anything that takes a paragraph to explain — two features sharing a
   * name, a wiring prerequisite — belongs here instead.
   */
  help?: string
  /** Modal title. Defaults to the row's label. */
  helpTitle?: string
}

const saveTone = (state: SaveState, enabled: boolean, dirty: boolean) => {
  if (state === 'ok') return { bg: C.green, edge: C.green, fg: C.white }
  if (state === 'fail') return { bg: C.red, edge: C.red, fg: C.white }
  if (!enabled) return { bg: C.headBg, edge: C.line, fg: C.mute }
  if (dirty) return { bg: C.accent, edge: C.accent, fg: C.white }
  return { bg: C.headBg, edge: C.line, fg: C.mute3 }
}

export const SettingRowOne: React.FC<SettingRowOneProps> = ({
  label,
  reg,
  description,
  current,
  hasBeenRead,
  ageMs,
  readOnly,
  editor,
  sendMode,
  onSave,
  onGateChange,
  dirty = false,
  last,
  hint,
  help,
  helpTitle,
}) => {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | undefined>()
  const [helpOpen, setHelpOpen] = useState(false)

  const busy = saveState === 'busy'
  const editable = rowIsEditable({ hasBeenRead, readOnly, busy })
  const shown = valueText(hasBeenRead, current)

  const handleSave = useCallback(async () => {
    // Belt and braces. The button is already disabled when the row is locked;
    // this makes the rule hold even if a caller renders its own trigger.
    if (!editable || !onSave) return
    setSaveState('busy')
    setError(undefined)
    const out = await onSave()
    setError(out.error)
    setSaveState(nextSaveState(sendMode, out.ok))
    onGateChange?.(gateOpen(sendMode, out.ok ? 'ok' : 'fail'))
  }, [editable, onSave, sendMode, onGateChange])

  const es: CSSProperties = {
    ...editBase(dirty),
    width: 'auto',
    minWidth: 96,
    opacity: editable ? 1 : 0.5,
    cursor: editable ? 'pointer' : 'not-allowed',
  }

  return (
    <div
      data-testid="setting-row"
      style={{
        display: 'block',
        padding: '5px 8px',
        borderBottom: last ? 'none' : `1px solid ${C.headBg}`,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
        }}
      >
        {/*
          * Bold and a size up on the darkest ink.
          *
          * At 10px/500 in `ink2` the label was only a shade louder than the
          * 8px description under it, so a row read as one grey block and there
          * was nothing to scan down. The three things that matter on a row are
          * WHAT it is, WHAT it reads now, and the Save; everything else --
          * register number, units, description -- is reference and stays
          * quiet. The gap between those two tiers is what makes the list
          * skimmable, so it is widened at both ends rather than by shouting
          * here alone.
          */}
        <span
          title={hint ?? label}
          style={{
            font: '700 11.5px/1.25 Helvetica,Arial',
            color: C.ink,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </span>
        <span style={{ font: `400 8px/1 ${MONO_FAMILY}`, color: C.mute2 }}>
          {reg}
        </span>

        {/*
          * The `?` sits ON the row it explains, immediately after the register.
          *
          * It used to be a lone button floating in its own strip UNDER the row,
          * which read as an orphan: nothing tied it to the setting above it,
          * and it pushed the next row down whether or not anyone wanted help.
          * Here the eye goes label -> register -> `?` and the association is
          * free.
          */}
        {help && (
          <button
            type="button"
            data-testid="row-help"
            aria-label={`What is ${helpTitle ?? label}?`}
            title={`What is ${helpTitle ?? label}?`}
            onClick={() => setHelpOpen(true)}
            style={{
              font: '700 9px/1 Helvetica,Arial',
              color: C.white,
              background: C.orange,
              border: `1px solid ${C.orangeEdge}`,
              borderRadius: 9,
              width: 15,
              height: 15,
              flex: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ?
          </button>
        )}

        {/* Pushes the value, the editor and Save to the right edge. */}
        <span style={{ flex: 1, minWidth: 8 }} />

        {/*
          * The reading is the other half of the pair, so it matches the label's
          * weight. It stays MONO -- a number wants to line up with the number
          * in the editor beside it -- and it stays quiet while unread, because
          * `not read` is an absence and should not shout like a value.
          */}
        <span
          data-testid="row-current"
          style={{
            /* Longhands, NOT the `font` shorthand. The shorthand resets
               `font-style` to `normal`, so it wiped the italic that
               `staleStyle` spreads below and stale readings rendered
               upright. */
            fontWeight: hasBeenRead ? 700 : 400,
            fontSize: 11,
            lineHeight: 1.2,
            fontFamily: MONO_FAMILY,
            color: hasBeenRead ? C.ink : C.mute2,
            whiteSpace: 'nowrap',
            textAlign: 'right',
            ...staleStyle(hasBeenRead ? (ageMs ?? NaN) : NaN),
          }}
        >
          {shown}
        </span>

        <RowEditorView editor={editor} editable={editable} dirty={dirty} es={es} />

        {sendMode !== 'batch' && (
          <button
            type="button"
            data-testid="row-save"
            data-state={saveState}
            disabled={!editable}
            title={error ?? (editable ? 'Write this register' : NOT_READ)}
            onClick={handleSave}
            style={{
              font: '700 8px/1 Helvetica,Arial',
              letterSpacing: '.06em',
              cursor: editable ? 'pointer' : 'not-allowed',
              padding: '0 7px',
              height: 24,
              flex: 'none',
              borderRadius: 4,
              border: `1px solid ${saveTone(saveState, editable, dirty).edge}`,
              background: saveTone(saveState, editable, dirty).bg,
              color: saveTone(saveState, editable, dirty).fg,
              opacity: editable ? 1 : 0.45,
            }}
          >
            {busy ? 'SAVING…' : 'SAVE'}
          </button>
        )}
      </div>

      {/* The line the two-column grid had no room for. */}
      <div
        data-testid="row-description"
        style={{
          font: `400 8px/1.35 ${MONO_FAMILY}`,
          color: C.mute2,
          marginTop: 3,
          paddingRight: 4,
        }}
      >
        {description ?? ''}
      </div>

      {help && helpOpen && (
        <HelpModal
          title={helpTitle ?? label}
          body={help}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * A `?` that opens its explanation in `HelpModal`.
 *
 * The dot-plus-modal pair already existed inside `SettingRowOne`, hard-wired
 * to a row. Some explanations do not belong to any one row -- a whole section
 * can need a sentence, as the PV work-mode screen's power-factor and reactive
 * power sections do, where the point being made is about the RELATIONSHIP
 * between two sections rather than about either register. This is that same
 * affordance, pixel-identical, usable next to a sub-heading.
 *
 * Deliberately the same 15px orange circle. A second, different-looking help
 * control would make users wonder what the difference meant.
 */
export const HelpDot: React.FC<{
  title: string
  body: string
  /** Overrides the aria/tooltip text where "What is X?" reads awkwardly. */
  label?: string
}> = ({ title, body, label }) => {
  const [open, setOpen] = useState(false)
  const ask = label ?? `What is ${title}?`
  return (
    <>
      <button
        type="button"
        data-testid={`help-dot-${title}`}
        aria-label={ask}
        title={ask}
        onClick={() => setOpen(true)}
        style={{
          font: '700 9px/1 Helvetica,Arial',
          color: C.white,
          background: C.orange,
          border: `1px solid ${C.orangeEdge}`,
          borderRadius: 9,
          width: 15,
          height: 15,
          flex: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        ?
      </button>
      {open && (
        <HelpModal title={title} body={body} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

/**
 * The explanation, in a modal over the pane.
 *
 * It used to expand INLINE, which pushed every row below it down the list and
 * reflowed the page while you were reading — and in a 492px pane a paragraph
 * of 9px text simply ran off the bottom with nowhere to scroll. A modal takes
 * the text out of the flow, so the list underneath stays where it was, and
 * gives it room to be read at a comfortable size.
 *
 * Covers the whole popup, not just the pane. The popup IS the viewport here —
 * 800x600 with no page behind it — so `fixed` centres the card against the
 * thing the user is actually looking at. Scoping the overlay to the pane would
 * let the card be clipped by the pane's own `overflow: hidden`, which is the
 * one place a modal must not live.
 */
export const HelpModal: React.FC<{
  title: string
  body: string
  onClose: () => void
}> = ({ title, body, onClose }) => (
  <div
    data-testid="help-modal"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    onClick={onClose}
    style={{
      position: 'fixed',
      inset: 0,
      zIndex: 40,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      background: 'rgba(51,41,31,.42)',
      boxSizing: 'border-box',
    }}
  >
    <div
      /* The click that closes is the BACKDROP's. Without this the first click
         inside the text — to select a word — would shut the thing. */
      onClick={(e) => e.stopPropagation()}
      style={{
        maxWidth: 420,
        width: '100%',
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: C.cardBg,
        border: `1px solid ${C.orangeEdge}`,
        borderRadius: 6,
        boxShadow: '0 8px 28px rgba(51,41,31,.28)',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 8px',
          height: 28,
          background: C.orange,
        }}
      >
        <span
          style={{
            font: '700 10px/1 Helvetica,Arial',
            letterSpacing: '.06em',
            color: C.white,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          data-testid="help-close"
          aria-label="Close"
          onClick={onClose}
          style={{
            font: '700 11px/1 Helvetica,Arial',
            color: C.orange,
            background: C.white,
            border: 'none',
            borderRadius: 3,
            width: 18,
            height: 18,
            flex: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* The only scroller: a long explanation stays inside the card. */}
      <div
        data-testid="help-body"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '9px 10px 11px',
          font: '400 11px/1.6 Helvetica,Arial',
          color: C.ink,
          whiteSpace: 'pre-wrap',
          scrollbarWidth: 'thin',
        }}
      >
        {body}
      </div>
    </div>
  </div>
)

/**
 * Pixel width for a number box holding `value`.
 *
 * The 58px default fits about four characters once the spinner arrows and the
 * padding are paid for. Beyond that the number scrolls inside its own box, so
 * the width tracks the digit count instead.
 *
 * Clamped at both ends: never below the 58px the short rows already use, so
 * the column keeps a common left edge, and never past 128px, because a value
 * long enough to need more is a sign the scale is wrong, not a reason to eat
 * the row.
 */
export function numberEditWidth(value: number | string): number {
  const chars = String(value ?? '').length
  const grown = 58 + Math.max(0, chars - 4) * 8
  return Math.min(128, Math.max(58, grown))
}

/** The editor half of a row. Split out so the disabled rule lives in one place. */
const RowEditorView: React.FC<{
  editor: RowEditor
  editable: boolean
  dirty: boolean
  es: CSSProperties
}> = ({ editor, editable, dirty, es }) => {
  if (editor.kind === 'toggle') {
    return (
      <button
        type="button"
        data-testid="row-editor"
        disabled={!editable}
        aria-pressed={editor.on}
        onClick={() => editable && editor.onChange(!editor.on)}
        style={{
          ...toggleEdit(dirty, editor.on),
          width: 'auto',
          minWidth: 52,
          flex: 'none',
          opacity: editable ? 1 : 0.5,
          cursor: editable ? 'pointer' : 'not-allowed',
        }}
      >
        {editor.on ? 'ON' : 'OFF'}
      </button>
    )
  }

  if (editor.kind === 'select') {
    return (
      <select
        data-testid="row-editor"
        disabled={!editable}
        value={editor.value}
        // `disabled` alone is a browser courtesy. The guard is what makes the
        // rule true: a change that reaches a locked row must go nowhere.
        onChange={(e) => editable && editor.onChange(Number(e.target.value))}
        style={{ ...es, flex: 'none' }}
      >
        {editor.value === '' && (
          <option value="" disabled>
            —
          </option>
        )}
        {editor.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {editor.value !== '' &&
          !editor.options.some((o) => o.value === editor.value) && (
            // An undocumented code is real information — show the number
            // rather than silently snapping to the first option.
            <option value={editor.value}>{`(${editor.value})`}</option>
          )}
      </select>
    )
  }

  if (editor.kind === 'segmented') {
    return (
      <span
        data-testid="row-editor-group"
        role="group"
        style={{ display: 'flex', gap: 2, flex: 'none' }}
      >
        {editor.options.map((o) => {
          const on = o.value === editor.value
          return (
            <button
              key={o.value}
              type="button"
              disabled={!editable}
              aria-pressed={on}
              onClick={() => editable && editor.onChange(o.value)}
              style={{
                font: '600 9px/1 Helvetica,Arial',
                letterSpacing: '.04em',
                height: 24,
                padding: '0 6px',
                borderRadius: 4,
                whiteSpace: 'nowrap',
                border: `1px solid ${on ? C.orangeEdge : C.line}`,
                background: on ? C.orange : C.cardBg,
                color: on ? C.white : C.mute,
                opacity: editable ? 1 : 0.5,
                cursor: editable ? 'pointer' : 'not-allowed',
              }}
            >
              {o.label}
            </button>
          )
        })}
      </span>
    )
  }

  return (
    <NumberBox
      value={editor.value}
      unit={editor.unit}
      editable={editable}
      dirty={dirty}
      onChange={editor.onChange}
    />
  )
}

/**
 * A number box you can actually type in.
 *
 * The plain controlled input this replaces had three faults that compounded
 * into "click it, it goes 0, then typing does nothing":
 *
 *   1. `onChange={Number(e.target.value)}` turned an EMPTY box into 0.
 *      `Number('')` is 0, not NaN, so the moment the field was cleared to
 *      retype it, a real 0 was staged and the row went dirty against a value
 *      nobody chose.
 *   2. `value` came straight from the staged NUMBER, so the box could not be
 *      empty while you were partway through typing -- it snapped back to `0`
 *      and the digits landed after it, giving `02`, `020`.
 *   3. Every keystroke round-tripped through the scale conversion, so on a
 *      scaled register the digits were rounded mid-edit.
 *
 * The box therefore holds TEXT while it is being edited, and publishes a
 * number only when the text actually is one. An empty or half-typed box
 * (`-`, `1.`) stages nothing, so the previous value stands until a real one is
 * committed. On blur the draft is dropped and the box re-syncs to whatever the
 * row now holds, which discards a half-finished entry rather than guessing.
 *
 * Width still grows with the digits: `numberEdit` is a flat 58px, which suits
 * a 2-digit SOC and strangles a power setpoint -- 137500 plus the spinner
 * arrows had no room and scrolled inside its own box. Sized from the digit
 * count rather than one large fixed width, so the SOC rows are not left
 * swimming in white space.
 */
const NumberBox: React.FC<{
  value: number | string
  unit: string
  editable: boolean
  dirty: boolean
  onChange: (n: number) => void
}> = ({ value, unit, editable, dirty, onChange }) => {
  /* null means "not editing -- show the row's value". A string means the user
     is typing, and it is exactly what they have typed so far. */
  const [draft, setDraft] = useState<string | null>(null)
  const shown =
    draft ?? (value === '' || value === undefined ? '' : String(value))

  return (
    <span
      style={{ display: 'flex', alignItems: 'center', gap: 3, flex: 'none' }}
    >
      <input
        data-testid="row-editor"
        type="number"
        disabled={!editable}
        value={shown}
        onChange={(e) => {
          if (!editable) return
          const text = e.target.value
          setDraft(text)
          // Publish only a complete number. '', '-' and '1.' are mid-edit
          // states, not values; staging them would overwrite the reading.
          if (text.trim() === '') return
          const n = Number(text)
          if (Number.isFinite(n)) onChange(n)
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => setDraft(null)}
        style={{
          ...numberEdit(dirty),
          width: numberEditWidth(shown),
          opacity: editable ? 1 : 0.5,
          cursor: editable ? 'text' : 'not-allowed',
        }}
      />
      <span
        style={{
          font: `400 9px/1 ${MONO_FAMILY}`,
          color: C.mute,
          whiteSpace: 'nowrap',
          minWidth: 18,
        }}
      >
        {unit}
      </span>
    </span>
  )
}

/* ----------------------------------------------------------------- panes */

/**
 * The scrolling row list.
 *
 * Flex column, NOT a grid. A grid track stretches to its tallest cell, which
 * is what broke the old scroller; here each row measures itself.
 */
export const GroupPane: React.FC<{
  children: ReactNode
  style?: CSSProperties
}> = ({ children, style }) => (
  <div
    style={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
      overflowX: 'hidden',
      /*
       * The pane must bound ITSELF.
       *
       * `flex: 1; minHeight: 0` only produces a scroller when some ancestor
       * has a real height, and in this popup none does — the settings column
       * is plain block flow all the way up, so the pane simply grew to its
       * content and a 25-row group ran off the bottom of the window with no
       * scrollbar anywhere.
       *
       * Fixing the ancestor chain would mean giving the whole popup a fixed
       * height, which the DATA tab shares and does not want. A viewport cap
       * here is local: it leaves room for the mode tabs and the range-button
       * row above, and the pane scrolls inside whatever is left.
       */
      maxHeight: 'calc(100vh - 96px)',
      background: C.cardBg,
      boxSizing: 'border-box',
      scrollbarWidth: 'thin',
      scrollbarColor: `${C.scrollThumb} ${C.cardBg}`,
      ...style,
    }}
  >
    {children}
  </div>
)

/**
 * Rail beside rows, in a box that never scrolls itself.
 *
 * `overflow: hidden` here is what stops the group list scrolling away with the
 * rows at 800x600 — only `GroupPane` inside may scroll.
 */
export const GroupFrame: React.FC<{
  rail: ReactNode
  children: ReactNode
}> = ({ rail, children }) => (
  <div
    style={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}
  >
    {rail}
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  </div>
)
