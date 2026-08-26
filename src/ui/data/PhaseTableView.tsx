/**
 * Renders a `PhaseTableModel`: phases down the side, quantities across the
 * top, and a register number beside every single value.
 *
 * Deliberately has no KPI strip and no bars. The point of this layout is that
 * several widgets fit on one screen, and a KPI tile spends 80px restating one
 * number the table already holds.
 *
 * Named `PhaseTableView`, not `PhaseTable`, because the model this renders
 * lives in the sibling `phaseTable.ts`. Windows' filesystem is
 * case-insensitive, so `PhaseTable.tsx` next to `phaseTable.ts` is not two
 * files to Jest's resolver there — one import silently returned the other
 * module's (typeless) exports as `undefined`. `phaseTable.ts` is already
 * committed from Tasks 1-2, so the renderer takes the differently-cased name.
 */
import React from "react";
import * as S from "./panelStyles";
import { PhaseTableModel, PhaseCell, StripCell } from "./phaseTable";

export interface PhaseTableProps {
  model: PhaseTableModel;
  title: string;
}

const Strip: React.FC<{ items: StripCell[] }> = ({ items }) =>
  items.length === 0 ? null : (
    <div style={S.stripRow}>
      {items.map((s, i) => (
        <div key={i} style={S.stripItem}>
          <div style={S.stripLabel}>{s.label}</div>
          <div style={S.stripValue(s.calc)}>
            {s.value}
            {s.reg && <span style={S.cellReg}>{s.reg}</span>}
          </div>
        </div>
      ))}
    </div>
  );

const PhaseTable: React.FC<PhaseTableProps> = ({ model, title }) => (
  <div style={S.shell} role="region" aria-label={title}>
    <div style={S.tabRow}>
      <span style={S.spacer} />
      <span style={S.regRange}>reg {model.regRange}</span>
    </div>

    <div style={S.matrixWrap}>
      <div style={S.matrixCard}>
        <div style={S.scrollX}>
          <div style={S.phaseGrid(model.columns.length)}>
            <div style={S.phaseHeadCell(true)}>PHASE</div>
            {model.columns.map((c, i) => (
              <div key={`h${i}`} style={S.phaseHeadCell(false)}>
                {c}
              </div>
            ))}
            {model.rows.flatMap((r, ri) => [
              <div
                key={`l${ri}`}
                style={S.phaseBodyCell({ first: true, zebra: ri % 2 === 1 })}
              >
                {r.label}
              </div>,
              ...r.cells.map((cell: PhaseCell, ci: number) => (
                <div
                  key={`c${ri}-${ci}`}
                  style={S.phaseBodyCell({
                    zebra: ri % 2 === 1,
                    color: cell.color,
                    strong: cell.strong,
                    calc: cell.calc,
                  })}
                >
                  {cell.text}
                  {cell.reg && <span style={S.cellReg}>{cell.reg}</span>}
                </div>
              )),
            ])}
          </div>
        </div>
        <Strip items={model.strip} />
        <Strip items={model.energy} />
        {model.legend && <div style={S.legendRow}>{model.legend}</div>}
      </div>
    </div>
  </div>
);

export default PhaseTable;
