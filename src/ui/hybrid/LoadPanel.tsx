/**
 * LOAD, in the phase-table style.
 *
 * Grid-side (normal running) and backup-side (EPS on battery/generator)
 * house load, each with its own REAL total register -- see `loadTable`'s own
 * doc comment for why neither total is summed from phases.
 */
import React, { useEffect } from 'react';
import PhaseTableView from '../data/PhaseTableView';
import type { RawReader } from '../data/rawReader';
import { loadTable } from '../data/phaseTable';

interface LoadPanelProps {
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

const LoadPanel: React.FC<LoadPanelProps> = ({ onAddresses, reader }) => {
  const model = loadTable(reader);

  useEffect(() => {
    onAddresses?.(model.addresses);
    // The address list is fixed by which registers loadTable reads, so it
    // only needs reporting when its contents change, not on every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(',')]);

  return <PhaseTableView title="LOAD" model={model} />;
};

export default LoadPanel;
