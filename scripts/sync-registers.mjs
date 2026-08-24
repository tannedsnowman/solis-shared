#!/usr/bin/env node
/**
 * Copy the gospel register maps into this app.
 *
 * Usage: npm run sync-registers
 *
 * THREE CONSUMERS, ONE TABLE. The gospel maps are built once in the Solis
 * Vault Ingest project from the Modbus PDFs plus both app source trees. The
 * vault reads them in place; this app and the Chrome extension each keep a
 * synced COPY, because a packaged desktop app cannot read the author's
 * Desktop at runtime. `gospelSync.test.ts` fails if that copy drifts, so a
 * change made at the source is seen by all three or by none.
 *
 * The extension runs the identical script at
 * SolisDebuggerToolExtension/scripts/sync-registers.mjs — keep them in step.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'C:/Users/Tanne/Desktop/Solis Vault Ingest/outputs/registers';
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'src', 'gospel', 'generated');

// The map says what each register IS; the rules say how it may be SET.
// An interface built from the map alone would let a user enable two mutually
// exclusive modes at once, so both files travel together.
const FILES = [
  { from: 'hybrid_gospel_map.json', to: 'hybrid.json', build: 'build_hybrid_map' },
  { from: 'hybrid_rules.json', to: 'hybridRules.json', build: 'build_hybrid_map' },
  { from: 'pv_gospel_map.json', to: 'pv.json', build: 'build_pv_map' },
  { from: 'pv_rules.json', to: 'pvRules.json', build: 'build_pv_map' },
  { from: 'epm_gospel_map.json', to: 'epm.json', build: 'build_epm_map' },
  { from: 'epm_rules.json', to: 'epmRules.json', build: 'build_epm_map' },
  { from: 'ax_gospel_map.json', to: 'ax.json', build: 'build_epm_map' },
  { from: 'ax_rules.json', to: 'axRules.json', build: 'build_epm_map' },
  // Faults are their own family, not a register space: one entry per fault
  // BIT or CODE across hybrid and PV, carrying the installer `solution` that
  // no register map has a field for. See `src/gospel/faultGospel.ts`.
  { from: 'fault_gospel_map.json', to: 'faults.json', build: 'build_fault_map' },
];

mkdirSync(outDir, { recursive: true });
for (const { from, to, build, optional } of FILES) {
  const src = join(SRC, from);
  if (!existsSync(src)) {
    if (optional) {
      console.log(`Skipped ${from} (not built yet)`);
      continue;
    }
    console.error(`Not found: ${src}`);
    console.error(`Build it: python -m scripts.registers.${build}`);
    process.exit(1);
  }
  copyFileSync(src, join(outDir, to));
  console.log(`Synced ${from} -> ${join(outDir, to)}`);
}
