/**
 * The card / row / header shell shared by all four settings layouts.
 *
 * Ported pixel-faithfully from `docs/superpowers/designs/Settings Controls.dc.html`:
 * `sc-for` became `.map()`, `sc-if` became `&&`, and the DCLogic style helpers
 * live in `theme.ts`. Sizes are the design's, not a judgement.
 */
import React, { CSSProperties, ReactNode } from 'react'
import {
  C,
  cardHeadStyle,
  cardNoteStyle,
  cardStyle,
  cardTitleStyle,
  dirtyPill,
  editBase,
  numberEdit,
  revertBtn,
  rowCurrentStyle,
  rowLabelStyle,
  rowRegStyle,
  rowStyle,
  setBtn,
  tabBtn,
  tabDot,
  toggleEdit,
  writeBtn,
} from './theme'

export interface HeaderTab {
  id: string
  label: string
  /** Unsent edits sitting on this tab, shown as a badge. */
  dirty?: number
}

export interface HeaderProps {
  title?: string
  dirtyCount: number
  onRevert?: () => void
  onWriteAll?: () => void
  /** Extra prose from the rules file, shown as a tooltip. */
  hint?: string
  busy?: boolean
  /**
   * Inner tabs, from the design's tab row. Omitted by every page that is short
   * enough to scroll, which is why the whole block is conditional.
   *
   * `dirtyCount` above stays the total across ALL tabs — the header must never
   * report only what happens to be on screen.
   */
  tabs?: HeaderTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
}

export const SettingsHeader: React.FC<HeaderProps> = ({
  title = 'SETTINGS',
  dirtyCount,
  onRevert,
  onWriteAll,
  hint,
  busy,
  tabs,
  activeTab,
  onTabChange,
}) => (
  <div
    style={{
      height: 30,
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 3,
      padding: '0 6px',
      background: C.orange,
      borderBottom: `1px solid ${C.line}`,
      boxSizing: 'border-box',
    }}
  >
    <span
      title={hint}
      style={{
        font: '700 10px/1 Helvetica,Arial',
        letterSpacing: '.1em',
        color: C.white,
        whiteSpace: 'nowrap',
      }}
    >
      {title}
    </span>
    {tabs?.map((t) => {
      const active = t.id === activeTab
      return (
        <button
          key={t.id}
          type="button"
          onClick={() => onTabChange?.(t.id)}
          style={tabBtn(active)}
        >
          {t.label}
          {!!t.dirty && <span style={tabDot(active)}>{t.dirty}</span>}
        </button>
      )
    })}
    <span style={{ flex: 1 }} />
    <span style={dirtyPill(dirtyCount)}>
      {dirtyCount ? `${dirtyCount} UNSENT` : 'SYNCED'}
    </span>
    {onRevert && (
      <button type="button" onClick={onRevert} style={revertBtn()}>
        REVERT
      </button>
    )}
    {onWriteAll && (
      <button
        type="button"
        onClick={onWriteAll}
        disabled={!dirtyCount || busy}
        style={{ ...writeBtn(), opacity: dirtyCount && !busy ? 1 : 0.45 }}
      >
        {busy ? 'WRITING…' : 'WRITE ALL'}
      </button>
    )}
  </div>
)

export interface CardProps {
  title: string
  note?: string
  strongEdge?: boolean
  children: ReactNode
  /** `revision_note` / rule prose — surfaced as a tooltip on the title. */
  hint?: string
  headerRight?: ReactNode
}

export const SettingsCard: React.FC<CardProps> = ({
  title,
  note,
  strongEdge,
  children,
  hint,
  headerRight,
}) => (
  <div style={cardStyle(strongEdge)}>
    <div style={cardHeadStyle}>
      <span style={cardTitleStyle} title={hint}>
        {title}
      </span>
      {headerRight ?? (note ? <span style={cardNoteStyle}>{note}</span> : null)}
    </div>
    {children}
  </div>
)

export interface RowOption {
  value: number
  label: string
}

export interface SettingRowProps {
  label: string
  /** Absolute register number, shown next to the label. */
  reg: string | number
  /** Decoded current value, already formatted. */
  current: string
  dirty?: boolean
  last?: boolean
  readOnly?: boolean
  /** Prose from `revision_note` / the rules file. */
  hint?: string
  onSet: () => void
  editor:
    | { kind: 'select'; value: number | ''; options: RowOption[]; onChange: (v: number) => void }
    | { kind: 'number'; value: number | ''; unit: string; onChange: (v: number) => void }
    | { kind: 'toggle'; on: boolean; onToggle: () => void }
}

export const SettingRow: React.FC<SettingRowProps> = ({
  label,
  reg,
  current,
  dirty = false,
  last,
  readOnly,
  hint,
  onSet,
  editor,
}) => {
  const es = editBase(dirty)
  return (
    <div style={rowStyle(last)}>
      <span style={rowLabelStyle} title={hint ?? label}>
        {label}
        <span style={rowRegStyle}> {reg}</span>
      </span>
      <span style={rowCurrentStyle}>{current}</span>

      {editor.kind === 'select' && (
        <select
          value={editor.value}
          disabled={readOnly}
          onChange={(e) => editor.onChange(Number(e.target.value))}
          style={es}
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
              // An undocumented code is real information — keep the number
              // visible instead of silently snapping to the first option.
              <option value={editor.value}>{`(${editor.value})`}</option>
            )}
        </select>
      )}

      {editor.kind === 'number' && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input
            type="number"
            value={editor.value}
            disabled={readOnly}
            onChange={(e) => editor.onChange(Number(e.target.value))}
            style={numberEdit(dirty)}
          />
          <span
            style={{
              font: "400 9px/1 'JetBrains Mono',monospace",
              color: C.mute,
              whiteSpace: 'nowrap',
              width: 22,
            }}
          >
            {editor.unit}
          </span>
        </span>
      )}

      {editor.kind === 'toggle' && (
        <button
          type="button"
          disabled={readOnly}
          onClick={editor.onToggle}
          style={toggleEdit(dirty, editor.on)}
        >
          {editor.on ? 'ON' : 'OFF'}
        </button>
      )}

      <button
        type="button"
        onClick={onSet}
        disabled={readOnly}
        title={readOnly ? 'Read-only register' : 'Write this register'}
        style={setBtn(dirty, readOnly)}
      >
        SET
      </button>
    </div>
  )
}

/** The two-column scrolling grid the generic-row layout sits in. */
export const RowsPane: React.FC<{ children: ReactNode; style?: CSSProperties }> = ({
  children,
  style,
}) => (
  <div
    style={{
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      overflowX: 'hidden',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 6,
      padding: 6,
      boxSizing: 'border-box',
      alignContent: 'start',
      scrollbarWidth: 'thin',
      scrollbarColor: `${C.scrollThumb} ${C.cardBg}`,
      ...style,
    }}
  >
    {children}
  </div>
)

/** Outer 800x600 popup frame. */
export const SettingsFrame: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div
    style={{
      width: '100%',
      maxWidth: 800,
      height: 600,
      background: C.field,
      color: C.ink,
      fontFamily: 'Helvetica,Arial,sans-serif',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
    }}
  >
    {children}
  </div>
)
