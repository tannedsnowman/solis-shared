import type { RegisterKind, WordOrder } from './primitives';

/**
 * What the decoder needs to know about one register.
 *
 * DELIBERATELY NOT `GospelRegister` AND NOT `RegisterDescription`.
 *
 * The two apps describe registers differently. The gospel (both apps carry an
 * identical copy) uses `address_start` / `kind` / `value_map` / `bit_flags`.
 * SolisConnect's legacy `RegisterDescription` uses `index` / `kind` / `valueMap`
 * / `bitFlags`. Making the decoder take either one would mean either a union
 * type it has to narrow on every access, or picking a winner and forcing the
 * loser to rewrite 20k lines of map before anything could be shared.
 *
 * So the decoder takes THIS — the minimum a decode actually reads — and each
 * app supplies a one-line adapter (see `fromGospel`). The adapter is the seam:
 * it is where "which map am I on" is decided, once, instead of at every call
 * site. That is the same lesson the extension's `decodePv.ts` already learned
 * by binding the map rather than re-implementing the rules.
 *
 * Every field is optional except `kind`, because an UNDESCRIBED register is
 * still real information — it renders its raw number rather than nothing.
 */
export interface RegisterSpec {
  /** How to read the bits. `null` for an undescribed register. */
  kind: RegisterKind;

  /**
   * Multiplier from the map. Never 0 — a zero scale silently zeroes every
   * reading through it, so it is treated as absent.
   */
  scale?: number;

  /** Units symbol ("V", "A", "W"), never a scale factor. */
  units?: string;

  /**
   * Which half of a 32-bit register comes first in ADDRESS order.
   *
   * A property of the DEVICE, not of the decoder. EPM and EPM-AX are
   * little-endian, the hybrid is big-endian; both live-verified. Defaults to
   * `'be'` ONLY because a 16-bit register never consults it.
   */
  wordOrder?: WordOrder;

  /** Raw value -> label. Consulted BEFORE scale, and it wins outright. */
  valueMap?: Record<string, string> | null;

  /** Bit index -> label, for a bitfield register. */
  bitFlags?: string[] | null;

  /**
   * The value meaning "no reading", if this register overrides the default.
   *
   * Compared against the SIGNED, UNSCALED value. Leave unset for the ordinary
   * case: an s32 register uses -0x80000000 automatically.
   */
  noReading?: number | null;
}

/** The result of decoding one register. */
export interface Decoded {
  /** The joined raw word(s), before sign and before scale. */
  raw: number;

  /** Signed and scaled number, or null when the reading is absent. */
  value: number | null;

  /** Ready to render: enum label, bit list, formatted number, or "--". */
  text: string;

  /** Enum label when `valueMap` matched, else null. */
  label: string | null;

  /** Set bit labels when the register is a bitfield, else empty. */
  bits: string[];

  /** Units symbol from the spec, never a scale factor. */
  units: string;

  /** True when the reading is missing, non-finite, or a sentinel. */
  missing: boolean;
}
