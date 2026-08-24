/**
 * The settings tier: what an editor looks like, which bits it owns, and what
 * saving it writes.
 *
 * Pure. No React, no stores, no transport — those stay in the apps, which
 * render different widgets against the same model (a ~600px popup on one side,
 * a desktop window on the other).
 */
export * from './bitRules';
export * from './packedFields';
export * from './editorFor';
export * from './rowModel';
export * from './composites';
export * from './planWrite';
