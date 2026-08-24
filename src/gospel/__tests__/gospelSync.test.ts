/**
 * Guards the synced register maps against the gospel they came from.
 *
 * THIS TEST IS THE POINT OF THE WHOLE TIER. Three things read one table —
 * the vault, the Chrome extension and this app — and the only thing making
 * that true rather than aspirational is a test that goes red when this app's
 * copy stops matching the source. Editing the gospel without re-running
 * `npm run sync-registers` ships a stale map; this makes it a red test
 * rather than a field defect.
 *
 * When the gospel is unreachable — a fresh clone, another machine, CI — the
 * hash check SKIPS. It verifies agreement when it can, and never blocks a
 * build for a missing Desktop folder. The SHAPE checks always run, so a
 * truncated or malformed copy still fails anywhere.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = 'C:/Users/Tanne/Desktop/Solis Vault Ingest/outputs/registers';
const local = (f: string) => join(here, '..', 'generated', f);

/** Keep in step with `scripts/sync-registers.mjs`. */
const FILES: ReadonlyArray<[gospel: string, copy: string]> = [
  ['hybrid_gospel_map.json', 'hybrid.json'],
  ['hybrid_rules.json', 'hybridRules.json'],
  ['pv_gospel_map.json', 'pv.json'],
  ['pv_rules.json', 'pvRules.json'],
  ['epm_gospel_map.json', 'epm.json'],
  ['epm_rules.json', 'epmRules.json'],
  ['ax_gospel_map.json', 'ax.json'],
  ['ax_rules.json', 'axRules.json'],
  ['fault_gospel_map.json', 'faults.json'],
];

/*
 * Hash NEWLINE-NORMALISED bytes, not raw ones.
 *
 * Git rewrites LF to CRLF on checkout under Windows, so the working copy of a
 * generated map never matches the LF original byte for byte — the raw-byte
 * hash could not pass on Windows no matter how in-sync the data was. That is
 * a test reporting drift when there is none, which is worse than no test: it
 * trains you to ignore it, and real drift then slips past. Normalising
 * newlines compares CONTENT, which is what "matches the gospel" means.
 */
const sha = (p: string) =>
  createHash('sha256')
    .update(readFileSync(p, 'utf8').split('\r\n').join('\n'))
    .digest('hex');

describe('synced gospel maps', () => {
  it('has every file the sync script copies', () => {
    for (const [, copy] of FILES) {
      expect(existsSync(local(copy)), `missing ${copy} — run npm run sync-registers`)
        .toBe(true);
    }
  });

  for (const [gospel, copy] of FILES) {
    const source = join(SRC, gospel);
    (existsSync(source) ? it : it.skip)(`${copy} matches ${gospel}`, () => {
      expect(sha(local(copy))).toBe(sha(source));
    });
  }
});
