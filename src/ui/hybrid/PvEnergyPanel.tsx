/**
 * PV, in the Detail Panels style.
 *
 * Replaces three legacy widgets in one panel: `Meter2.tsx` (AC-coupled PV),
 * `Energy.tsx` (PV yield) and `SystemEnergy.tsx` (grid/load/battery totals).
 * All three read the parsed `variables` prop and decoded through the legacy
 * mapper; this reads the RAW register store and decodes through the gospel, so
 * scale, sign and units come from the register record rather than from a table
 * written in the widget.
 *
 * The content is `pvEnergyTab` and the layout is the shared `DataPanel`.
 */
import React, { useEffect } from 'react'
import DataPanel from '../data/DataPanel'
import type { RawReader } from '../data/rawReader';
import {
  pvEnergyTab,
  withAddresses,
} from '../data/tabModel'

interface PvEnergyPanelProps {
  /**
   * Told which registers this panel reads, so the range-button row above can
   * shade the blocks that fill it. Called on every build; the parent is
   * expected to store it only when the list actually changes.
   */
  onAddresses?: (addresses: number[]) => void
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

const PvEnergyPanel: React.FC<PvEnergyPanelProps> = ({ onAddresses, reader }) => {
  const read = reader
  const model = withAddresses(pvEnergyTab, read)

  useEffect(() => {
    onAddresses?.(model.addresses)
    // The address list is fixed by which registers pvEnergyTab reads, so it
    // only needs reporting when its contents change, not on every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(',')])

  return <DataPanel title="PV" model={model} />
}

export default PvEnergyPanel
