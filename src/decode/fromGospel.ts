/**
 * Adapters from a map record to a `RegisterSpec`.
 *
 * This is the seam. `decode.ts` knows nothing about the gospel or about
 * SolisConnect's legacy descriptions; these functions are where "which map am
 * I on" is answered, once per app, instead of at every call site.
 *
 * The shapes are declared structurally rather than imported, so this package
 * does not depend on either app's type files and neither app has to move its
 * types to adopt the decoder.
 */
import type { RegisterKind, WordOrder } from './primitives';
import type { RegisterSpec } from './types';

/** The gospel's record shape, as both apps carry it in `generated/*.json`. */
export interface GospelLike {
  kind: RegisterKind;
  scale?: number;
  units?: string;
  word_order?: WordOrder;
  value_map?: Record<string, string> | null;
  bit_flags?: string[] | null;
}

/** SolisConnect's legacy hand-map record shape. */
export interface DescriptionLike {
  kind?: RegisterKind;
  scale?: number;
  units?: string;
  wordOrder?: WordOrder;
  valueMap?: Record<string, string> | null;
  bitFlags?: string[] | null;
  invalidValue?: number | null;
}

/**
 * Build a spec from a gospel record.
 *
 * `null` is accepted and yields an undescribed spec, because an address the
 * map does not cover still renders its raw number. Callers therefore never
 * have to guard the lookup.
 */
export function fromGospel(reg: GospelLike | null | undefined): RegisterSpec {
  if (!reg) return { kind: null };
  return {
    kind: reg.kind,
    scale: reg.scale,
    units: reg.units,
    wordOrder: reg.word_order,
    valueMap: reg.value_map ?? null,
    bitFlags: reg.bit_flags ?? null,
  };
}

/** Build a spec from a legacy SolisConnect description record. */
export function fromDescription(
  desc: DescriptionLike | null | undefined,
): RegisterSpec {
  if (!desc) return { kind: null };
  return {
    kind: desc.kind ?? null,
    scale: desc.scale,
    units: desc.units,
    wordOrder: desc.wordOrder,
    valueMap: desc.valueMap ?? null,
    bitFlags: desc.bitFlags ?? null,
    noReading: desc.invalidValue ?? null,
  };
}
