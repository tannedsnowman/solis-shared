/**
 * BUILT-IN METER, in the Detail Panels style.
 *
 * Deliberately NOT the same measurement point as `GridMeterPanel`. That panel
 * reads the EXTERNAL meter / CT at 33250-33290; this one reads the inverter's
 * OWN INTERNAL meter at 34292-34326, plus the load-measurement blocks (grid-
 * side load, smart port, smart load, SPH cabinet) that the inverter measures
 * for itself and that had no panel before.
 *
 * The title says INTERNAL and the matrix note names the external block, so a
 * user reading two open panels can never mistake one meter for the other.
 *
 * The content is `builtInMeterTab` — raw registers decoded through the gospel,
 * so scale, sign, units and enum labels all come from the register record —
 * and the layout is the shared `DataPanel`.
 */
import React, { useEffect } from "react";
import DataPanel from '../data/DataPanel';
import type { RawReader } from '../data/rawReader';
import {
  builtInMeterTab,
  withAddresses,
} from '../data/tabModel';

interface BuiltInMeterPanelProps {
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

const BuiltInMeterPanel: React.FC<BuiltInMeterPanelProps> = ({ onAddresses, reader }) => {
  const read = reader
  const model = withAddresses(builtInMeterTab, read);

  useEffect(() => {
    onAddresses?.(model.addresses);
    // The address list is fixed by which registers builtInMeterTab reads, so
    // it only needs reporting when its contents change, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(",")]);

  return <DataPanel title="BUILT-IN METER (INTERNAL)" model={model} />;
};

export default BuiltInMeterPanel;
