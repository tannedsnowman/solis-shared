/**
 * Pixel-faithful port of `docs/superpowers/designs/Detail Panels.dc.html`.
 *
 * Every colour, size, padding and radius here is copied from that file. The
 * design was chosen as "pixel-faithful", so this module is a transcription,
 * not an interpretation. If a value looks odd, it is odd in the design too —
 * change the design first.
 *
 * The design uses inline styles throughout, which is also how the rest of this
 * repo styles widgets (see `src/styles/appStyles.ts`), so the DCLogic style
 * helpers become plain functions returning React style objects.
 */
import { CSSProperties } from "react";

/** The design's palette, by the single-letter names DCLogic used. */
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
  green: "var(--solis-data-green, #0f9d63)",
  red: "var(--solis-data-red, #d63b3b)",
  purple: "var(--solis-data-purple, #7c5cf0)",
  dim: "var(--solis-data-dim, #93a3b8)",
  warn: "var(--solis-data-warn, #c98a06)",
  blue: "var(--solis-data-blue, #2f7ef0)",
  cyan: "var(--solis-data-cyan, #0e8fd4)",
  grey: "var(--solis-data-grey, #a3b1c4)",
  ink: "var(--solis-data-ink, #14213a)",
  ink2: "var(--solis-data-ink2, #22304d)",
  ink3: "var(--solis-data-ink3, #5b7594)",
  muted: "var(--solis-data-muted, #647c99)",
  muted2: "var(--solis-data-muted2, #7b8ea8)",
  line: "var(--solis-data-line, #e4ebf5)",
  lineStrong: "var(--solis-data-lineStrong, #bcd0e8)",
  panel: "var(--solis-data-panel, #f9fbfe)",
  panelLine: "var(--solis-data-panelLine, #d7e2f0)",
  page: "var(--solis-data-page, #f4f7fb)",
  bar: "var(--solis-data-bar, #eef3fa)",
  zebra: "var(--solis-data-zebra, #f2f6fc)",
} as const;

const MONO = "'JetBrains Mono',monospace";
const SANS = "Helvetica,Arial,sans-serif";

/**
 * The panel's outer box.
 *
 * This was a hard 800x600 with `overflow: hidden`, because the design port
 * was one full-popup view that owned the whole window. As a widget stacked
 * with others in a scrolling column it must instead take the width it is
 * given and be as tall as its content, letting the page scroll it — a fixed
 * 600 px would clip whatever ran past it with no way to reach the rest.
 *
 * Anything that cannot shrink (the matrix, the bar grid) gets its own
 * horizontal scroller rather than forcing the page sideways.
 */
export const shell: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  /*
  NO vertical cap, and NO inner scroller.

  This used to be capped at `--popup-height-zoomed - --widget-offset` with
  `overflowY: auto`, so the panel scrolled inside itself. The cap was there to
  keep the register buttons above the panel on screen while you read it.

  In practice the cap only ever read as damage. It landed mid-row — the detail
  cards below it carry `overflow: hidden`, so the last line was sliced in half
  rather than clipped at a clean edge — and the thin, near-page-coloured
  scrollbar gave no hint that anything was below. It also assumed a 600px-wide
  popup; wider than that and the panel needs MORE height, not the same.

  The panel is now as tall as its content and the popup body scrolls it. The
  register buttons scroll away with it, which is the accepted cost.

  Horizontal is unchanged: the matrix and the bar grid have a floor width and
  keep their own `scrollX` wrappers, so the popup never scrolls sideways.
  */
  overflowX: "hidden",
  background: C.page,
  color: C.ink,
  fontFamily: SANS,
  display: "flex",
  flexDirection: "column",
  boxSizing: "border-box",
};

/* The device bar this file once carried (model, serial, live pill, fault and
   warning badges) belonged to the single tabbed "Panels" view. Each DATA
   widget now draws its own heading and the app already has a status widget,
   so those styles are gone. `spacer` survives because the heading row still
   pushes the register range to the right. */

export const spacer: CSSProperties = { flex: 1 };

/* ── Row 2: the register-range line ────────────────────────────────── */

