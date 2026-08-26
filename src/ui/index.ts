/**
 * The shared CARDS: presentation only.
 *
 * Everything exported here draws what it is handed. Nothing here reads
 * `localStorage`, calls Modbus, or knows which app it is running in -- each
 * app keeps its own back end (its raw-register readers and its register-write
 * hooks) and passes the results in as props. That separation is what lets the
 * extension and SolisConnect render the same card without sharing a transport.
 *
 * See `tsconfig.ui.json` for why this subtree gets the DOM lib and the rest of
 * the package does not.
 *
 * NO FLAT BARREL FOR THE THEMES. `theme`, `tableTheme` and `panelStyles` each
 * export short names of their own (`C`, `chip`, `headCell`), and three of
 * those collide. Re-exporting them side by side here would force the callers
 * to rename at the import site, which is exactly the churn this move is meant
 * to avoid. Import a theme by its own subpath instead:
 *
 *     import { staleStyle } from '@solis/shared/ui/settings/tableTheme'
 *
 * The card components have no such collisions and are re-exported flat.
 */
export * from './settings/GroupView';

/*
 * The PV settings MODELS. Each names its registers, decodes its words and
 * builds its rows from the gospel, with no renderer and no transport -- which
 * is why they are cards by the rule above and are proven without a DOM.
 *
 * Exported by subpath rather than flat: several models export the same short
 * names (`ROWS`, `ADDRESSES`, `isReachable`) for their own screen, so a flat
 * barrel would collide. Import the one you want:
 *
 *     import { DERATING_MODE } from '@solis/shared/ui/pv/pvFrequencyDeratingModel'
 */

/*
 * The READER CONTRACT the cards use to fetch register words.
 *
 * Types only -- there is no implementation here and there must not be. A
 * reader reaches for app state (the extension's localStorage store, the Tauri
 * bridge's), which is exactly what `tsconfig.ui.json` forbids under `src/ui`.
 * Each app builds its own and hands it in.
 *
 * This is exported flat because it is one small vocabulary with no name
 * collisions, and because every card that reads registers needs it.
 */
export type { RawEntry, RawStore, RawReader } from './data/rawReader';

/*
 * Turning a stored reading into row text. `rawOf` and `currentText` are pure
 * and collide with nothing, so they are flat.
 */
export * from './settings/reading';

/*
 * The PV WRITE contract. Types only -- the transport is each app's own.
 */
export type { PvWriter, PvWriteRequest, PvWriteOutcome } from './pv/pvWrite';

/*
 * The HYBRID WRITE contract. Types only, like the PV one -- and a SEPARATE
 * type on purpose. See `settings/hybridWrite.ts` for why the four write hooks
 * are not merged.
 */
export type {
  HybridWriter,
  HybridWriteRequest,
  HybridWriteOutcome,
} from './settings/hybridWrite';

/*
 * The HYBRID DATA cards: the models that turn register words into rows, and
 * the three renderers that draw them.
 *
 * Exported by SUBPATH, not flat, for the same reason the PV models are. Each
 * model exports the short names its own screen wants (`row`, `bar`, `phase`)
 * and several collide across families; `decode.ts` exports `decodeAddress`,
 * which `decodePv` also wants to. Import the one you mean:
 *
 *     import { loadTable } from '@solis/shared/ui/data/phaseTable'
 *     import PhaseTableView from '@solis/shared/ui/data/PhaseTableView'
 *
 * These are cards by the rule at the top of this file: they take a
 * `RawReader` and return rows, or take rows and return JSX. Not one of them
 * knows which app it is drawing in.
 */
