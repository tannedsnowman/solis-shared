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