/*
This row once held the panel's own tab buttons and stood 32px tall with a
bar background to match. It now carries ONLY the register range, right
aligned, so it is a caption rather than a chrome bar: half the height, no
fill, no divider. In a 600px popup that row is worth reclaiming.
*/
export const tabRow: CSSProperties = {
  height: "16px",
  flex: "none",
  display: "flex",
  alignItems: "center",
  padding: "0 8px",
  boxSizing: "border-box",
};

export const regRange: CSSProperties = {
  font: `400 9px/1 ${MONO}`,
  color: C.muted,
  whiteSpace: "nowrap",
  flex: "none",
};

/* ── The scrolling column ──────────────────────────────────────────── */

/**
 * Added deliberately: content taller than the 600 px popup must scroll while
 * the device bar and tabs stay pinned.
 */
/**
 * A horizontal scroller for content that has a floor width.
 *
 * The matrix is 7 columns and the bar grid is 2; below a certain width they
 * stop being readable rather than reflowing. Wrapping them in this keeps the
 * overflow inside the panel, so the popup body itself never scrolls sideways.
 */
export const scrollX: CSSProperties = {
  width: "100%",
  overflowX: "auto",
  overflowY: "hidden",
  scrollbarWidth: "thin",
  scrollbarColor: `${C.lineStrong} ${C.bar}`,
};

/* ── Row 3: KPI strip ──────────────────────────────────────────────── */

export const kpiStrip: CSSProperties = {
  flex: "none",
  display: "grid",
  gridTemplateColumns: "repeat(4,1fr)",
  gap: "6px",
  padding: "8px 8px 0",
  boxSizing: "border-box",
};

export const kpiTile: CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.panelLine}`,
  borderRadius: "7px",
  padding: "7px 9px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

export const kpiLabel: CSSProperties = {
  font: `700 8px/1 ${SANS}`,
  letterSpacing: ".1em",
  color: C.muted2,
};

export const kpiValueRow: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "4px",
};

export const bigVal = (color?: string): CSSProperties => ({
  font: `500 19px/1 ${MONO}`,
  color: color || C.ink,
});

export const kpiUnit: CSSProperties = {
  font: `400 9px/1 ${MONO}`,
  color: C.muted,
};

export const kpiSub: CSSProperties = {
  font: `400 8px/1 ${MONO}`,
  color: C.grey,
};

/* ── Row 4: matrix ─────────────────────────────────────────────────── */

export const matrixWrap: CSSProperties = {
  flex: "none",
  padding: "8px",
  boxSizing: "border-box",
};

export const matrixCard: CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.lineStrong}`,
  borderRadius: "8px",
  overflow: "hidden",
};

export const matrixHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 9px",
  borderBottom: `1px solid ${C.line}`,
};

export const matrixTitle: CSSProperties = {
  font: `700 9px/1 ${SANS}`,
  letterSpacing: ".12em",
  color: C.ink2,
  whiteSpace: "nowrap",
};

export const matrixNote: CSSProperties = {
  font: `400 8px/1 ${MONO}`,
  color: C.muted2,
  whiteSpace: "nowrap",
  flex: "none",
};

/* `minWidth` is the floor below which the columns stop being readable. Past
   it the wrapping `scrollX` takes over instead of squashing further. 64 px a
   column is about where a value like "-1 234" still fits. */
export const matrixGrid = (cols: number): CSSProperties => ({
  minWidth: `${cols * 64}px`,
  display: "grid",
  gridTemplateColumns: `1.1fr repeat(${cols - 1},1fr)`,
});

export const headCell = (first: boolean): CSSProperties => ({
  font: `700 8px/1 ${SANS}`,
  letterSpacing: ".08em",
  color: "#ffffff",
  padding: "6px 8px",
  background: C.blue,
  borderBottom: `1px solid ${C.blue}`,
  textAlign: first ? "left" : "right",
  whiteSpace: "nowrap",
});

export const headReg: CSSProperties = {
  font: `400 7px/1 ${MONO}`,
  color: "var(--solis-data-headReg, #cfe2fb)",
};

export interface CellOpts {
  first?: boolean;
  zebra?: boolean;
  color?: string;
  strong?: boolean;
  /** Calculated rather than read. Drawn in italics. See `CALC` below. */
  calc?: boolean;
}

