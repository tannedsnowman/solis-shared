/**
 * Palette and control styles ported pixel-faithfully from
 * `docs/superpowers/designs/Settings Controls.dc.html`.
 *
 * The design is an 800x600 Chrome popup. Every colour, size, padding and
 * radius below is taken verbatim from that file — do not "improve" them.
 */
import { CSSProperties } from 'react'

/*
 * THEMEABLE, WITH THE PORTED DESIGN AS THE DEFAULT.
 *
 * Every colour below is `var(--solis-<name>, <hex>)`, where the hex is the
 * value ported from the design and the variable is the escape hatch.
 *
 * WHY. These cards render in two apps that do not agree about colour. The
 * debugger extension is light-only and defines none of these variables, so it
 * gets the hex and is pixel-identical to before. SolisConnect ships four
 * themes (dark, orange, light, extension) driven by `data-theme` on the root,
 * and maps its own tokens onto these -- so a card drawn there follows the
 * theme instead of punching a cream-coloured hole in a dark window.
 *
 * The fallback is what keeps this safe: a third consumer that defines nothing
 * still gets a complete, legible palette rather than unstyled text.
 */
export const C = {
  accent: "var(--solis-set-accent, #d94f1a)",
  accent2: "var(--solis-set-accent2, #b3521a)",
  red: "var(--solis-set-red, #d0342c)",
  green: "var(--solis-set-green, #12805a)",
  orange: "var(--solis-set-orange, #ea7317)",
  orangeEdge: "var(--solis-set-orangeEdge, #c2560f)",
  ink: "var(--solis-set-ink, #33291f)",
  ink2: "var(--solis-set-ink2, #4c3f33)",
  mute: "var(--solis-set-mute, #96795f)",
  mute2: "var(--solis-set-mute2, #b09480)",
  mute3: "var(--solis-set-mute3, #8a6f5c)",
  line: "var(--solis-set-line, #f0cba9)",
  cardBg: "var(--solis-set-cardBg, #fff6ee)",
  headBg: "var(--solis-set-headBg, #ffe6d0)",
  white: "var(--solis-set-white, #ffffff)",
  greenEdge: "var(--solis-set-greenEdge, #8fd3b0)",
  greenBg: "var(--solis-set-greenBg, #e9f7f0)",
  tabIdle: "var(--solis-set-tabIdle, #ffe2c8)",
  dirtyBg: "var(--solis-set-dirtyBg, #fff0e2)",
  scrollThumb: "var(--solis-set-scrollThumb, #e8a76f)",
}

const MONO = "'JetBrains Mono',monospace"

/** The scrolling pane used by the generic-rows and bitwise layouts. */
export const paneScroll: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: 6,
  boxSizing: 'border-box',
  scrollbarWidth: 'thin',
  scrollbarColor: `${C.scrollThumb} ${C.cardBg}`,
}

export const cardStyle = (strongEdge = false): CSSProperties => ({
  background: C.cardBg,
  border: `1px solid ${strongEdge ? C.scrollThumb : C.line}`,
  borderRadius: 7,
  overflow: 'hidden',
})

export const cardHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 7px',
  background: C.headBg,
  borderBottom: `1px solid ${C.line}`,
}

export const cardTitleStyle: CSSProperties = {
  font: '700 9px/1 Helvetica,Arial',
  letterSpacing: '.1em',
  color: C.accent,
  whiteSpace: 'nowrap',
}

export const cardNoteStyle: CSSProperties = {
  font: `400 8px/1 ${MONO}`,
  color: C.mute,
  whiteSpace: 'nowrap',
  flex: 'none',
}

export const sectionLabelStyle: CSSProperties = {
  font: '700 8px/1 Helvetica,Arial',
  letterSpacing: '.1em',
  color: C.mute,
}

export const rowStyle = (last?: boolean): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: '1fr auto 96px 30px',
  gap: '4px 5px',
  alignItems: 'center',
  padding: '4px 7px',
  borderBottom: last ? 'none' : `1px solid ${C.headBg}`,
})

