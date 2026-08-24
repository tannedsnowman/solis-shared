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

export interface WriteRequest {
  /** ABSOLUTE address, e.g. 43110. Never add a 43000 base. */
  address: number;
  /** The value the register should end up holding. */
  value: number;
  /**
   * The register's write mode, from its rules file — or `'none'` when it has
   * no rule.
   *
   * A STRING, and required. The three rules files disagree on fields this
   * module never reads (EPM's `related_registers` is strings where hybrid's is
   * numbers), so taking the whole record would force a merge that has nothing
   * to do with writing. Required rather than optional because an omitted write
   * mode reads exactly like `'plain'`, and `read_modify_write` silently
   * degrading to `plain` is the failure this module exists to prevent.
   */
  rule: string | { write?: string };
  /** 16 or 32. The caller resolves this from the map via `widthForKind`. */
  width: 16 | 32;
  /** Which half of a wide register goes first. Only read when width is 32. */
  wordOrder: WordOrder;
  /**
   * Which bits this editor owns. Bits outside the mask keep whatever the
   * device currently has. REQUIRED for `read_modify_write` — a missing mask
   * refuses rather than clobbering.
   */
  ownedMask?: number;
  /** The device's current word, when the caller already has it. */
  currentValue?: number;
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
   * The full value this write lands, after any merge. Lets a caller show
   * "43110: 0x0021 -> 0x0025" without redoing the arithmetic.
   */
  merged: number;
}

export type WritePlan = WritePlanFrame | WritePlanRefused;

const refuse = (code: RefusalCode, reason: string): WritePlanRefused => ({
  kind: 'refuse',
  code,
  reason,
});

/**
 * Width from the map's `kind`. An override only ever forces UP: the failure
 * this guards is a wide register the map still calls narrow, never the reverse.
 */
export function widthForKind(
  kind: string | null | undefined,
  override?: 16 | 32,
): 16 | 32 {
  if (override === 32) return 32;
  return kind === 'u32' || kind === 's32' ? 32 : 16;
}

/**
 * True when the plan refused ONLY because it has not been given the device's
 * current word.
 *
 * This is the one refusal a caller can answer by itself: read the register and
 * call `planWrite` again with `currentValue` set. Every other refusal is final.
 * Note a FAILED read must leave the second plan refusing too — that is what
 * stops a failed read from becoming a guessed zero.
 */
export function wantsCurrentValue(plan: WritePlan): boolean {
  return plan.kind === 'refuse' && plan.code === 'needs-read';
}

export function planWrite(req: WriteRequest): WritePlan {
  const { address, width } = req;
  /*
   * Accept either the write mode itself or the whole rules record. Every hook
   * had `ruleFor(address) ?? 'none'` at the call site — the record, not its
   * `write` field — so demanding a bare string here would mean the same
   * one-line unwrap repeated at four call sites, each free to get it wrong.
   * A record with NO `write` field means the same as no rule: plain.
   */
  const rule =
    typeof req.rule === 'string' ? req.rule : (req.rule?.write ?? 'none');

  if (rule === 'read_only') {
    return refuse('read-only', `Register ${address} is read-only`);
  }

  if (width === 32) {
    if (rule === 'read_modify_write') {
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
    // Read the word order rather than assuming 'be'. A revision flipping one
    // would otherwise write a value wrong by a factor of 65536 — and the
    // inverter would ACK it.
    const words = req.wordOrder === 'le' ? [lo, hi] : [hi, lo];

    return { kind: 'write', address, fn: 16, words, merged: raw };
  }

  if (rule === 'read_modify_write') {
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

/* ------------------------------------------------------------------ *
 * Parsing a text box into a word.
 *
 * These sit beside `planWrite` rather than inside it because they answer a
 * different question: `planWrite` decides what a write MEANS, these decide
 * whether what the installer typed is a number at all. A row calls the parser
 * first and only reaches `planWrite` with a value in hand.
 * ------------------------------------------------------------------ */

/**
 * A settings text box into a 16-bit word, or `null` when it is not one.
 *
 * `null` means "do not send" — a blank box, a typo, or a value that cannot fit
 * a register. It is never coerced to 0, because 0 is a legitimate setting on
 * most of these registers and would be written without complaint.
 */
export function planSettingWrite(editValue: string): number | null {
  const val = parseInt(editValue, 10);
  if (isNaN(val) || val < 0 || val > 65535) return null;
  return val;
}

/**
 * The full word for a write that replaces ONE BYTE and preserves the other.
 *
 * An unread register counts as zero here, deliberately: the EPM-AX meter
 * settings are routinely set before anything has been read, and refusing would
 * block a screen that works. This is the one place in the settings model where
 * a missing read is not a refusal — it is safe only because these registers
 * pack two independent bytes rather than a bitfield, so the worst case is
 * writing a zero into the other byte that the installer is about to set
 * anyway. Do NOT copy this leniency to `planWrite`, where the same assumption
 * would silently clear protection bits.
 */
export function planByteWrite(
  byte: 'low' | 'high',
  editValue: string,
  currentValue: number | undefined,
): number | null {
  const newByte = parseInt(editValue, 10);
  if (isNaN(newByte)) return null;

  const current = currentValue ?? 0;
  const currentLow = current & 0xff;
  const currentHigh = (current >> 8) & 0xff;

  return byte === 'low'
    ? (currentHigh << 8) | (newByte & 0xff)
    : ((newByte & 0xff) << 8) | currentLow;
}
