/**
 * The reusable panel renderer for the DATA widgets.
 *
 * The design port originally arrived as one `HybridDataView` component that
 * owned both this layout and its own five-tab chrome, shown behind a single
 * "Panels" button. That duplicated the widget row above it, which already IS
 * the tab row. So the tabbed wrapper is gone and the pure presentation lives
 * here: it takes a `TabModel`, and each widget supplies its own.
 *
 * Sections are optional. A widget with no KPIs, no bars or only one detail
 * block simply omits them and nothing empty is drawn.
 */
import React from "react";
import * as S from "./panelStyles";
import { TabModel, MatrixCell, DetailRow, BarItem, Kpi } from "./tabModel";

export interface DataPanelProps {
  /** What to draw. Any section left empty is skipped. */
  model: TabModel;
  /**
   * The panel's name.
   *
   * No longer drawn — the widget-button row above already names it. Kept as
   * the region's accessible label so the panel is still announced, and so
   * callers do not all have to change.
   */
  title: string;
}

const DataPanel: React.FC<DataPanelProps> = ({ model, title }) => {
  const hasKpis = model.kpis.length > 0;
  const hasMatrix = model.matrixRows.length > 0;
  const hasBlocks = model.blocks.length > 0;
  const hasBars = model.extra.bars.length > 0;

  return (
    <div style={S.shell} role="region" aria-label={title}>
      {/* The register range only. The panel's NAME is not repeated here: the
          widget-button row directly above already shows it, highlighted, so a
          second copy inside the panel spent a whole row saying nothing new. */}
      <div style={S.tabRow}>
        <span style={S.spacer} />
        <span style={S.regRange}>reg {model.regRange}</span>
      </div>

      {hasKpis && (
        <div style={S.kpiStrip}>
          {model.kpis.map((k: Kpi, i: number) => (
            <div key={i} style={S.kpiTile}>
              <div style={S.kpiLabel}>{k.label}</div>
              <div style={S.kpiValueRow}>
                <span style={S.bigVal(k.color)}>{k.value}</span>
                {k.unit && <span style={S.kpiUnit}>{k.unit}</span>}
              </div>
              <div style={S.kpiSub}>{k.sub}</div>
            </div>
          ))}
        </div>
      )}

      {hasMatrix && (
        <div style={S.matrixWrap}>
          <div style={S.matrixCard}>
            <div style={S.matrixHeader}>
              <span style={S.matrixTitle}>{model.matrixTitle}</span>
              <span style={S.matrixNote}>{model.matrixNote}</span>
            </div>
            <div style={S.scrollX}>
              <div style={S.matrixGrid(model.matrixCols.length)}>
                {model.matrixCols.map((c, i) => (
                  <div key={`h${i}`} style={S.headCell(i === 0)}>
                    {c.label}
                    {c.reg && <span style={S.headReg}> {c.reg}</span>}
                  </div>
                ))}
                {model.matrixRows.flatMap((cells, ri) =>
                  cells.map((cell: MatrixCell, ci: number) => (
                    <div
                      key={`c${ri}-${ci}`}
                      style={S.bodyCell({
                        first: ci === 0,
                        zebra: ri % 2 === 1,
                        color: cell.color,
                        strong: ci === 0 || cell.strong,
                        calc: cell.calc,
                      })}
                    >
                      {cell.text}
                    </div>
                  )),
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {hasBlocks && (
        <div style={S.blockRow}>
          {model.blocks.map((b, bi) => (
            <div key={bi} style={S.blockCard}>
              <div style={S.blockTitle}>{b.title}</div>
              <div style={S.blockGrid}>
                {b.rows.flatMap((r: DetailRow, ri: number) => [
                  <span key={`l${ri}`} style={S.rowLabel} title={r.note}>
                    {r.label}
                    <span style={S.rowReg}> {r.reg}</span>
                  </span>,
                  <span
                    key={`v${ri}`}
                    style={S.val(r.color, false, r.calc)}
                    title={r.note}
                  >
                    {r.value}
                  </span>,
                ])}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasBars && (
        <div style={S.barPanel}>
          <div style={S.barHeader}>
            <span style={S.barTitle}>{model.extra.title}</span>
            <span style={S.barNote}>{model.extra.note}</span>
          </div>
          <div style={S.scrollX}>
            <div style={S.barGrid}>
              {model.extra.bars.map((b: BarItem, i: number) => (
                <div key={i} style={S.barRow}>
                  <span style={S.barLabel} title={b.label}>
                    {b.label}
                  </span>
                  <span style={S.barTrack}>
                    <span style={S.barFill(b.pct, b.color)} />
                  </span>
                  <span style={S.barValue(b.color, b.calc)}>{b.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataPanel;