/*
CALCULATED VALUES ARE ITALIC.

A PV inverter publishes no per-phase power register, so those columns are
arithmetic over other registers. Showing derived numbers in the same face as
measured ones invites a user to trust a calculation as a reading — and the
whole point of a debugger tool is knowing which is which.

Italic is the marker, deliberately paired with a colour by the caller rather
than replacing it: colour already carries meaning here (purple = active
power, red/green = sign), so overloading it would cost information. Slant is
free, orthogonal, and reads instantly next to an upright neighbour.
*/
export const bodyCell = (o: CellOpts = {}): CSSProperties => ({
  font: `${o.calc ? "italic " : ""}${o.strong ? "600" : "400"} 10px/1 ${MONO}`,
  color: o.color || C.ink2,
  padding: "7px 8px",
  textAlign: o.first ? "left" : "right",
  background: o.zebra ? C.zebra : "transparent",
  whiteSpace: "nowrap",
  letterSpacing: o.first ? ".06em" : "0",
});

/* ── Row 5: paired detail columns ──────────────────────────────────── */

export const blockRow: CSSProperties = {
  flex: "none",
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "8px",
  padding: "0 8px 8px",
  boxSizing: "border-box",
  alignItems: "start",
};

export const blockCard: CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.panelLine}`,
  borderRadius: "8px",
  padding: "7px 9px",
  display: "flex",
  flexDirection: "column",
  gap: "5px",
  overflow: "hidden",
};

export const blockTitle: CSSProperties = {
  font: `700 8px/1 ${SANS}`,
  letterSpacing: ".1em",
  color: C.muted2,
  borderBottom: `1px solid ${C.line}`,
  paddingBottom: "5px",
};

/*
The label/value grid inside a detail block.

The value column was `auto`, which for a grid means "as wide as the widest
value". A bitfield decodes to a comma list — "Parallel Mode, Master Unit,
Grid Connection, Emergency Mode" — so one such row set the column width for
the whole block and shoved every label off the left edge.

`minmax(0, 1fr)` on BOTH columns caps them instead: neither can outgrow its
share, and each cell is then free to wrap or ellipsise inside it.
*/
export const blockGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: "2px 8px",
  font: `400 10px/1.55 ${MONO}`,
  alignContent: "start",
};

export const rowLabel: CSSProperties = {
  color: C.muted,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};

export const rowReg: CSSProperties = {
  // Sits on the themed row background, so it must follow it.
  color: "var(--solis-data-rowReg, #b3bfcf)",
};

/*
A value cell.

`whiteSpace: nowrap` used to force a long bit list onto one endless line.
Values WRAP now: a register that reports six set flags is genuinely six
pieces of information, and truncating it to "Parallel Mode, Mas..." hides
the ones that matter. `overflowWrap` breaks a single over-long token rather
than letting it push the column.
*/
export const val = (
  color?: string,
  strong?: boolean,
  calc?: boolean,
): CSSProperties => ({
  font: `${calc ? "italic " : ""}${strong ? "600" : "500"} 10px/1.55 ${MONO}`,
  color: color || C.ink,
  textAlign: "right",
  minWidth: 0,
  overflowWrap: "anywhere",
});

/* ── Row 6: horizontal bar panel ───────────────────────────────────── */

export const barPanel: CSSProperties = {
  flex: 1,
  minHeight: "120px",
  display: "flex",
  flexDirection: "column",
  margin: "0 8px 8px",
  background: C.panel,
  border: `1px solid ${C.panelLine}`,
  borderRadius: "8px",
  overflow: "hidden",
};

export const barHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "5px 9px",
  borderBottom: `1px solid ${C.line}`,
};

export const barTitle: CSSProperties = {
  font: `700 8px/1 ${SANS}`,
  letterSpacing: ".1em",
  color: C.ink3,
  whiteSpace: "nowrap",
};

export const barNote: CSSProperties = {
  font: `400 8px/1 ${MONO}`,
  color: C.muted2,
  whiteSpace: "nowrap",
  flex: "none",
};

export const barGrid: CSSProperties = {
  /* Each bar spends 74 px on its label and 62 px on its value, so two
     columns need ~2 x 200 px before the track itself vanishes. */
  minWidth: "400px",
  flex: 1,
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "2px 14px",
  padding: "6px 9px",
  alignContent: "space-between",
};

/*
One bar: label, track, value.

The label column was 74px, which clipped almost every real register name
("operating Status" became "operating St…"). A truncated label defeats the
point of the bar — you cannot tell which register you are looking at. 108px
fits the names this panel actually produces; the track absorbs the loss.
*/
export const barRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "108px minmax(0, 1fr) 62px",
  gap: "7px",
  alignItems: "center",
};

export const barLabel: CSSProperties = {
  /* 9px rather than 10px: these are register names, not headings, and the
     extra character or two is worth more than the size here. The full name
     is on the title attribute either way. */
  font: `500 9px/1.2 ${MONO}`,
  color: "var(--solis-data-barLabel, #476080)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};

export const barTrack: CSSProperties = {
  height: "7px",
  borderRadius: "4px",
  background: C.line,
  overflow: "hidden",
  display: "block",
};

export const barFill = (pct: number, color?: string): CSSProperties => ({
  display: "block",
  height: "7px",
  borderRadius: "4px",
  width: `${Math.max(0, Math.min(100, pct))}%`,
  background: color || C.blue,
});

export const barValue = (color?: string, calc?: boolean): CSSProperties => ({
  font: `${calc ? "italic " : ""}500 10px/1 ${MONO}`,
  color: color || C.ink2,
  textAlign: "right",
  whiteSpace: "nowrap",
});

/* ── Phase table ────────────────────────────────────────────────────── */

/**
 * AMBER MARKS A CALCULATED VALUE.
 *
 * `bodyCell` already slants calculated values, and its comment argues against
 * colouring them because colour carries meaning elsewhere (purple = active
 * power, red/green = sign). The phase table overrides that on purpose: when
 * every cell shows its own register, a cell showing a FORMULA instead needs to
 * be unmistakable at a glance. "Is this measured?" outranks "is this positive?".
 */
/*
 * The amber that marks a CALCULATED cell -- one summed or derived rather than
 * read from a register.
 *
 * Themeable like the palette above: on a dark surface this ported amber drops
 * to about 2.9:1 against the background, which is below the 4.5:1 that makes
 * small text readable. The apps hand it a lighter amber where the surface is
 * dark; the extension keeps the design's own.
 */
export const CALC_AMBER = "var(--solis-data-calcAmber, #c98a06)";

export const phaseGrid = (cols: number): CSSProperties => ({
  minWidth: `${72 + cols * 78}px`,
  display: "grid",
  gridTemplateColumns: `.8fr repeat(${cols},1fr)`,
});

export const phaseHeadCell = (first: boolean): CSSProperties => ({
  font: `700 8px/1 ${SANS}`,
  letterSpacing: ".08em",
  color: "#ffffff",
  padding: "5px 8px",
  background: C.blue,
  textAlign: first ? "left" : "right",
  whiteSpace: "nowrap",
});

export const phaseBodyCell = (o: {
  first?: boolean;
  zebra?: boolean;
  color?: string;
  strong?: boolean;
  calc?: boolean;
} = {}): CSSProperties => ({
  font: `${o.calc ? "italic " : ""}${o.strong || o.first ? "600" : "400"} 10px/1.15 ${MONO}`,
  color: o.calc ? CALC_AMBER : o.color || C.ink2,
  padding: "5px 8px",
  textAlign: o.first ? "left" : "right",
  background: o.zebra ? C.zebra : "transparent",
  whiteSpace: "nowrap",
  letterSpacing: o.first ? ".06em" : "0",
});

/** The register number, or a formula, riding beside its value. */
export const cellReg: CSSProperties = {
  color: C.grey,
  fontSize: "7.5px",
  fontStyle: "normal",
  marginLeft: "3px",
};

export const stripRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  borderTop: `1px solid ${C.line}`,
};

export const stripItem: CSSProperties = {
  flex: "1 1 0",
  minWidth: "88px",
  padding: "4px 8px",
  borderRight: `1px solid ${C.line}`,
  boxSizing: "border-box",
};

export const stripLabel: CSSProperties = {
  font: `700 7px/1.2 ${SANS}`,
  letterSpacing: ".08em",
  color: C.muted2,
};

export const stripValue = (calc?: boolean): CSSProperties => ({
  font: `${calc ? "italic " : ""}500 10px/1.3 ${MONO}`,
  color: calc ? CALC_AMBER : C.ink2,
});

export const legendRow: CSSProperties = {
  font: `400 8px/1.4 ${MONO}`,
  color: C.muted2,
  padding: "5px 9px",
  borderTop: `1px solid ${C.line}`,
};
