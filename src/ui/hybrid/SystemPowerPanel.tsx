/**
 * SYSTEM POWER — the parallel / whole-installation view.
 *
 * Every other DATA panel answers "what is THIS inverter doing". This one
 * answers "what is the INSTALLATION doing", by reading the aggregate blocks
 * the parallel master publishes: the parallel-system totals, their 32-bit
 * fine-grained twins, and the module-6 PV+hybrid system block that also covers
 * the grid-tied (PV-only) inverters.
 *
 * The content is `systemPowerTab`, written against the gospel so scale, sign,
 * units and enum labels all come from the register record; the layout is the
 * shared `DataPanel`.
 */
import React, { useEffect } from "react";
import DataPanel from '../data/DataPanel';
import type { RawReader } from '../data/rawReader';
import {
  systemPowerTab,
  withAddresses,
} from '../data/tabModel';

interface SystemPowerPanelProps {
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

const SystemPowerPanel: React.FC<SystemPowerPanelProps> = ({ onAddresses, reader }) => {
  const read = reader
  const model = withAddresses(systemPowerTab, read);

  useEffect(() => {
    onAddresses?.(model.addresses);
    // The address list is fixed by which registers systemPowerTab reads, so it
    // only needs reporting when its contents change, not on every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(",")]);

  return <DataPanel title="SYSTEM POWER" model={model} />;
};

export default SystemPowerPanel;
