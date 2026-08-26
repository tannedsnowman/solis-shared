/**
 * GRID METER, in the phase-table style.
 *
 * Replaces the old `Meter.tsx`, which read the parsed `variables` prop and
 * decoded through the legacy mapper. This reads the RAW register store and
 * decodes through the gospel, so scale, sign, units, enum labels and bit
 * lists all come from the register record rather than from a table written in
 * the widget.
 *
 * Previously built on `gridTab` + `DataPanel`, which drew this same phase
 * matrix AND, underneath it, a PHASE BALANCE bar panel re-plotting the same
 * per-phase active power and voltage as bars -- the user's reported
 * duplication. `gridMeterTable` + `PhaseTableView` draws just the matrix.
 * `gridTab` itself is left alone in `tabModel.ts`; Task 9 removes its last
 * caller.
 */
import React, { useEffect } from 'react';
import PhaseTableView from '../data/PhaseTableView';
import type { RawReader } from '../data/rawReader';
import { gridMeterTable } from '../data/phaseTable';

interface GridMeterPanelProps {
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

const GridMeterPanel: React.FC<GridMeterPanelProps> = ({ onAddresses, reader }) => {
  const model = gridMeterTable(reader);

  useEffect(() => {
    onAddresses?.(model.addresses);
    // The address list is fixed by which registers gridMeterTable reads, so
    // it only needs reporting when its contents change, not on every poll
    // tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(',')]);

  return <PhaseTableView title="GRID METER" model={model} />;
};

export default GridMeterPanel;
