/**
 * The register tables' light theme.
 *
 * These are the SAME tokens the hybrid system diagram uses (see
 * `src/pages/Hybrid/Data/SystemDiagram.tsx` and
 * `src/components/DataView/panelStyles.ts`). The table used to be the last
 * dark-navy surface in the app, so switching between DATA > Table and
 * DATA > Diagram meant switching themes mid-tab. One palette, one source.
 *
 * Kept as plain objects rather than CSS classes because every other widget in
 * this repo styles inline (`src/styles/appStyles.ts`), and the table sits
 * inside the same popup with no build-time CSS step.
 */
import { CSSProperties } from "react";

/** Shared with panelStyles.C — same hexes, same names. */
export const T = {
  page: "#f4f7fb",
  panel: "#f9fbfe",
  card: "#ffffff",
  line: "#e4ebf5",
  lineStrong: "#bcd0e8",
  panelLine: "#d7e2f0",
  zebra: "#f2f6fc",
  ink: "#14213a",
  ink2: "#22304d",
  ink3: "#5b7594",
  muted: "#647c99",
  muted2: "#7b8ea8",
  faint: "#a3b1c4",
  blue: "#2f7ef0",
  blueSoft: "#e3edfd",
  green: "#0f9d63",
  greenSoft: "#e6f6ef",
  warn: "#c98a06",
  warnSoft: "#fdf3dc",
  red: "#d63b3b",
  redSoft: "#fdeaea",
} as const;

/* ── Accent, as CSS variables ──────────────────────────────────────────
   The table is rendered on BOTH sides of the app: DATA (blue) and SETTINGS
   (orange). These styles are plain objects computed once at module load, so
   the accent cannot be a parameter without threading a theme argument through
   four files and every call site.

   Instead the accent-bearing values are emitted as `var(--tbl-*)` with the
   DATA blues as the fallback, and SETTINGS overrides them on its wrapper (see
   `settingsAccent`). One declaration flips the whole table, and a table with
   no wrapper still renders blue exactly as before. */
export const A = {
  accent: 'var(--tbl-accent, #2f7ef0)',
  accentSoft: 'var(--tbl-accent-soft, #e3edfd)',
  page: 'var(--tbl-page, #f4f7fb)',
  panel: 'var(--tbl-panel, #f9fbfe)',
  line: 'var(--tbl-line, #e4ebf5)',
  lineStrong: 'var(--tbl-line-strong, #bcd0e8)',
  panelLine: 'var(--tbl-panel-line, #d7e2f0)',
  zebra: 'var(--tbl-zebra, #f2f6fc)',
} as const

/**
 * Spread onto the element WRAPPING a settings table to repaint it orange.
 * Values mirror the SETTINGS palette in `SettingsView/theme.ts`, so the table
 * sits in the same family as the settings widgets stacked around it rather
 * than reading as a blue island among them.
 */
export const settingsAccent = {
  '--tbl-accent': '#d94f1a',
  '--tbl-accent-soft': '#fbe9dd',
  '--tbl-page': '#fdf7f2',
  '--tbl-panel': '#fffaf6',
  '--tbl-line': '#f6e3d3',
  '--tbl-line-strong': '#eaba90',
  '--tbl-panel-line': '#f0cba9',
  '--tbl-zebra': '#fdf3ea',
} as CSSProperties

/**
 * Spread onto the element WRAPPING the device list to repaint it slate.
 *
 * The third accent. DATA is blue and SETTINGS is orange because both are
 * views ONTO an inverter; the device list is the index you pick an inverter
 * from, so it deliberately takes a neutral grey-blue rather than competing
 * with either. Same shell, same sizes, same zebra — only the accent moves.
 */
export const deviceAccent = {
  '--tbl-accent': '#475569',
  '--tbl-accent-soft': '#e8edf3',
  '--tbl-page': '#f8fafc',
  '--tbl-panel': '#fbfcfe',
  '--tbl-line': '#e6ebf1',
  '--tbl-line-strong': '#cbd5e1',
  '--tbl-panel-line': '#d8e0e9',
  '--tbl-zebra': '#f4f7fa',
} as CSSProperties

export const MONO =
  "'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace";
export const SANS = "Helvetica, Arial, sans-serif";

/* ── Freshness ────────────────────────────────────────────────────────
   How old a register's value is, expressed as a colour.

   This used to be a full-cell `bg-green-500` fill, which (a) needed Tailwind
   that is not loaded here, so it rendered as an unstyled block, and (b) at
   full saturation drowned out the value it was meant to annotate. Now the
   tint is a wash and the signal is a 5px dot, so the number stays readable
   and the age still reads at a glance. */

export const FRESH_MS = 150000;
export const OK_MS = 600000;

