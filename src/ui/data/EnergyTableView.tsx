/**
 * Renders an `EnergyTableModel`: one togglable row per energy category, with
 * TODAY/YESTERDAY/MONTH/YEAR/TOTAL across the top and a register number
 * beside every value that has one.
 *
 * Named `EnergyTableView`, not `EnergyTable`, for the same reason
 * `PhaseTableView.tsx` is not `PhaseTable.tsx`: on Windows' case-insensitive
 * filesystem, `EnergyTable.tsx` next to the sibling `energyTable.ts` model
 * would collide -- Jest's resolver treats them as the same file and the
 * import silently comes back `undefined`. The exported component itself is
 * still called `EnergyTable`.
 */
import React from "react";
import * as S from "./panelStyles";
import { EnergyTableModel } from "./energyTable";
import { PhaseCell } from "./phaseTable";

export interface EnergyTableProps {
  model: EnergyTableModel;
  title: string;
}

export const EnergyTable: React.FC<EnergyTableProps> = ({ model, title }) => (
  <div style={S.shell} role="region" aria-label={title}>
    <div style={S.matrixWrap}>
      <div style={S.matrixCard}>
        <div style={S.scrollX}>
          <div style={S.phaseGrid(model.columns.length)}>
            <div style={S.phaseHeadCell(true)}>CATEGORY</div>
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
      </div>
    </div>
  </div>
);

export default EnergyTable;
