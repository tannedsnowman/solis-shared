/**
 * The contract a HYBRID settings card uses to WRITE a register.
 *
 * THIS IS THE SEAM BETWEEN THE HYBRID CARDS AND EACH APP'S TRANSPORT, and it
 * is the sibling of `PvWriter` in `../pv/pvWrite`.
 *
 * WHY A SECOND CONTRACT RATHER THAN ONE SHARED WRITER
 * ---------------------------------------------------
 * The four write hooks look alike and differ where it counts, which is why
 * they are deliberately NOT merged: hybrid handles 16- and 32-bit registers
 * and takes word order from the map, EPM gates on `isWritable`/`writeModeFor`,
 * PV applies the only non-zero wire offset in the codebase, and AX has no
 * rules layer at all. The common part -- `planWrite`, every refusal, the
 * read-modify-write merge -- is already shared in `@solis/shared/settings`.
 *
 * Two differences from `PvWriteRequest` are real and are why this is its own
 * type rather than an alias:
 *
 *   - `currentValue`, so a card that has already read the register can save
 *     the hook a round trip on a read-modify-write.
 *   - `width`, the escape hatch for a register the map still calls narrow.
 *
 * ADDRESSES ARE PRINTED ADDRESSES, e.g. 43110, and the hybrid settings space
 * has NO wire offset -- unlike PV, where the writer subtracts one. Never add
 * a 43000 base.
 */

/** What a write answered. An error is a message worth showing, not a code. */
export interface HybridWriteOutcome {
  ok: boolean;
  error?: string;
}

export interface HybridWriteRequest {
  /** PRINTED address, settings space, e.g. 43110. */
  address: number;
  /** The value we want the register to hold. */
  value: number;
  /**
   * For `read_modify_write`: which bits this editor owns. Bits outside the
   * mask keep whatever the inverter currently has.
   *
   * Required whenever the register's rule says `read_modify_write`; a missing
   * mask makes the write REFUSE rather than clobber the bits it does not own.
   */
  ownedMask?: number;
  /**
   * The last value read from the device, when the caller already has it.
   * Saves a round trip; when absent the app's hook reads the register itself.
   */
  currentValue?: number;
  /** Variable key to mark stale after a write, so the UI re-reads it. */
  variableKey?: string;
  /** Page id, used by the app to find the right store. */
  id?: string;
  /**
   * Override the register width in words. Normally omitted -- the width comes
   * from the gospel's `kind`. Only ever forces 32, because the failure it
   * guards is a wide register the map still calls narrow, never the reverse.
   */
  width?: 16 | 32;
}

/**
 * A writer, as a hybrid card receives it.
 *
 * Shaped as the return of the extension's `useRegisterWrite` so that hook
 * satisfies it as-is, with no adapter at the call site. `busy` and
 * `lastError` are optional because not every app tracks them separately from
 * the outcome; the eight hybrid settings screens between them use exactly
 * these three members and nothing else.
 */
export interface HybridWriter {
  /** Set one register. Resolves with the outcome; never throws for a refusal. */
  write: (req: HybridWriteRequest) => Promise<HybridWriteOutcome>;
  /** True while a write is in flight, when the app tracks it. */
  busy?: boolean;
  /** The most recent failure message, when the app tracks one. */
  lastError?: string | null;
}