/**
 * Past this, a reading is shown as STALE wherever it appears — italic, and on
 * surfaces that carry their own colour, greyed out as well.
 *
 * Colour alone was not enough. A stale number renders the same shape as a live
 * one, so a five-minute-old battery power reads as current unless you happen to
 * check its dot — and on the diagram, where there are no dots at all, there was
 * no signal whatsoever. Italics change the glyphs themselves, so the value
 * looks provisional at a glance and at any size.
 *
 * Italics alone turned out not to be enough EITHER on the diagram. Its headline
 * numbers are big, saturated and colour-coded by role (solar amber, battery
 * green, grid violet), and at 21-28px a slanted amber number still reads as a
 * confident live amber number. The slant is a small proportion of the ink. So
 * on the diagram the value also drops to grey: losing the role colour is the
 * loud part of the signal, and italics stay as the fine-grained confirmation.
 *
 * Deliberately EARLIER than `OK_MS` (10 min), which stays where it is so the
 * red "stale" tint keeps its existing meaning. Five minutes is the point past
 * which a live power reading should not be trusted as current.
 */
export const STALE_ITALIC_MS = 300000;

/** The colour a stale value falls back to when it gives up its role colour. */
export const STALE_INK = T.faint;

export interface Freshness {
  /** The dot / text colour. */
  color: string;
  /** The cell wash behind the value. */
  bg: string;
  label: string;
  /** True once the reading is old enough to render in italics. */
  stale: boolean;
}

export function freshnessOf(ageMs: number): Freshness {
  const stale = ageMs >= STALE_ITALIC_MS;
  if (ageMs < FRESH_MS)
    return { color: T.green, bg: T.greenSoft, label: "fresh", stale };
  if (ageMs < OK_MS)
    return { color: T.warn, bg: T.warnSoft, label: "ageing", stale };
  return { color: T.red, bg: T.redSoft, label: "stale", stale };
}

/** Is a reading of this age old enough to be shown as stale? */
export function isStale(ageMs: number): boolean {
  return Number.isFinite(ageMs) && ageMs >= STALE_ITALIC_MS;
}

/**
 * The italic style for a reading of this age, ready to spread into any style.
 *
 * One helper so every surface asks the same question and gets the same answer.
 * An unknown age (NaN, an unread register) is NOT stale — it is unknown, and
 * italicising it would claim something the app does not know.
 *
 * Italics ONLY. The register tables want exactly this and nothing more: they
 * already say "old" with a red dot and a red cell wash, so greying the text on
 * top would be a third stale signal fighting the two that are working. Surfaces
 * with no dots — the diagram — want `staleValueStyle` instead.
 */
export function staleStyle(ageMs: number): CSSProperties {
  return isStale(ageMs) ? { fontStyle: "italic" } : {};
}

/**
 * Italic AND greyed, for a value whose own colour carries meaning.
 *
 * Spread this LAST, over the role colour it is meant to suppress — it sets
 * `color`, so anything spread after it wins and the value stays saturated.
 *
 * A fresh reading returns `{}`, so the caller's colour survives untouched and a
 * surface that never goes stale renders exactly as it did before.
 *
 * NOT SAFE beside a `font` SHORTHAND. React refuses to mix a shorthand with the
 * longhand it contains: given both `font` and `fontStyle` it drops `fontStyle`
 * on every re-render after the first, so the italics appear once and then
 * silently vanish the next time the component updates — which, on a live
 * diagram, is a second later. Every style in the diagram uses `font`, so those
 * call sites want `staleFontStyle` instead, which folds the italic INTO the
 * shorthand. See `staleFontStyle` below.
 */
export function staleValueStyle(ageMs: number): CSSProperties {
  return isStale(ageMs)
    ? { fontStyle: "italic", color: STALE_INK }
    : {};
}

/**
 * The same signal for a caller that styles with the `font` shorthand.
 *
 * Takes the shorthand it would have written and returns it with `italic`
 * spliced in at the front — the one place CSS accepts a font style inside the
 * shorthand — plus the grey ink. Nothing sets `fontStyle`, so there is no
 * longhand for React to strip and the italics survive re-renders.
 *
 *   font: "500 21px/1 mono"  ->  font: "italic 500 21px/1 mono"
 *
 * A fresh reading gets the shorthand back verbatim and no colour, so the
 * caller's own colour still applies.
 */
export function staleFontStyle(font: string, ageMs: number): CSSProperties {
  return isStale(ageMs)
    ? { font: `italic ${font}`, color: STALE_INK }
    : { font };
}

/* ── Surfaces ─────────────────────────────────────────────────────── */

export const container: CSSProperties = {
  background: A.page,
  color: T.ink,
  fontFamily: SANS,
  border: `1px solid ${A.panelLine}`,
  borderRadius: 8,
  padding: 8,
  boxSizing: "border-box",
  width: "100%",
  maxWidth: "100%",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  gap: 6,
};

export const toolbar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
  flex: "none",
};

export const search: CSSProperties = {
  width: 132,
  padding: "4px 8px",
  border: `1px solid ${A.panelLine}`,
  borderRadius: 5,
  font: `400 10px/1.2 ${SANS}`,
  background: T.card,
  color: T.ink,
  outline: "none",
};

