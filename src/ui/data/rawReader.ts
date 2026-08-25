/**
 * The contract a card uses to read register words.
 *
 * THIS IS THE SEAM BETWEEN THE CARDS AND EACH APP'S BACK END.
 *
 * A card needs to ask "what word is at address 3042, and how old is it".
 * WHERE that word comes from is the app's business and the two apps do not
 * agree: the extension reads a localStorage store that `sendModbusCommand`
 * fills, keyed by legacy mapper key; SolisConnect reads its own stores over
 * the Tauri serial bridge. Neither belongs in a card.
 *
 * So the cards take a `RawReader` and never build one. Each app keeps its own
 * reader -- `useRawRegisters`, `usePvRawRegisters` and friends stay in the
 * app -- and hands it in. That is what lets one PV panel render in both.
 *
 * ADDRESSES ARE PRINTED ADDRESSES, e.g. 3042, never the wire address (3041)
 * and never a mapper index (42). The reader is responsible for that mapping,
 * because which offset applies is a property of the app's transport.
 */

/** One reading as a store holds it: the raw word, and when it arrived. */
export interface RawEntry {
  value: number | string;
  lastUpdated?: string;
}

/** A whole store snapshot, keyed however the owning app keys it. */
export type RawStore = Record<string, RawEntry>;

/** A reader closed over one snapshot of the store. */
export interface RawReader {
  /** Raw word at an absolute address, or null when it was never read. */
  at: (address: number) => number | null;
  /** Non-numeric reading (the serial number is ASCII) at an address. */
  textAt: (address: number) => string | null;
  /** When the address was last refreshed, as the store recorded it. */
  ageAt: (address: number) => string | null;
  /** True when nothing at all has been read yet. */
  empty: boolean;
  /**
   * Every address this reader was asked for.
   *
   * Building a tab calls `at`/`textAt` for exactly the registers that tab
   * draws, so recording the asks IS the tab's register list — no hand-kept
   * second list to fall out of step with the panel. Read it after the tab is
   * built.
   */
  touched: () => number[];
}
