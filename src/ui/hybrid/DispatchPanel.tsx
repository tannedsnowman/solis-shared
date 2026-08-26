/**
 * REMOTE DISPATCH, in the Detail Panels style.
 *
 * Replaces the old `RemoteDispatchWidget.tsx`, which read the parsed
 * `variables` prop and carried its own DISPATCH_STATUS / AC_COUPLING_STATUS
 * tables in the file. Those enum labels now live in the gospel record for
 * 34504, so the widget no longer decides what a code means.
 *
 * The content is `dispatchTab` and the layout is the shared `DataPanel`.
 */
import React, { useEffect } from 'react'
import DataPanel from '../data/DataPanel'
import type { RawReader } from '../data/rawReader';
import {
  dispatchTab,
  withAddresses,
} from '../data/tabModel'

interface DispatchPanelProps {
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

const DispatchPanel: React.FC<DispatchPanelProps> = ({ onAddresses, reader }) => {
  const read = reader
  const model = withAddresses(dispatchTab, read)

  useEffect(() => {
    onAddresses?.(model.addresses)
    // The address list is fixed by which registers dispatchTab reads, so it
    // only needs reporting when its contents change, not on every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(',')])

  return <DataPanel title="REMOTE DISPATCH" model={model} />
}

export default DispatchPanel
