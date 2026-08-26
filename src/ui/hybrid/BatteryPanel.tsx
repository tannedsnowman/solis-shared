/**
 * BATTERY, in the phase-table style.
 *
 * Replaces THREE legacy widgets in one panel: `Battery.tsx` (pack 1),
 * `BMSWidget.tsx` (pack 2) and `BatteryEnergy.tsx` (the kWh counters). All
 * three read the parsed `variables` prop and decoded through the legacy
 * mapper. This reads the RAW register store and decodes through the gospel, so
 * scale, sign, units, enum labels and bit lists all come from the register
 * record rather than from tables written in the widgets.
 *
 * Merging them is not just tidying: an installer comparing the two packs
 * previously had to open two panels to do it, and the energy totals that tell
 * you whether either pack is actually cycling sat in a third.
 *
 * THIS PANEL IS WHY THE RESTRUCTURE EXISTS. The old battery matrix put each
 * register number in the COLUMN HEADER, so pack 2's row appeared to read the
 * same registers as pack 1's -- an installer chasing a pack 2 fault would
 * fetch pack 1's block and misdiagnose a live site. `batteryPacksTable` puts
 * the address on every cell instead, so `PhaseTableView` (not `DataPanel`,
 * which has no per-cell register slot) is the renderer here.
 */
import React, { useEffect } from 'react';
import PhaseTableView from '../data/PhaseTableView';
import type { RawReader } from '../data/rawReader';
import { batteryPacksTable } from '../data/phaseTable';

interface BatteryPanelProps {
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

const BatteryPanel: React.FC<BatteryPanelProps> = ({ onAddresses, reader }) => {
  const model = batteryPacksTable(reader);

  useEffect(() => {
    onAddresses?.(model.addresses);
    // The address list is fixed by which registers batteryPacksTable reads,
    // so it only needs reporting when its contents change, not on every poll
    // tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(',')]);

  return <PhaseTableView title="BATTERY" model={model} />;
};

export default BatteryPanel;
