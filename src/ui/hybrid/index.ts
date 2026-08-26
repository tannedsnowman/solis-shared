/**
 * The HYBRID DATA panels.
 *
 * Sixteen cards, each one props-in and JSX-out: give it a `RawReader` and it
 * draws its rows. Not one of them knows which app it is in -- the extension
 * hands in a reader over its localStorage store, SolisConnect hands in one
 * over its Tauri store, and both get the same screen.
 *
 * `reader` is REQUIRED here, where the extension's own wrappers make it
 * optional. A shared card has no app default to fall back to; that is the
 * difference between a card and a page.
 *
 * NOT HERE, and why: `Cei` and `SystemDiagram` call `sendModbusCommand`,
 * `EnergyPanel` reads `localStorage` for the user's category list, and
 * `SystemSetupPanel` goes through the extension's profile store. Each needs
 * its transport cut out before it can move; none of them is blocked on
 * anything in this directory.
 *
 * A flat barrel is safe here because these are DEFAULT exports with distinct
 * names -- unlike the models in `../data`, which collide on short names like
 * `row` and `bar` and so must be imported by subpath.
 */
export { default as AcCoupledPanel } from './AcCoupledPanel';
export { default as BackupPortPanel } from './BackupPortPanel';
export { default as BatteryPanel } from './BatteryPanel';
export { default as BuiltInMeterPanel } from './BuiltInMeterPanel';
export { default as DevicePanel } from './DevicePanel';
export { default as DispatchPanel } from './DispatchPanel';
export { default as EpsBackupPanel } from './EpsBackupPanel';
export { default as GeneratorPanel } from './GeneratorPanel';
export { default as GridMeterPanel } from './GridMeterPanel';
export { default as GridPortPanel } from './GridPortPanel';
export { default as LoadPanel } from './LoadPanel';
export { default as PublicGridPanel } from './PublicGridPanel';
export { default as PvEnergyPanel } from './PvEnergyPanel';
export { default as SmartLoadPanel } from './SmartLoadPanel';
export { default as StatusFaultsPanel } from './StatusFaultsPanel';
export { default as SystemPowerPanel } from './SystemPowerPanel';
