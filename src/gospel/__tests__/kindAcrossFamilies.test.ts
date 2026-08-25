/**
 * `kind` means the same thing in all four families.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The hybrid and PV maps have always carried `kind` -- one field saying both
 * WIDTH and SIGNEDNESS. EPM and AX carried `width` plus `data_type`, which say
 * the same thing between them but cannot express a CORRECTION: nine hybrid
 * registers deliberately disagree with their document's `data_type` because
 * the document is wrong, and EPM/AX had nowhere to put that.
 *
 * So the two pairs of readers asked different questions of their maps, and
 * that was the reason the decoders could not be shared. `kind` is now on all
 * four. These tests pin the two facts that make it safe to rely on.
 */
import { describe, expect, it } from 'vitest';
import epmJson from '../generated/epm.json';
import axJson from '../generated/ax.json';
import hybridJson from '../generated/hybrid.json';
import pvJson from '../generated/pv.json';

type Row = {
  address?: number;
  address_start?: number;
  data_type?: string | null;
  width?: number;
  kind?: string | null;
  name?: string | null;
};

const rowsOf = (j: unknown): Row[] =>
  (j as { register_spaces: { registers: Row[] }[] }).register_spaces.flatMap(
    (s) => s.registers,
  );

const FAMILIES = {
  hybrid: rowsOf(hybridJson),
  pv: rowsOf(pvJson),
  epm: rowsOf(epmJson),
  ax: rowsOf(axJson),
};

const WIDE = new Set(['u32', 's32']);
const SIGNED = new Set(['s16', 's32']);

describe('every family carries kind', () => {
  for (const [family, rows] of Object.entries(FAMILIES)) {
    it(`${family} has a kind field on its registers`, () => {
      expect(rows.length).toBeGreaterThan(0);
      // `kind` may be null -- a Reserve row has no declared type -- but the
      // PROPERTY must be present, or a reader cannot tell "no type" from
      // "this family does not use the field".
      const missing = rows.filter((r) => !('kind' in r));
      expect(missing).toHaveLength(0);
    });
  }
});

describe('kind agrees with the width the document printed', () => {
  /*
   * Only EPM and AX carry `width`; hybrid and PV express width through `kind`
   * alone. Where both exist they must not disagree -- a register decoded 32
   * bits wide by one field and 16 by the other would read a neighbour's word.
   */
  for (const family of ['epm', 'ax'] as const) {
    it(`${family}: no register is wide by one field and narrow by the other`, () => {
      const clashes = FAMILIES[family]
        .filter((r) => r.kind && r.width !== undefined)
        .filter((r) => WIDE.has(r.kind as string) !== (r.width === 32))
        .map((r) => `${r.address} kind=${r.kind} width=${r.width}`);
      expect(clashes).toEqual([]);
    });
  }
});

describe('adding kind changed no register’s signedness', () => {
  /*
   * `kind` was derived from `data_type`, so it must agree with what the old
   * `data_type.startsWith('S')` test answered. A disagreement here is a
   * register that silently changed sign when the field landed -- 0xFFE2
   * reading as 65506 instead of -30.
   */
  for (const family of ['epm', 'ax'] as const) {
    it(`${family}: kind and data_type agree about sign`, () => {
      const flipped = FAMILIES[family]
        .filter((r) => r.kind)
        .filter(
          (r) =>
            (r.data_type ?? '').startsWith('S') !==
            SIGNED.has(r.kind as string),
        )
        .map((r) => `${r.address} dt=${r.data_type} kind=${r.kind}`);
      expect(flipped).toEqual([]);
    });
  }
});
