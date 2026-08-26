/**
 * GRID PORT, in the phase-table style.
 *
 * Moved off the crowded Device tab into a panel of its own so it can show
 * all three phases. This is the first widget with a genuinely calculated
 * column -- per-phase S has no register on this port, so `gridPortTable`
 * derives it as `V x I` and renders it amber/italic, next to a TOTAL row
 * whose S comes from a real register (33083) and renders upright. See
 * `gridPortTable`'s own doc comment in `phaseTable.ts` for the full register
 * accounting.
 */
import React, { useEffect } from 'react';
import PhaseTableView from '../data/PhaseTableView';
import type { RawReader } from '../data/rawReader';
import { gridPortTable } from '../data/phaseTable';

interface GridPortPanelProps {
  /**
   * Told which registers this panel reads, so the range-button row above can
   * shade the blocks that fill it. Called on every build; the parent is
   * expected to store it only when the list actually changes.
   */
  onAddresses?: (addresses: number[]) => void;
  /**
   * Where the register words come from.
   *
   * REQUIRED HERE, unlike in the extension's own copy. A shared card has no
   * app to fall back to: the extension hands in its localStorage-backed
   * `useRawRegisters`, SolisConnect hands in a reader over its Tauri store,
   * and this file must not know which it got.
   */
  reader: RawReader;
}

const GridPortPanel: React.FC<GridPortPanelProps> = ({ onAddresses, reader }) => {
  const model = gridPortTable(reader);

  useEffect(() => {
    onAddresses?.(model.addresses);
    // The address list is fixed by which registers gridPortTable reads, so
    // it only needs reporting when its contents change, not on every poll
    // tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(',')]);

  return <PhaseTableView title="GRID PORT" model={model} />;
};

export default GridPortPanel;
