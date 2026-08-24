#!/usr/bin/env node
/**
 * Copy the generated gospel maps into `dist/`.
 *
 * `tsc` compiles TypeScript and ignores everything else, so without this step
 * `dist/gospel/gospel.js` would import a `generated/hybrid.json` that is not
 * there. Runs after `build` and before `watch`.
 *
 * `tsc --watch` never re-fires on a JSON change, so re-syncing the maps from
 * the vault needs a full `npm run build` rather than a running watcher. The
 * README says so; keep it saying so.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', 'src', 'gospel', 'generated');
const to = join(here, '..', 'dist', 'gospel', 'generated');

mkdirSync(to, { recursive: true });

const maps = readdirSync(from).filter((f) => f.endsWith('.json'));
for (const map of maps) copyFileSync(join(from, map), join(to, map));

console.log(`copy-json: ${maps.length} maps -> dist/gospel/generated`);
