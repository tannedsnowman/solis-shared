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
