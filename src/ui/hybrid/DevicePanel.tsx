/**
 * DEVICE, in the Detail Panels style.
 *
 * Replaces BOTH the old `DeviceWidget.jsx` and `BatteryFunctions.tsx`, which
 * read the parsed `variables` prop and decoded through the legacy mapper.
 * This reads the RAW register store and decodes through the gospel, so scale,
 * sign, units, enum labels and bit lists all come from the register record
 * rather than from tables written in the widget.
 *
 * The content is `deviceAllTab` and the layout is the shared `DataPanel`.
 */
import React, { useEffect } from 'react'
import DataPanel from '../data/DataPanel'
import type { RawReader } from '../data/rawReader';
import {
  deviceAllTab,
  withAddresses,
} from '../data/tabModel'

interface DevicePanelProps {
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

const DevicePanel: React.FC<DevicePanelProps> = ({ onAddresses, reader }) => {
  const read = reader
  const model = withAddresses(deviceAllTab, read)

  useEffect(() => {
    onAddresses?.(model.addresses)
    // The address list is fixed by which registers deviceAllTab reads, so it
    // only needs reporting when its contents change, not on every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(',')])

  return <DataPanel title="DEVICE" model={model} />
}

export default DevicePanel