export const chip = (active: boolean): CSSProperties => ({
  font: `600 9px/1 ${SANS}`,
  letterSpacing: ".04em",
  padding: "4px 8px",
  borderRadius: 4,
  cursor: "pointer",
  whiteSpace: "nowrap",
  border: `1px solid ${active ? A.accent : A.panelLine}`,
  background: active ? A.accentSoft : T.card,
  color: active ? T.ink : T.muted,
});

export const count: CSSProperties = {
  font: `400 9px/1 ${MONO}`,
  color: T.muted2,
  marginLeft: "auto",
  whiteSpace: "nowrap",
};

/**
 * The scroll box around the table.
 *
 * `minHeight: 0` is required: a flex child defaults to `min-height: auto`,
 * refuses to shrink below its content, and so never produces a scrollbar.
 */
export const scrollBox: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  borderRadius: 6,
  border: `1px solid ${A.lineStrong}`,
  background: T.card,
  scrollbarWidth: "thin",
  scrollbarColor: `${A.lineStrong} ${A.panel}`,
};

export const table: CSSProperties = {
  width: "100%",
  tableLayout: "fixed",
  borderCollapse: "separate",
  borderSpacing: 0,
};

/* ── Head ─────────────────────────────────────────────────────────── */

export const headCell = (align: CSSProperties["textAlign"]): CSSProperties => ({
  font: `700 8px/1 ${SANS}`,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "#ffffff",
  background: A.accent,
  padding: "7px 6px",
  textAlign: align,
  position: "sticky",
  top: 0,
  zIndex: 2,
  whiteSpace: "nowrap",
});

/* ── Body ─────────────────────────────────────────────────────────── */

export const bodyRow = (zebra: boolean): CSSProperties => ({
  background: zebra ? A.zebra : T.card,
});

/** The common cell. Callers override `textAlign` and `color` only. */
export const cell: CSSProperties = {
  font: `400 10px/1.35 ${MONO}`,
  color: T.ink2,
  padding: "5px 6px",
  borderBottom: `1px solid ${A.line}`,
  verticalAlign: "middle",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** The register NAME: sans, darker, a little heavier than its value. */
export const nameCell: CSSProperties = {
  ...cell,
  font: `500 10px/1.35 ${SANS}`,
  color: T.ink,
};

export const dimCell: CSSProperties = {
  ...cell,
  color: T.muted2,
  font: `400 9px/1.35 ${MONO}`,
  textAlign: "center",
};

export const badge = (fg: string, bg: string): CSSProperties => ({
  display: "inline-block",
  font: `600 9px/1.5 ${SANS}`,
  padding: "0 6px",
  borderRadius: 3,
  color: fg,
  background: bg,
  border: `1px solid ${fg}33`,
  whiteSpace: "nowrap",
});

/** The little "?" that opens a register's description. */
export const helpDot: CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  font: `700 9px/1 ${SANS}`,
  cursor: "pointer",
  border: `1px solid ${A.panelLine}`,
  background: T.card,
  color: T.muted,
  padding: 0,
};

export const emptyNote: CSSProperties = {
  font: `400 10px/1.5 ${SANS}`,
  color: T.muted2,
  textAlign: "center",
  padding: "22px 8px",
};

/* ── Settings-only controls ───────────────────────────────────────────
   The SETTINGS table has two columns DATA does not: a "New" input to type
   a value into, and a "Set" button to write it. They live here rather than
   inline in `TableSettings` so they stay on the same palette as everything
   else if these tokens ever move. */

/** The "New" value input. Mono, because it holds a number you compare by eye
    against the mono "Val" cell immediately to its left. */
export const numberInput: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "2px 4px",
  border: `1px solid ${A.panelLine}`,
  borderRadius: 4,
  font: `500 10px/1.3 ${MONO}`,
  background: T.card,
  color: T.ink,
  outline: "none",
  textAlign: "right",
};

/** The input, once you have typed something other than the current value.
    Without this there is no signal that a row is armed — you could type into
    six rows, press Set on one, and have no way to see which were pending. */
export const numberInputDirty: CSSProperties = {
  ...numberInput,
  borderColor: A.accent,
  background: A.accentSoft,
};

/**
 * The write button, coloured by how the last write went.
 *
 * `idle` is deliberately quiet. This button writes to the inverter, and the
 * old style painted every one of them in saturated orange — a table of 180
 * live "commit" buttons all shouting at once, which makes the one you just
 * pressed impossible to pick out.
 */
export type WriteState = "idle" | "ok" | "fail" | "busy";

export const writeButton = (state: WriteState): CSSProperties => {
  const skin: Record<WriteState, [string, string, string]> = {
    /* [text, background, border] */
    idle: [T.ink2, T.card, A.lineStrong],
    ok: ["#ffffff", T.green, T.green],
    fail: ["#ffffff", T.red, T.red],
    busy: [T.muted, A.panel, A.panelLine],
  };
  const [color, background, border] = skin[state];
  return {
    font: `600 9px/1 ${SANS}`,
    letterSpacing: ".04em",
    padding: "4px 7px",
    borderRadius: 4,
    cursor: state === "busy" ? "progress" : "pointer",
    color,
    background,
    border: `1px solid ${border}`,
    width: "100%",
    whiteSpace: "nowrap",
  };
};