export const rowLabelStyle: CSSProperties = {
  font: '500 10px/1.2 Helvetica,Arial',
  color: C.ink2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export const rowRegStyle: CSSProperties = {
  font: `400 8px/1 ${MONO}`,
  color: C.mute2,
}

export const rowCurrentStyle: CSSProperties = {
  font: `400 9px/1 ${MONO}`,
  color: C.mute,
  whiteSpace: 'nowrap',
  textAlign: 'right',
}

export const editBase = (dirty: boolean): CSSProperties => ({
  font: `500 10px/1 ${MONO}`,
  color: C.ink,
  background: C.white,
  border: `1px solid ${dirty ? C.accent : C.line}`,
  borderRadius: 4,
  padding: '5px 5px',
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  height: 24,
  cursor: 'pointer',
})

export const numberEdit = (dirty: boolean): CSSProperties => ({
  ...editBase(dirty),
  width: 58,
  textAlign: 'right',
})

export const toggleEdit = (dirty: boolean, on: boolean): CSSProperties => ({
  ...editBase(dirty),
  font: '700 9px/1 Helvetica,Arial',
  letterSpacing: '.06em',
  background: on ? C.greenBg : C.cardBg,
  /* Must be the `border` SHORTHAND, not `borderColor`. `editBase` already set
     `border`, and React refuses to mix a shorthand with a longhand it contains:
     it drops the longhand on every re-render after the first, so the green edge
     appeared once and then silently reverted. */
  border: `1px solid ${on ? C.greenEdge : dirty ? C.accent : C.line}`,
  color: on ? C.green : C.mute,
})

export const setBtn = (dirty: boolean, disabled = false): CSSProperties => ({
  font: '700 8px/1 Helvetica,Arial',
  letterSpacing: '.06em',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '0 6px',
  height: 24,
  borderRadius: 4,
  border: `1px solid ${dirty && !disabled ? C.accent : C.line}`,
  background: dirty && !disabled ? C.accent : C.headBg,
  color: dirty && !disabled ? C.white : C.mute,
  opacity: disabled ? 0.45 : 1,
})

export const writeBtn = (): CSSProperties => ({
  font: '700 8px/1 Helvetica,Arial',
  letterSpacing: '.06em',
  cursor: 'pointer',
  padding: '6px 8px',
  borderRadius: 4,
  border: `1px solid ${C.accent}`,
  background: C.accent,
  color: C.white,
})

export const ghostBtn = (): CSSProperties => ({
  font: '600 8px/1 Helvetica,Arial',
  letterSpacing: '.06em',
  cursor: 'pointer',
  padding: '6px 7px',
  borderRadius: 4,
  border: `1px solid ${C.line}`,
  background: C.headBg,
  color: C.mute3,
})

export const revertBtn = (): CSSProperties => ({
  font: '600 9px/1 Helvetica,Arial',
  letterSpacing: '.06em',
  color: C.mute3,
  background: C.white,
  border: `1px solid ${C.line}`,
  borderRadius: 4,
  padding: '6px 7px',
  cursor: 'pointer',
})

/** Mode / modifier chip. `tone === 'mod'` is the green modifier variant. */
export const chip = (active: boolean, tone?: 'mod'): CSSProperties => {
  const c = tone === 'mod' ? C.green : C.accent
  return {
    font: '600 9px/1 Helvetica,Arial',
    letterSpacing: '.05em',
    cursor: 'pointer',
    padding: '6px 7px',
    borderRadius: 4,
    border: `1px solid ${active ? (tone === 'mod' ? C.greenEdge : C.orangeEdge) : C.line}`,
    background: active ? (tone === 'mod' ? C.greenBg : C.orange) : C.cardBg,
    color: active ? (tone === 'mod' ? c : C.white) : C.mute,
    whiteSpace: 'nowrap',
  }
}

/**
 * Inner-tab button in the SETTINGS header bar.
 *
 * This is the design's own `tabStyle()`, NOT `chip()`: the tab row sits on the
 * orange header, so idle tabs are transparent with `tabIdle` text, and the
 * active one inverts to a white pill. `chip()` is for chips on a card, where
 * the ground is cream.
 */
export const tabBtn = (active: boolean): CSSProperties => ({
  font: '600 10px/1 Helvetica,Arial',
  letterSpacing: '.05em',
  cursor: 'pointer',
  padding: '7px 8px',
  borderRadius: 4,
  border: `1px solid ${active ? C.white : 'transparent'}`,
  background: active ? C.white : 'transparent',
  color: active ? C.accent : C.tabIdle,
  whiteSpace: 'nowrap',
})

/**
 * The unsent-count dot on a tab. Deliberately loud on an INACTIVE tab: an
 * edit you cannot see is the one worth warning about.
 */
export const tabDot = (active: boolean): CSSProperties => ({
  font: '700 8px/1 Helvetica,Arial',
  marginLeft: 4,
  padding: '1px 3px',
  borderRadius: 6,
  background: active ? C.accent : C.white,
  color: active ? C.white : C.accent2,
})

export const dirtyPill = (count: number): CSSProperties => ({
  font: '600 9px/1 Helvetica,Arial',
  letterSpacing: '.06em',
  padding: '5px 6px',
  borderRadius: 3,
  whiteSpace: 'nowrap',
  background: count ? C.dirtyBg : C.greenBg,
  border: `1px solid ${count ? C.scrollThumb : C.greenEdge}`,
  color: count ? C.accent2 : C.green,
})

export const monoText = (size: number, color: string): CSSProperties => ({
  font: `400 ${size}px/1 ${MONO}`,
  color,
})

export const MONO_FAMILY = MONO
