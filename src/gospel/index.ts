/**
 * The gospel tier: the register maps and the loaders that read them.
 *
 * NAMESPACED, NOT FLATTENED. Every family exports a `byKey`, a `byAddress`,
 * a `ruleFor` and a `registerCount`, each meaning something different — PV's
 * `byKey` and EPM's `byKey` answer about different devices with overlapping
 * address spaces. A flat barrel would either collide or, worse, silently
 * resolve to whichever family happened to be re-exported last.
 *
 * So callers say which family they mean:
 *
 *   import { pvGospel, epmGospel } from '@solis/shared/gospel';
 *   pvGospel.byKey('mppt7Current');
 *
 * The hybrid map is the default one and is also re-exported flat, because it
 * predates the others and ~200 call sites already name `byAddress` bare.
 *
 * The generated `*.json` maps are copied here from the vault by
 * `scripts/sync-registers.mjs`. Nothing here is hand-edited — fix the vault,
 * re-sync, rebuild. Note `tsc` does NOT copy `.json` into `dist/`, so
 * `scripts/copy-json.mjs` runs as part of both `build` and `watch`; a map
 * change therefore needs a full `npm run build`.
 */
import * as gospel from './gospel';
import * as pvGospel from './pvGospel';
import * as epmGospel from './epmGospel';
import * as faultGospel from './faultGospel';
import * as pvRules from './pvRules';
import * as epmRules from './epmRules';
import * as faultSolutions from './faultSolutions';

export { gospel, pvGospel, epmGospel, faultGospel, pvRules, epmRules, faultSolutions };

/*
 * Family aliases, which is how the address-conformance tests name them:
 *
 *   import { hybrid, pv, epm } from '@solis/shared/gospel';
 *   hybrid.byKey('builtInMeterACVoltageB');
 *
 * `hybrid` rather than `gospel` because "the gospel" is the whole tier, not
 * the hybrid map — the name only read as unambiguous back when hybrid was the
 * only family here. EPM and EPM-AX share one loader and are told apart by
 * device, not by module.
 */
export { gospel as hybrid, pvGospel as pv, epmGospel as epm };

/* The hybrid map, flat — the original, and what a bare `byAddress` means. */
export * from './gospel';

/* Decode helpers that read a gospel record. No family owns these. */
export { enumLabel, displayValue } from './decodeGospel';
