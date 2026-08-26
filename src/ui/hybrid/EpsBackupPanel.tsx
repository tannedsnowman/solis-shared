/**
 * EPS / BACKUP, in the Detail Panels style.
 *
 * The off-grid output subsystem: the backup port's per-phase voltage, current
 * and power, the reference the inverter regulates it to, the transfer timing
 * and the cut-off SOCs that decide when it stops. `deviceAllTab` carries three
 * backup words inside its AC-ports summary; this is the deep view of the same
 * port and everything around it.
 *
 * The content is `epsBackupTab`, written against the gospel, and the layout is
 * the shared `DataPanel`.
 */
import React, { useEffect } from 'react'
import DataPanel from '../data/DataPanel'
import type { RawReader } from '../data/rawReader';
import {
  epsBackupTab,
  withAddresses,
} from '../data/tabModel'

interface EpsBackupPanelProps {
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

const EpsBackupPanel: React.FC<EpsBackupPanelProps> = ({ onAddresses, reader }) => {
  const read = reader
  const model = withAddresses(epsBackupTab, read)

  useEffect(() => {
    onAddresses?.(model.addresses)
    // The address list is fixed by which registers epsBackupTab reads, so it
    // only needs reporting when its contents change, not on every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(',')])

  return <DataPanel title="EPS / BACKUP" model={model} />
}

export default EpsBackupPanel
