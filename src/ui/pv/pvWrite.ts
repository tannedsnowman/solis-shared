/**
 * The contract a PV settings card uses to WRITE a register.
 *
 * THIS IS THE SEAM BETWEEN THE PV CARDS AND EACH APP'S TRANSPORT.
 *
 * A card knows which register it wants set and to what -- that much is the
 * model's business and is shared. HOW the word reaches the inverter is not:
 * the extension posts a Modbus frame through `sendModbusCommand` and marks
 * the store entry stale with `hideValue`; SolisConnect goes over the Tauri
 * serial bridge. Neither belongs in a card.
 *
 * So the cards take a `PvWriter` and never build one. The extension keeps
 * `usePvRegisterWrite` and hands in its result; SolisConnect hands in its
 * own. Same card, two transports.
 *
 * ADDRESSES ARE PRINTED ADDRESSES, e.g. 3312, never the wire address (3311).
 * The PV settings space is offset by one and the writer applies it exactly
 * once. A card that subtracts one before calling is writing the register
 * BELOW the one it names, and the inverter ACKs it -- which is the failure
 * this rule exists to prevent, because it looks like success.
 */

/** What a write answered. An error is a message worth showing, not a code. */
export interface PvWriteOutcome {
  ok: boolean;
  error?: string;
}

export interface PvWriteRequest {
  /** PRINTED address, settings space, e.g. 3312. Never the wire address. */
  address: number;
  /** The value we want the register to hold. */
  value: number;
  /**
   * For a masked write: which bits this editor owns. Bits outside the mask
   * keep whatever the inverter currently has.
   *
   * Pass it whenever the register is shared, whatever the rules file says.
   * A mask of 0 writes the device's word back unchanged, which is the right
   * behaviour for a card that has lost track of which bit it owns -- it is
   * a refusal expressed as a no-op rather than as an error the user cannot
   * act on.
   */
  ownedMask?: number;
  /** Variable key to mark stale after a write, so the UI re-reads it. */
  variableKey?: string;
  /** Page id, used by the app to find the right store. */
  id?: string;
}

/**
 * A writer, as a card receives it.
 *
 * Shaped as the return of the extension's `usePvRegisterWrite` so that hook
 * satisfies it as-is, with no adapter at the call site. `busy` is optional
 * because not every card draws a pending state, and `lastError` because not
 * every app surfaces the last failure separately from the outcome.
 */
export interface PvWriter {
  /** Set one register. Resolves with the outcome; never throws for a refusal. */
  write: (req: PvWriteRequest) => Promise<PvWriteOutcome>;
  /** True while a write is in flight, when the app tracks it. */
  busy?: boolean;
  /** The most recent failure message, when the app tracks one. */
  lastError?: string | null;
}
