/**
 * What a settings write actually puts on the wire — decided once, here.
 *
 * This is the seam. Before it existed, four screens each re-derived the same
 * chain inline: is the register read-only, is it 32-bit, is it
 * read_modify_write, do I have the mask, do I have the current word, which
 * function code, which word order. A fifth copy was found inline in
 * `PvPowerSetting.tsx` during phase 3, which is what a decision tree does when
 * it lives in the widgets — it multiplies quietly.
 *
 * `planWrite` answers all of it and returns either a frame to send or a
 * refusal to show. It performs no I/O: when the plan needs the device's
 * current word and the caller did not supply one, it returns
 * `needsRead`, and the caller reads and asks again. That keeps this
 * module pure and testable while leaving transport in the app, where the
 * scrape/API/serial fork belongs.
 *
 * THE RULE THIS EXISTS TO ENFORCE: a `read_modify_write` register must never
 * be written without knowing which bits the editor owns. Writing a bare value
 * to 43110 clears battery wake-up and grid charging along with it, and nothing
 * in the Modbus reply says so. A missing mask REFUSES; it does not guess.
 */
import { mergeForWrite } from './bitRules';
import type { WordOrder } from '../decode/primitives';

/**
 * The write-relevant half of a rules-file record.
 *
 * Deliberately NOT `RegisterRule`. The three rules files genuinely disagree on
 * fields this module never reads — EPM's `related_registers` is strings where
 * hybrid's is numbers, PV's `bit_groups[].bits` is nullable — so demanding the
 * full type here would force a merge that has nothing to do with writing.
 * This is the narrowest contract every rules file already satisfies.
 */
export interface WriteRule {
  write?: string;
  write_with?: number[];
}

/** What the map says about the register's shape on the wire. */
export interface WriteRegister {
  kind?: string | null;
  word_order?: WordOrder;
}

export interface WriteRequest {
  /** ABSOLUTE address, e.g. 43110. Never add a 43000 base. */
  address: number;
  /** The value the register should end up holding. */
  value: number;
  /** The register's map record, or null when the map does not cover it. */
  register: WriteRegister | null;
  /** The register's rule, or undefined when it has none. */
  rule?: WriteRule;
  /**
   * Which bits this editor owns. Bits outside the mask keep whatever the
   * device currently has. REQUIRED for `read_modify_write` — a missing mask
   * refuses rather than clobbering.
   */
  ownedMask?: number;
  /** The device's current word, when the caller already has it. */
  currentValue?: number;
  /**
   * Force 32-bit. Only ever forces UP: the failure this guards is a wide
   * register the map still calls narrow, never the reverse.
   */
  width?: 16 | 32;
}

export type RefusalCode =
  | 'read-only'
  | 'needs-mask'
  | 'needs-read'
  | 'wide-rmw-unsupported';

export interface WritePlanRefused {
  kind: 'refuse';
  code: RefusalCode;
  /** Shown to the installer. Says which register and why. */
  reason: string;
}

export interface WritePlanFrame {
  kind: 'write';
  address: number;
  /** 6 for one word, 16 for two. */
  fn: 6 | 16;
  /** Words in ADDRESS order, word order already applied. */
  words: number[];
  /**
   * The full 16-bit value this write lands, after any merge. Lets a caller
   * show "43110: 0x0021 -> 0x0025" without redoing the arithmetic.
   */
  merged: number;
}

export type WritePlan = WritePlanFrame | WritePlanRefused;

const refuse = (code: RefusalCode, reason: string): WritePlanRefused => ({
  kind: 'refuse',
  code,
  reason,
});

/** How many words the register occupies. The map is the authority. */
export function widthOf(
  register: WriteRegister | null,
  override?: 16 | 32,
): 16 | 32 {
  if (override === 32) return 32;
  const kind = register?.kind;
  return kind === 'u32' || kind === 's32' ? 32 : 16;
}

export function planWrite(req: WriteRequest): WritePlan {
  const { address, rule, register } = req;

  if (rule?.write === 'read_only') {
    return refuse('read-only', `Register ${address} is read-only`);
  }

  const width = widthOf(register, req.width);

  if (width === 32) {
    if (rule?.write === 'read_modify_write') {
      // No 32-bit register is a bitfield, so there is no correct wide merge to
      // perform. Refuse rather than send half of one.
      return refuse(
        'wide-rmw-unsupported',
        `Register ${address} is 32-bit and read-modify-write; that combination is not supported`,
      );
    }

    const raw = Math.trunc(req.value) >>> 0;
    const hi = (raw >>> 16) & 0xffff;
    const lo = raw & 0xffff;
    // Read the word order rather than assuming 'be'. A later revision flipping
    // one would otherwise write a value wrong by a factor of 65536 — and the
    // inverter would ACK it.
    const words = register?.word_order === 'le' ? [lo, hi] : [hi, lo];

    return { kind: 'write', address, fn: 16, words, merged: raw };
  }

  if (rule?.write === 'read_modify_write') {
    if (req.ownedMask === undefined) {
      return refuse(
        'needs-mask',
        `Register ${address} is read-modify-write and no owned mask was given; refusing rather than clearing bits this editor does not own`,
      );
    }
    if (req.currentValue === undefined) {
      // NOT an error — the caller simply has not read yet. It reads, then asks
      // again with `currentValue` set. A guessed zero here would wipe every
      // bit outside the mask.
      return refuse(
        'needs-read',
        `Register ${address} must be read before it can be merged`,
      );
    }

    const merged = mergeForWrite(
      req.currentValue,
      req.value & 0xffff,
      req.ownedMask,
    );
    return { kind: 'write', address, fn: 6, words: [merged], merged };
  }

  const value = req.value & 0xffff;
  return { kind: 'write', address, fn: 6, words: [value], merged: value };
}
