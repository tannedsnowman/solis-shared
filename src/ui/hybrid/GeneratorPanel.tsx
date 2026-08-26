/**
 * GENERATOR, in the phase-table style.
 *
 * New rather than a replacement. The SETTINGS side has had a GENERATOR tab for
 * a while (`Hybrid/Settings/GeneratorCharging.tsx`), so a user could configure
 * start/stop SOC, charge current and run windows — but nothing on the DATA
 * side ever reported back what the generator did with any of it. This panel is
 * that missing half.
 *
 * Repointed from the old `generatorTab` + `DataPanel` (Detail Panels style) to
 * `generatorTable2` + `PhaseTableView` (the dense phase-table style shared by
 * the other port/meter widgets) -- see `generatorTable2`'s own doc comment for
 * the register-by-register account, including the missing phase B/C voltage
 * and the 34617 total-register reachability caveat. `generatorTab` itself is
 * left alone in `tabModel.ts`; Task 9 removes its last caller.
 */
import React, { useEffect } from 'react'
import PhaseTableView from '../data/PhaseTableView'
import type { RawReader } from '../data/rawReader';
import { generatorTable2 } from '../data/phaseTable'

interface GeneratorPanelProps {
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

const GeneratorPanel: React.FC<GeneratorPanelProps> = ({ onAddresses, reader }) => {
  const read = reader
  const model = generatorTable2(read)

  useEffect(() => {
    onAddresses?.(model.addresses)
    // The address list is fixed by which registers generatorTable2 reads, so
    // it only needs reporting when its contents change, not on every poll
    // tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.addresses.join(',')])

  return <PhaseTableView title="GENERATOR" model={model} />
}

export default GeneratorPanel
