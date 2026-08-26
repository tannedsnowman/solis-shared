/**
 * The HYBRID SETTINGS screens.
 *
 * Eight cards, each props-in and JSX-out: give one the settings store it
 * should read (`variables`) and a `HybridWriter` to write through, and it
 * draws its rows. Not one of them knows which app it is in.
 *
 * `writer` is REQUIRED here, where the extension's own wrappers make it
 * optional. A shared card has no app default to fall back to; that is the
 * difference between a card and a page.
 *
 * WHY THE READER IS NOT A PROP HERE, unlike on the data panels. A settings
 * screen reads `variables`, which is already the shared `SettingStore` shape
 * that `rawOf` in `../settings/reading` understands -- so the reader seam was
 * cut before these screens existed and needs nothing further. Only the WRITE
 * path was app-bound.
 *
 * A flat barrel is safe: these are DEFAULT exports with distinct names. The
 * MODELS beside them are not re-exported here, because several export the
 * same short names (`ROWS`, `ADDRESSES`, `ownedMaskOf`) for their own screen.
 * Import a model by its own subpath:
 *
 *     import { modeOptions } from '@solis/shared/ui/hybridSettings/storageModeModel'
 */
export { default as BatterySetup } from './BatterySetup';
export { default as ControlPanelV2 } from './ControlPanelV2';
export { default as DeviceSetting } from './DeviceSetting';
export { default as ParallelV2 } from './ParallelV2';
export { default as ProtectSetting } from './ProtectSetting';
export { default as RemoteControl } from './RemoteControl';
export { default as SmartPort } from './SmartPort';
export { default as StorageMode } from './StorageMode';
