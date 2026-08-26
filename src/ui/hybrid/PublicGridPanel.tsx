/**
 * PUBLIC GRID, in the Detail Panels style.
 *
 * The sibling of `GridMeterPanel`, and deliberately a separate widget rather
 * than more rows on that one. GRID METER draws 33251-33286, which is the
 * external meter reporting itself from wherever it is clamped. This panel
 * draws 33540-33575, the reading referred to the public grid connection
 * point. On a load-side CT install the two differ by the house load, and
 * showing them in one panel would read as the inverter contradicting itself.
 *
 * Content is `publicGridTab`, layout is the shared `DataPanel`.
 */
import React, { useEffect } from 'react'
import DataPanel from '../data/DataPanel'
import type { RawReader } from '../data/rawReader';
import {
  publicGridTab,
  withAddresses,
} from '../data/tabModel'

interface PublicGridPanelProps {
  /**
   * Told which registers this panel reads, so the range-button row above can
   * shade the blocks that fill it.
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

const PublicGridPanel: React.FC<PublicGridPanelProps> = ({ onAddresses, reader }) => {
  const read = reader
  const model = withAddresses(publicGridTab, read)

  useEffect(() => {
    onAddresses?.(model.addresses)
    // The address list is fixed by which registers publicGridTab reads, so it
    // only needs reporting when its contents change, not on every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(',')])

  return <DataPanel title="PUBLIC GRID" model={model} />
}

export default PublicGridPanel
