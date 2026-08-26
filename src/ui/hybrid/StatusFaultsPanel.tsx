/**
 * STATUS, in the Detail Panels style.
 *
 * Replaces the two old widgets `HybridStatusWidget` and `HybridFaultWidget`.
 * Both read the parsed `variables` prop and decoded through the legacy mapper's
 * hand-written bit tables; this reads the RAW register store and decodes
 * through the gospel, so every enum label and bit name comes out of the
 * register record rather than out of a table copied into the widget.
 *
 * Status and faults are one panel because they answer one question. A fault
 * word tells you WHAT tripped; 33095 and 33121 tell you whether the inverter
 * is standing by, derating or actually stopped. Reading either alone means
 * switching widgets to finish the thought.
 *
 * The content is `statusFaultsTab` and the layout is the shared `DataPanel`.
 */
import React, { useEffect } from 'react'
import DataPanel from '../data/DataPanel'
import type { RawReader } from '../data/rawReader';
import {
  statusFaultsTab,
  withAddresses,
} from '../data/tabModel'

interface StatusFaultsPanelProps {
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

const StatusFaultsPanel: React.FC<StatusFaultsPanelProps> = ({ onAddresses, reader }) => {
  const read = reader
  const model = withAddresses(statusFaultsTab, read)

  useEffect(() => {
    onAddresses?.(model.addresses)
    // The address list is fixed by which registers statusFaultsTab reads, so
    // it only needs reporting when its contents change, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(',')])

  return <DataPanel title="STATUS" model={model} />
}

export default StatusFaultsPanel
