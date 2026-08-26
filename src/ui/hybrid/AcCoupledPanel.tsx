/**
 * AC COUPLED, in the phase-table style.
 *
 * A PV (grid-tied) inverter wired into the Smart port. Shares the port's own
 * V/I/per-phase-P registers with the generator and smart-load roles (see
 * `smartPortRows` in `phaseTable.ts`); its own total and energy counters are
 * what make this widget distinct.
 */
import React, { useEffect } from 'react';
import PhaseTableView from '../data/PhaseTableView';
import type { RawReader } from '../data/rawReader';
import { acCoupledTable } from '../data/phaseTable';

interface AcCoupledPanelProps {
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

const AcCoupledPanel: React.FC<AcCoupledPanelProps> = ({ onAddresses, reader }) => {
  const model = acCoupledTable(reader);

  useEffect(() => {
    onAddresses?.(model.addresses);
    // The address list is fixed by which registers acCoupledTable reads, so
    // it only needs reporting when its contents change, not on every poll
    // tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(',')]);

  return <PhaseTableView title="AC COUPLED" model={model} />;
};

export default AcCoupledPanel;
