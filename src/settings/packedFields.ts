/**
 * Registers that pack two or more independent fields into one 16-bit word.
 *
 * The gospel map does not describe packed byte fields yet — it has one record
 * per address, not per sub-field. This table is the only place that knowledge
 * lives, shaped so it can be lifted into the map (or `hybrid_rules.json`)
 * verbatim once a `packed_fields` key exists there.
 *
 * Keys are ABSOLUTE addresses, matching `byAddress`.
 */

export interface PackedField {
  /** Human label for the sub-field. */
  name: string
  /** Bits this field occupies in the word, e.g. 0xff00 for the high byte. */
  mask: number
  /** Right-shift applied after masking, so the value is a small integer. */
  shift: number
  /** Decimal-string keyed, exactly like the gospel's `value_map`. */
  options: Record<string, string>
}

export const PACKED_FIELDS: Record<number, PackedField[]> = {
  // 43140 "Meter Type and Its Installation Location".
  //
  // Derived from the existing Meter.tsx, which read `value & 0xff00` for the
  // location and `value & 0x00ff` for the type, and wrote back the sum. Its
  // placement options were pre-shifted constants (0x100/0x200/0x300); here
  // they are stored unshifted (1/2/3) with `shift: 8` doing the work, so the
  // two fields have the same shape.
  43140: [
    {
      name: 'Meter Location',
      mask: 0xff00,
      shift: 8,
      options: {
        '1': 'Grid',
        '2': 'Load',
        '3': 'Grid+PV (Two Meter)',
      },
    },
    {
      name: 'Meter Type',
      mask: 0x00ff,
      shift: 0,
      options: {
        '1': 'General 1Ph',
        '2': 'Acrel 3Ph',
        '3': 'General 3Ph',
        '4': 'Standard Eastron 1Ph',
        '5': 'Standard Eastron 3Ph',
        '6': 'No Meter Mode',
      },
    },
  ],
}

/** Pull one sub-field's value out of a packed word. */
export function unpackField(word: number, f: PackedField): number {
  return (word & f.mask) >>> f.shift
}

/** Read every sub-field of a packed register, in table order. */
export function unpackAll(word: number, fields: PackedField[]): number[] {
  return fields.map((f) => unpackField(word, f))
}

/**
 * Put one sub-field back into a word, leaving every other bit untouched.
 * This is read-modify-write at byte granularity and is why a packed editor
 * can never clobber its neighbour.
 */
export function packField(word: number, f: PackedField, value: number): number {
  return ((word & ~f.mask) | ((value << f.shift) & f.mask)) & 0xffff
}

/** Apply a full set of sub-field values to a word. */
export function packAll(
  word: number,
  fields: PackedField[],
  values: number[],
): number {
  // A short `values` leaves the remaining fields ALONE. Passing the missing
  // entry through would compute `undefined << shift` === 0 and silently clear
  // a field the caller never meant to touch.
  return fields.reduce(
    (w, f, i) => (values[i] === undefined ? w : packField(w, f, values[i]!)),
    word,
  )
}

export function packedFieldsFor(address: number): PackedField[] | null {
  return PACKED_FIELDS[address] ?? null
}
