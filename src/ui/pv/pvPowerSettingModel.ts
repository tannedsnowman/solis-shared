/**
 * The register maths behind the Inverter Power Settings screen, with no React
 * in it.
 *
 * THE TRAP THIS FILE EXISTS FOR: RAM VERSUS FLASH
 * -----------------------------------------------
 * A power limit written to this inverter normally lands in RAM. It takes
 * effect immediately, it reads back exactly as you wrote it, and it is GONE
 * the next time the machine loses power. Nothing in the Modbus reply says so.
 * Register 3069 is the only thing that changes that: each of its bits marks
 * ONE power-control register as "save this to flash on power off". Set the bit
 * first, then write the value, and the value survives a power cycle.
 *
 * That is not a bug to be papered over. Writing to RAM is often exactly what
 * an engineer wants — a 20% test limit that clears itself the moment the site
 * is power-cycled is safer than one that has to be remembered and undone. So
 * this screen does NOT set the save bits for you. It makes the choice visible
 * and lets you make it deliberately.
 *
 * TWO REASONS A WRITE DOES NOTHING — AND THEY ARE NOT THE SAME REASON
 * -------------------------------------------------------------------
 * Conflating these is the mistake every other rendering of this page makes.
 *
 *   1. THE UNLOCK SWITCH IS OFF. 3070 and 3071 gate the power registers with
 *      magic codes, not booleans. Until 3070 is 0xAA, printed 3052 and 3081 do
 *      nothing at all — the write is ACKed and ignored. 3071 is worse: it has
 *      TWO on-codes that enable DIFFERENT registers (0xA1 enables 3051/3083,
 *      0xA2 enables 3053), so "on" is not even a single state.
 *   2. THE SAVE BIT IS CLEAR. The write DID take effect — the machine is
 *      limiting right now — but the value lives in RAM and dies at power-off.
 *
 * Failure 1 means "nothing is happening". Failure 2 means "something is
 * happening, but not tomorrow". A screen that shows one generic "not enabled"
 * badge for both sends an engineer to check the wrong thing. `isUnlocked()`
 * answers 1 and `persistenceOf()` answers 2, separately, per register.
 *
 * FOUR BITS, CONTIGUOUS — AND WHY THE MAP'S OWN TEXT DISAGREES
 * -------------------------------------------------------------
 * 3069 carries FOUR save bits, one per protected register:
 *
 *   BIT00 -> 3052  active power %
 *   BIT01 -> 3053  PF Setting
 *   BIT02 -> 3051  reactive power limitation (+ working mode 3073)
 *   BIT03 -> 3054  PF Setting 02          (+ working mode 3073)
 *
 * The register's raw description in the map says something different — three
 * bits with BIT01 reserved — and it is wrong. It comes from Ver.3.7 alone,
 * which the map merge ranked newest, and it names register 3050, WHICH DOES
 * NOT EXIST anywhere in the settings space. Nine other documents (V16-V19 and
 * the three Grid-Tied) agree on the four-bit layout above. The rules file now
 * carries that reading and this screen follows the rules file.
 *
 * PRINTED VERSUS WIRE ADDRESSES
 * -----------------------------
 * PV documents print an address one higher than the number that goes in the
 * Modbus frame (see `pvGospel.ts`), so the same four-digit number means two
 * different registers depending on who wrote it. The map's description quotes
 * WIRE addresses; the corrected rules quote PRINTED ones and say so in
 * `independent_explain`.
 *
 * That convention is read from the source's own declaration rather than
 * guessed per string — see `conventionOf`. An earlier version of this file
 * sniffed each label for the word "printed", and when the corrected labels
 * arrived without it every bit silently shifted up by one. Nothing here is
 * applied by blind arithmetic, and a resolved target is additionally checked
 * against the rule's `related_registers`.
 *
 * NOTHING IS HARD-CODED. Not a bit number, not a scale, not a unit, not a
 * magic value. Bits are resolved BY LABEL out of the rules file, in the spirit
 * of `bitNamed()` on the hybrid Protect Setting screen, because the map's own
 * `value_map` for 3069 used to read like an enum ("Both Save") over what is
 * really a bitfield. Writing the word as a plain value would clobber the other
 * bits, so every 3069 change here is read-modify-write over a mask of the bits
 * the screen owns.
 */
import { clearBit, isSet, setBit } from '../../settings/index'
import { settingsByAddress, wireAddress } from '../../gospel/pvGospel'
import type { PvRule } from '../../gospel/pvRules'
import { ruleFor } from '../../gospel/pvRules'

/* ------------------------------------------------------------------ *
 * The registers this screen owns. Printed addresses throughout — the
 * wire offset is applied once, in `wireOf`, and nowhere else.
 * ------------------------------------------------------------------ */

/** Per-register save-to-flash bitfield. The subject of this whole screen. */
export const POWER_OFF_SAVING = 3069

/** Active power switch. 0x55 off, 0xAA on. Gates 3052 and 3081. */
export const ACTIVE_POWER_SWITCH = 3070

/** Reactive power switch. 0x55 off, 0xA1 gates 3051/3083, 0xA2 gates 3053. */
export const REACTIVE_POWER_SWITCH = 3071

/** Active power limit, % of rated. Gated by 3070. */
export const POWER_LIMIT = 3052

/** Active power set-point in watts. Gated by 3070. */
export const LIMIT_POWER_VALUE = 3081

/** Reactive power limitation, %. Gated by 3071's first on-code. */
export const REACTIVE_POWER_LIMIT = 3051

/** Reactive power set-point in var. Gated by 3071's first on-code. */
export const LIMITED_REACTIVE_VALUE = 3083

/**
 * PF Setting. The register SolisCloud's page calls "Power Factor Setting".
 *
 * NOT the register 3069 BIT03 protects — see `PF_SETTING_ACTUAL` below.
 */
export const PF_SETTING = 3053

/**
 * PF Setting 02 — the register the 0xA2 unlock actually enables.
 *
 * TWO REGISTERS CARRY A POWER FACTOR and they are reached completely
 * differently. 3053 is selected by WORKING MODE 03 in 3073. This one is
 * selected by the 0xA2 code on 3071, and V19 says so twice: 3071's own text is
 * "0xA2 PF 02 setting effective (for 3054 Reg)" and 3054's is "To enable 3054,
 * need to enable 3071 A2". Both PRINTED addresses.
 *
 * Two things about it are worth knowing before you write it. Writing this
 * register SWITCHES THE INVERTER INTO WORKING MODE 03 by itself — whatever
 * reactive mode was running stops. And models of 15 kW and below do not carry
 * 3053 at all, so on those machines this is the only power factor there is.
 */
export const PF_SETTING_ACTUAL = 3054

/**
 * Power control word — a BITFIELD, despite the enum the map used to carry.
 *
 * BIT00 is the max-power ceiling flag (0 = 1.09x rated, 1 = 1.10x) and BIT02
 * is the remote active-power limit enable, which works with 3031. BIT01 is
 * reserved and nothing above BIT02 is documented at all.
 *
 * The old `value_map` read this word as {0 Disabled, 1 Remote Active P Limit,
 * 2 Remote Reactive P, 3 Remote PF} and was actively dangerous: choosing
 * "Remote Active P Limit" wrote 1, which sets BIT00 and RAISES the power
 * ceiling to 1.10x rated while leaving the remote limit (BIT02, value 4) off.
 * The last two options appear in no document. It has been dropped from the map.
 */
export const POWER_CONTROL_WORD = 3080

/** Power control slope, %/min. Its description names 3069 BIT00 explicitly. */
export const POWER_CONTROL_SLOPE = 3157

/** Ramp rates and the EN50549 gradients. Plain values, no gate, no save bit. */
export const WGRA_GENERAL = 3148
export const EN50549_RECONNECT_SLOPE = 3182
export const EN50549_STARTUP_SLOPE = 3183
export const WGRA_UP = 3184
export const WGRA_DOWN = 3185

/** Rule21 normal-working power-change slope enable. A plain 0/1 enum. */
export const RATE_P_STS_US = 3192

/** Rule21 PCC reference and offset voltages. */
export const VREF_PCC = 3317
export const VREF_OFS = 3318

/** Frequency-response (FSM) block. 3200 is a bitfield of three switches. */
export const FSM_SWITCH = 3200
export const FSM_POWER_VARIATION = 3201
export const FSM_DROOP = 3202
export const FSM_DEADBAND = 3203
export const FSM_INSENSITIVITY = 3204

/* ------------------------------------------------------------------ *
 * Gospel access. These throw rather than guess: a missing register or
 * rule means the map moved under us, and a screen that quietly draws a
 * row with a default scale is how a 10x-wrong power limit reaches a
 * live machine.
 * ------------------------------------------------------------------ */

/** The settings-space record for a printed address. */
export function registerOf(address: number) {
  const reg = settingsByAddress.get(address)
  if (!reg) {
    throw new Error(
      `No settings register ${address} in the PV gospel; the map is the source`,
    )
  }
  return reg
}

/** The rule for a printed settings address, or undefined when it has none. */
export function pvRuleFor(address: number): PvRule | undefined {
  return ruleFor('settings', address)
}

/** The rule for an address that MUST have one. */
function requireRule(address: number): PvRule {
  const rule = pvRuleFor(address)
  if (!rule) {
    throw new Error(`No rule for settings:${address}; this screen depends on one`)
  }
  return rule
}

/**
 * The address to put in the Modbus frame.
 *
 * The ONLY place the PV wire offset is applied on this screen. Everything
 * above, and everything the view shows, is the PRINTED address — because that
 * is what the documents, SolisCloud and the engineer all say out loud.
 */
export function wireOf(address: number): number {
  const wire = wireAddress(address, 'settings')
  if (wire === null) throw new Error(`No wire address for settings:${address}`)
  return wire
}

/* ------------------------------------------------------------------ *
 * The save-to-flash bits of 3069.
 * ------------------------------------------------------------------ */

/**
 * How a source spells its register addresses.
 *
 * THE TWO CONVENTIONS, AND WHY GUESSING BETWEEN THEM IS NOT SAFE
 * --------------------------------------------------------------
 * The map's raw description names its targets as WIRE addresses — "For 3051
 * Reg." means printed 3052. The vault's corrected RULE text names them as
 * PRINTED addresses. Both strings are just a four-digit number in prose, and
 * the same number means two different registers depending on which convention
 * wrote it.
 *
 * An earlier version of this file guessed, by looking for the word "printed"
 * in each individual label. That worked only for as long as the rule happened
 * to spell the word out. The 2026-08-22 four-bit correction wrote its labels
 * as "Save Active Power % (3052) on power off" — no keyword — and every bit
 * silently shifted up by one: BIT00 resolved to 3053, BIT01 to 3054, BIT02 to
 * 3052. Three wrong registers, no error, and the screen would have promised
 * flash persistence for values nothing was saving.
 *
 * So the convention is no longer inferred per string. It is declared per
 * SOURCE, and the rule states it in `independent_explain`: "The addresses are
 * PRINTED addresses, not wire addresses." A source that says so is read as
 * printed; the map's own description, which says no such thing, is read as
 * wire. Getting this from a sentence the vault writes deliberately beats
 * getting it from a keyword that happens to survive an edit.
 */
type AddressConvention = 'printed' | 'wire'

/**
 * Does this rule declare that it quotes printed addresses?
 *
 * Checked against the rule's OWN explanatory fields rather than the individual
 * bit label, so one declaration covers every label the rule carries and a
 * label that omits the word is not misread.
 */
function conventionOf(rule: PvRule): AddressConvention {
  const extra = rule as unknown as {
    independent_explain?: string
    related_explain?: string
  }
  const declared = [
    extra.independent_explain,
    extra.related_explain,
    rule.write_explain,
    rule.summary,
  ]
    .filter(Boolean)
    .join(' ')
  return /\bPRINTED addresses?\b/i.test(declared) ? 'printed' : 'wire'
}

/**
 * The printed address a piece of source text names, under a stated convention.
 *
 * Nothing is accepted on arithmetic alone: a candidate must correspond to a
 * settings register that actually exists. A printed-convention number that
 * names no register returns null rather than being quietly shifted until it
 * hits one, because that shifting is exactly the failure described above.
 */
function printedFromText(
  text: string,
  convention: AddressConvention,
): number | null {
  const m = /\b(3\d{3})\b/.exec(text)
  if (!m) return null
  const n = Number(m[1])
  if (convention === 'printed') return settingsByAddress.has(n) ? n : null
  return printedForWire(n)
}

/**
 * The printed address whose wire address is `wire`, or null if none is.
 *
 * `wire + 1` is tried first because that is the PV settings offset, but it is
 * only ACCEPTED when `wireOf` on the candidate agrees. A space whose offset is
 * 0 therefore resolves to itself rather than being silently shifted by one.
 */
function printedForWire(wire: number): number | null {
  for (const candidate of [wire + 1, wire]) {
    if (settingsByAddress.has(candidate) && wireOf(candidate) === wire) {
      return candidate
    }
  }
  return null
}

/**
 * Save bits the RULE enumerates, when it enumerates any.
 *
 * Preferred over the description because the rules file is the CORRECTED
 * source and the map's own text is the uncorrected document. The 2026-08-22
 * field correction gave 3069 `independent_bits` [0, 2, 3] with
 * `independent_bit_labels` naming PRINTED registers, which is why this reads
 * `independent_bit_labels` first: those labels have already had the wire
 * offset resolved by the vault, so no arithmetic is left to get wrong.
 *
 * `bit_notes` is checked next because it carries the same statement in prose,
 * and `bit_groups` last for the older shape. If every one of them is silent,
 * this returns null and the map's raw description is parsed instead.
 */
function bitTargetsFromRule(rule: PvRule): Map<number, number> | null {
  const out = new Map<number, number>()
  const convention = conventionOf(rule)
  const extra = rule as unknown as {
    independent_bit_labels?: Record<string, string>
    bit_notes?: Record<string, string>
  }

  /*
   * Ordered most-authoritative first. `independent_bit_labels` is the vault's
   * one-line-per-bit statement and is what a UI should be showing anyway;
   * `bit_notes` says the same thing at length. Both are read under the
   * convention the RULE declares, so a label with no giveaway wording is still
   * read the way its author meant it.
   */
  for (const source of [extra.independent_bit_labels, extra.bit_notes]) {
    for (const [bit, text] of Object.entries(source ?? {})) {
      if (out.has(Number(bit))) continue
      const printed = printedFromText(text, convention)
      if (printed !== null) out.set(Number(bit), printed)
    }
    if (out.size) return out
  }

  for (const group of rule.bit_groups ?? []) {
    for (const [bit, label] of Object.entries(group.bit_labels ?? {})) {
      const printed = printedFromText(label, convention)
      if (printed !== null) out.set(Number(bit), printed)
    }
  }
  return out.size ? out : null
}

/**
 * Save bits parsed out of 3069's own description.
 *
 * "BIT00： ... For 3051 Reg. BIT01：Reserved BIT02： ... For 3050 Reg." — one
 * clause per bit, each naming a WIRE address, hence the explicit convention
 * below.
 *
 * THIS IS THE FALLBACK, AND THE TEXT IT PARSES IS KNOWN TO BE WRONG. That
 * description comes from Ver.3.7 alone, and it names register 3050, which does
 * not exist anywhere in the settings space — a fact that on its own condemns
 * it. Nine other documents (V16-V19 and the three Grid-Tied) describe four
 * CONTIGUOUS bits instead, and the rules file now carries that reading. So
 * this path should never be reached in practice; it exists only so the screen
 * degrades to something rather than throwing if the rule ever loses its bit
 * labels.
 *
 * Parsing prose is not something to be pleased about either way. It is here
 * because the alternative is writing bit numbers into this file as literals,
 * and those literals would keep looking right long after a corrected map made
 * them wrong. A parse that finds nothing throws; a stale literal does not.
 */
function bitTargetsFromDescription(description: string): Map<number, number> {
  const out = new Map<number, number>()
  for (const clause of description.split(/(?=BIT\s*\d{1,2})/i)) {
    const bitMatch = /^BIT\s*(\d{1,2})/i.exec(clause.trim())
    if (!bitMatch) continue
    // Only the text AFTER the bit label may name a target, or a clause would
    // claim the number belonging to the clause that follows it.
    const printed = printedFromText(
      clause.trim().slice(bitMatch[0].length),
      'wire',
    )
    if (printed !== null) out.set(Number(bitMatch[1]), printed)
  }
  return out
}

/**
 * bit number -> the printed register that bit persists.
 *
 * Rule first, description second, and everything filtered through the rule's
 * `related_registers` — the vault's explicit list of the registers 3069
 * protects. That list is the tiebreak for the printed-versus-wire ambiguity
 * the description leaves open, and it is why nothing here needs a literal.
 */
export const SAVE_BIT_TARGETS: ReadonlyMap<number, number> = (() => {
  const rule = requireRule(POWER_OFF_SAVING)
  const vouched = new Set(
    (rule.related_registers ?? [])
      .map((r) => Number(r.split(':').pop()))
      .filter((n) => Number.isFinite(n)),
  )

  const found =
    bitTargetsFromRule(rule) ??
    bitTargetsFromDescription(registerOf(POWER_OFF_SAVING).description ?? '')

  const out = new Map<number, number>()
  for (const [bit, printed] of found) {
    /*
     * `related_registers` also lists 3070, which is a SWITCH and not a save
     * target, so membership is only ever a filter — never a source of bits.
     * A target the vault does not vouch for is dropped rather than guessed at,
     * because a save bit pointed at the wrong register is worse than a missing
     * row: it would promise persistence for a value it does not protect.
     */
    if (vouched.size && !vouched.has(printed)) continue
    out.set(bit, printed)
  }

  if (!out.size) {
    throw new Error(
      `Could not resolve any save bit of ${POWER_OFF_SAVING} from the map or its rule`,
    )
  }
  return out
})()

/** printed register -> the bit of 3069 that persists it. The reverse index. */
export const SAVE_BIT_OF: ReadonlyMap<number, number> = new Map(
  [...SAVE_BIT_TARGETS].map(([bit, address]) => [address, bit]),
)

/**
 * The mask of 3069 this screen owns.
 *
 * Only the bits actually resolved — today BIT00..BIT03. BIT04..15 are reserved
 * and sit OUTSIDE the mask, so `mergeForWrite` takes them from a fresh read of
 * the device and hands them back untouched. Claiming the whole word would zero
 * whatever a newer firmware put in the reserved space.
 *
 * Derived from the resolved targets rather than written down, so a future
 * correction that adds or removes a bit moves this mask with it.
 */
export const SAVE_OWNED_MASK: number = [...SAVE_BIT_TARGETS.keys()].reduce(
  (mask, bit) => mask | (1 << bit),
  0,
)

/** Is the register this save bit aims at persisted, given 3069's word? */
export function savedToFlash(word: number, address: number): boolean {
  const bit = SAVE_BIT_OF.get(address)
  return bit === undefined ? false : isSet(word, bit)
}

/**
 * 3069 with ONE save bit moved and every other bit left exactly as it was.
 *
 * The near half of read-modify-write: this preserves the bits it can see. The
 * write path then merges the result against a fresh read over
 * `SAVE_OWNED_MASK`, which preserves the ones it cannot. Setting "save my
 * power limit" must never quietly stop the PF setting being saved.
 */
export function wordForSave(word: number, address: number, save: boolean): number {
  const bit = SAVE_BIT_OF.get(address)
  if (bit === undefined) return word
  return save ? setBit(word, bit) : clearBit(word, bit)
}

/* ------------------------------------------------------------------ *
 * Failure mode 1: the unlock switches.
 * ------------------------------------------------------------------ */

/** One value an unlock switch can hold, with the registers it turns on. */
export interface UnlockCode {
  /** The magic value. Never a boolean — writing 1 does nothing. */
  value: number
  /** The map's own label for it, e.g. "ON (Enable 3051 & 3080)". */
  label: string
  /** Printed registers this code enables. Empty for the OFF code. */
  enables: number[]
}

/**
 * Every printed settings register a label's numbers resolve to.
 *
 * A label may name more than one — "reactive setting effective ... for
 * registers 3051 and 3083" — so this collects all of them, under whichever
 * convention the caller says the text was written in.
 */
function printedAddressesIn(
  text: string,
  convention: AddressConvention,
): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/\b(3\d{3})\b/g)) {
    const n = Number(m[1])
    const printed =
      convention === 'printed'
        ? settingsByAddress.has(n)
          ? n
          : null
        : printedForWire(n)
    if (printed !== null && !out.includes(printed)) out.push(printed)
  }
  return out
}

/**
 * The codes a switch register accepts.
 *
 * Prefers the rule's corrected `unlock_values` over the map's `value_map` —
 * see the body for why those two disagree and which one is trustworthy.
 */
function unlockCodesOf(address: number): UnlockCode[] {
  const rule = pvRuleFor(address)
  const extra = rule as unknown as {
    unlock_values?: Record<string, string>
    off_value?: number
  } | undefined

  /*
   * THE RULE'S `unlock_values` WINS OVER THE MAP'S `value_map`.
   *
   * Both describe the same three codes, but they disagree on which registers
   * those codes enable, because they were written under different conventions.
   * The map still carries the document's own wording — "ON (Enable 3050 &
   * 3082)" — and 3050 does not exist in the settings space at all. The rule
   * restates it as printed addresses and says so: "These are PRINTED
   * addresses". Reading the corrected statement first means the 0xA2 -> 3054
   * pairing comes from the same place the save-bit pairing does, rather than
   * from two parses that could drift apart.
   *
   * The off code is whatever the rule names in `off_value`; it enables nothing
   * by definition, so it needs no address parse.
   */
  if (extra?.unlock_values) {
    const codes: UnlockCode[] = Object.entries(extra.unlock_values).map(
      ([raw, label]) => ({
        value: Number(raw),
        label,
        enables: printedAddressesIn(label, 'printed'),
      }),
    )
    if (typeof extra.off_value === 'number') {
      const offLabel = registerOf(address).value_map?.[String(extra.off_value)]
      codes.push({
        value: extra.off_value,
        label: offLabel ?? 'OFF',
        enables: [],
      })
    }
    return codes.sort((a, b) => a.value - b.value)
  }

  // No corrected rule for this switch: fall back to the map, whose labels
  // quote wire addresses.
  const valueMap = registerOf(address).value_map ?? {}
  return Object.entries(valueMap)
    .map(([raw, label]) => ({
      value: Number(raw),
      label,
      enables: printedAddressesIn(label, 'wire'),
    }))
    .sort((a, b) => a.value - b.value)
}

/** The codes 3070 accepts. 0x55 off, 0xAA on. */
export const ACTIVE_POWER_CODES: UnlockCode[] = unlockCodesOf(ACTIVE_POWER_SWITCH)

/**
 * The codes 3071 accepts — and there are THREE, not two.
 *
 * Both 0xA1 and 0xA2 are "on", and they enable different registers. A boolean
 * toggle cannot express that choice at all, which is why this screen draws
 * 3071 as a picker built from the map rather than as a switch.
 */
export const REACTIVE_POWER_CODES: UnlockCode[] = unlockCodesOf(
  REACTIVE_POWER_SWITCH,
)

/** Which switch register gates a given power register, or null for none. */
export function switchGating(address: number): number | null {
  if (ACTIVE_POWER_CODES.some((c) => c.enables.includes(address))) {
    return ACTIVE_POWER_SWITCH
  }
  if (REACTIVE_POWER_CODES.some((c) => c.enables.includes(address))) {
    return REACTIVE_POWER_SWITCH
  }
  return null
}

/** The codes of the gating switch that turn a given power register on. */
export function codesEnabling(address: number): UnlockCode[] {
  const gate = switchGating(address)
  if (gate === null) return []
  const codes =
    gate === ACTIVE_POWER_SWITCH ? ACTIVE_POWER_CODES : REACTIVE_POWER_CODES
  return codes.filter((c) => c.enables.includes(address))
}

/* ------------------------------------------------------------------ *
 * The two answers the view asks for, per control.
 * ------------------------------------------------------------------ */

/** Whether a value written to this register is doing anything right now. */
export type UnlockState =
  /** No switch gates it. It works as written. */
  | { kind: 'ungated' }
  /** The gating switch holds a code that enables this register. */
  | { kind: 'unlocked'; gate: number; code: UnlockCode }
  /** The gating switch holds something that does NOT enable it. */
  | { kind: 'locked'; gate: number; needs: UnlockCode[] }
  /** The gating switch has not been read, so we cannot say. */
  | { kind: 'unknown'; gate: number; needs: UnlockCode[] }

/**
 * Failure mode 1, answered per register.
 *
 * `switchWord` is the value READ from the gating switch, or undefined when it
 * has not been read. Undefined is deliberately NOT treated as locked: claiming
 * a control is disabled when we simply have not looked is its own kind of lie,
 * and it would push an engineer to write an unlock code the machine may
 * already hold.
 */
export function isUnlocked(
  address: number,
  switchWord: number | undefined,
): UnlockState {
  const gate = switchGating(address)
  if (gate === null) return { kind: 'ungated' }

  const needs = codesEnabling(address)
  if (switchWord === undefined) return { kind: 'unknown', gate, needs }

  const code = needs.find((c) => c.value === (switchWord & 0xffff))
  return code ? { kind: 'unlocked', gate, code } : { kind: 'locked', gate, needs }
}

/** Whether a value written to this register will still be there tomorrow. */
export type PersistenceState =
  /** 3069 has no bit for it. It behaves however the register behaves. */
  | { kind: 'no-save-bit' }
  /** Its save bit is set: the value goes to flash and survives power-off. */
  | { kind: 'flash'; bit: number }
  /** Its save bit is clear: the value lives in RAM and dies at power-off. */
  | { kind: 'ram'; bit: number }
  /** 3069 has not been read, so we cannot say. */
  | { kind: 'unknown'; bit: number }

/**
 * Failure mode 2, answered per register.
 *
 * Separate from `isUnlocked` on purpose — see the file header. A control can
 * be unlocked and RAM-only (works now, gone after a power cut), or flash-saved
 * and locked (does nothing now, and will still do nothing after a power cut),
 * or any other combination. One badge cannot say that.
 */
export function persistenceOf(
  address: number,
  savingWord: number | undefined,
): PersistenceState {
  const bit = SAVE_BIT_OF.get(address)
  if (bit === undefined) return { kind: 'no-save-bit' }
  if (savingWord === undefined) return { kind: 'unknown', bit }
  return isSet(savingWord, bit) ? { kind: 'flash', bit } : { kind: 'ram', bit }
}

/* ------------------------------------------------------------------ *
 * The rows, grouped.
 * ------------------------------------------------------------------ */

/** One plain-value row the screen draws. */
export interface PowerRow {
  address: number
  label: string
  /** The full-width line under the row. Range notes belong here. */
  description: string
}

/** A named block of rows, drawn under one sub-heading. */
export interface PowerSection {
  id: string
  title: string
  note: string
  rows: PowerRow[]
}

/**
 * ACTIVE POWER LIMITING.
 *
 * The two gated limits are listed together and the switch that gates them is
 * drawn directly above the section, because "the switch is off" is the
 * commonest reason a limit does nothing and that adjacency is what makes it
 * obvious. SolisCloud scatters 3070, 3052 and 3081 across the page in document
 * order, which hides the relationship entirely.
 */
export const ACTIVE_POWER_SECTION: PowerSection = {
  id: 'active',
  title: 'Active power limiting',
  note: `Gated by ${ACTIVE_POWER_SWITCH}. Until that switch holds its ON code, the limits below are accepted and ignored.`,
  rows: [
    {
      address: POWER_LIMIT,
      label: 'Power limit setting',
      description:
        'Percentage of rated active power, 0 ~ 110%. The usual export limit.',
    },
    {
      address: LIMIT_POWER_VALUE,
      label: 'Limit power value',
      description:
        'Absolute active power set-point, in watts. An alternative to the percentage above.',
    },
    {
      address: POWER_CONTROL_WORD,
      label: 'Power control word',
      description:
        'Two switches in one word. BIT00 raises the ceiling from 1.09 x rated to 1.10 x (the inverter saves that flag to flash by itself, so it is NOT a 3069 bit). BIT02 enables the remote active-power limit, which works with 3031.',
    },
  ],
}

/**
 * POWER FACTOR AND REACTIVE POWER.
 *
 * Three registers behind ONE switch with two different on-codes, which is
 * precisely what SolisCloud's Enabled/Disabled rendering cannot express. Kept
 * in one section so the exclusivity is visible: choosing the reactive on-code
 * leaves the PF setting inert, and choosing the PF on-code leaves the reactive
 * set-points inert.
 */
export const REACTIVE_SECTION: PowerSection = {
  id: 'reactive',
  title: 'Power factor & reactive power',
  note: `Gated by ${REACTIVE_POWER_SWITCH}, which has TWO different ON codes enabling different registers below. Pick the one matching the register you actually mean to use.`,
  rows: [
    {
      address: PF_SETTING,
      label: 'Power factor setting',
      description: `Signed power factor. The sign carries leading versus lagging, and 1.00 and -1.00 are the same operating point. Selected by WORKING MODE 03 in 3073 — NOT by the ${REACTIVE_POWER_SWITCH} switch. Saved by ${POWER_OFF_SAVING} BIT01. Models of 15 kW and below do not have this register.`,
    },
    {
      address: PF_SETTING_ACTUAL,
      label: 'PF Setting 02 (actual power factor)',
      description: `The power factor the ${REACTIVE_POWER_SWITCH} 0xA2 code enables, saved by ${POWER_OFF_SAVING} BIT03. WRITING THIS SWITCHES THE INVERTER TO WORKING MODE 03 on its own — whatever reactive mode was running stops.`,
    },
    {
      address: REACTIVE_POWER_LIMIT,
      label: 'Reactive power limit',
      description:
        'Reactive power as a percentage, -60% ~ +60%. Also requires working mode 04.',
    },
    {
      address: LIMITED_REACTIVE_VALUE,
      label: 'Limited reactive power value',
      description: 'Absolute reactive power set-point, in var.',
    },
  ],
}

/**
 * RAMP RATES AND EN50549.
 *
 * Nothing here is gated by a switch, and nothing here has a save bit of its
 * own — with one exception worth stating out loud. 3157's description says
 * "Power off saving if 3069 BIT0=1", which is 3069's ACTIVE-POWER bit rather
 * than a bit belonging to 3157. So 3157 sits here with the ramp rates it
 * behaves like, and the screen shows its persistence from the same bit that
 * persists the power limit.
 */
export const RAMP_SECTION: PowerSection = {
  id: 'ramp',
  title: 'Ramp rates & EN50549',
  note: 'How fast output may change. Not gated by a switch; these take effect as written.',
  rows: [
    {
      address: POWER_CONTROL_SLOPE,
      label: 'Power control slope',
      description: `%/min. 0 means no limit — power control is immediate. Its own description says it is saved by ${POWER_OFF_SAVING} BIT00, the active-power bit.`,
    },
    {
      address: WGRA_GENERAL,
      label: 'Gradient limit for power change',
      description: 'Start-up ramp rate, 5% ~ 600% of rated per minute.',
    },
    {
      address: EN50549_RECONNECT_SLOPE,
      label: 'EN50549 power change gradient after fault',
      description: 'Wgra_Rec. The reconnection ramp once a grid fault clears.',
    },
    {
      address: EN50549_STARTUP_SLOPE,
      label: 'EN50549 gradient limit for power-on',
      description: 'Wgra_nor. The ordinary start-up ramp.',
    },
    {
      address: WGRA_UP,
      label: 'Wgra+ (ramp up slope limit)',
      description: '5% ~ 600% of rated per minute.',
    },
    {
      address: WGRA_DOWN,
      label: 'Wgra- (ramp down slope limit)',
      description: '5% ~ 600% of rated per minute.',
    },
    {
      address: RATE_P_STS_US,
      label: 'RateP_Sts-US',
      description:
        'Rule21 normal-working power-change slope enable. Disabled by default.',
    },
    {
      address: VREF_PCC,
      label: 'VRefPCC',
      description:
        'Rule21 point-of-coupling reference voltage. 1-phase 200 ~ 250 V, 3-phase 260 ~ 290 V.',
    },
    {
      address: VREF_OFS,
      label: 'VRefOfs',
      description: 'Rule21 point-of-coupling offset voltage, -20 ~ +20 V.',
    },
  ],
}

/**
 * FREQUENCY RESPONSE (FSM).
 *
 * 3200 leads because it is the enable for everything under it, and because two
 * of its three bits are ACTIVE-LOW in the map's own words — "0 = function is
 * on" for overfrequency load shedding and for underfrequency boost. The screen
 * draws them from the map's bit labels rather than restating the polarity
 * here; getting that wrong is the Protect Setting trap all over again.
 */
export const FSM_SECTION: PowerSection = {
  id: 'fsm',
  title: 'Frequency response (FSM)',
  note: `${FSM_SWITCH} is a bit word, and two of its three switches are stored backwards — read the bit labels, never the bit values.`,
  rows: [
    {
      address: FSM_SWITCH,
      label: 'FSM switch',
      description:
        'Overfrequency load-shedding special-function bits: Swedish frequency sensitivity, overfrequency load shedding, underfrequency boost.',
    },
    {
      address: FSM_POWER_VARIATION,
      label: 'Power variation',
      description: 'FSM power change limit percentage.',
    },
    {
      address: FSM_DROOP,
      label: 'Droop',
      description: 'FSM droop setting, 2% ~ 12%.',
    },
    {
      address: FSM_DEADBAND,
      label: 'Deadband',
      description: 'FSM response dead zone, in mHz.',
    },
    {
      address: FSM_INSENSITIVITY,
      label: 'F_Insensitivity',
      description: 'FSM frequency insensitivity, in mHz.',
    },
  ],
}

/** Every section, in the order the screen draws them. */
export const POWER_SECTIONS: PowerSection[] = [
  ACTIVE_POWER_SECTION,
  REACTIVE_SECTION,
  RAMP_SECTION,
  FSM_SECTION,
]

/**
 * The switch rows, drawn above the sections they gate rather than inside them.
 *
 * They are not values — they are magic-code pickers — so they get their own
 * editor and their own place. Listing them here also keeps the range-row
 * highlight and any search index honest about them.
 */
export const SWITCH_ROWS: PowerRow[] = [
  {
    address: ACTIVE_POWER_SWITCH,
    label: 'Power limit switch',
    description: `Enables ${POWER_LIMIT} and ${LIMIT_POWER_VALUE}. Not a boolean: writing 1 does nothing at all.`,
  },
  {
    address: REACTIVE_POWER_SWITCH,
    label: 'Reactive power limit switch',
    description: `Three-way. One ON code enables ${REACTIVE_POWER_LIMIT} and ${LIMITED_REACTIVE_VALUE}; the other enables ${PF_SETTING_ACTUAL}.`,
  },
]

/** One save-to-flash bit of 3069, as a row. */
export interface SaveBitRow {
  bit: number
  /** The printed register this bit persists. */
  target: number
  label: string
  description: string
}

/**
 * The save-bit rows, one per bit 3069 actually carries.
 *
 * Built from `SAVE_BIT_TARGETS`, so a corrected map adds or removes a row here
 * with no edit. SolisCloud prints "Power Down Saving Function", "PF_Power Down
 * Saving" and "RP_Power Down Saving" as three separate rows all labelled 3069,
 * which is right in spirit — they ARE three controls — and wrong in mechanism,
 * because each of its rows writes the whole word and clears the other two.
 */
export const SAVE_BIT_ROWS: SaveBitRow[] = [...SAVE_BIT_TARGETS]
  .sort((a, b) => a[0] - b[0])
  .map(([bit, target]) => ({
    bit,
    target,
    label: `Save ${registerOf(target).name} to flash`,
    description: `${POWER_OFF_SAVING} BIT${String(bit).padStart(2, '0')} persists register ${target}. Off, that register lives in RAM and is lost at power-off.`,
  }))

/**
 * Every printed address this screen reads, sorted and de-duplicated.
 *
 * Derived from the rows, so it cannot drift: a row added to a section appears
 * here on the next build and the range-row highlight follows it.
 */
export const ADDRESSES: number[] = [
  ...new Set([
    POWER_OFF_SAVING,
    ...SWITCH_ROWS.map((r) => r.address),
    ...POWER_SECTIONS.flatMap((s) => s.rows.map((r) => r.address)),
  ]),
].sort((a, b) => a - b)

/* ------------------------------------------------------------------ *
 * The `?` prose.
 * ------------------------------------------------------------------ */

const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`

/**
 * The RAM-versus-flash explanation, in the words an engineer standing at a
 * site needs rather than the words the document uses.
 *
 * Written out in full rather than summarised because that is the entire point
 * of putting it in a modal: it has to say what happens if you do not set the
 * bit, why you might deliberately not set it, and which bit persists which
 * register. A one-line hint reading "needs 3069" is what every other rendering
 * of this page already offers, and it is not enough to act on.
 */
export const SAVE_TO_FLASH_HELP = [
  `A value you write here normally lands in RAM. It takes effect immediately and it reads back exactly as you wrote it — and it is GONE the next time the inverter loses power. Nothing in the Modbus reply warns you.`,
  `Register ${POWER_OFF_SAVING} is what changes that. Each of its bits marks ONE power-control register as "save this to flash on power off". Set the bit FIRST, then write the value. Set it afterwards and the value you already wrote is not protected.`,
  `WHICH BIT PROTECTS WHICH REGISTER:\n${SAVE_BIT_ROWS.map(
    (r) =>
      `  - BIT${String(r.bit).padStart(2, '0')} -> register ${r.target}, ${registerOf(r.target).name}`,
  ).join('\n')}`,
  `WHY YOU MIGHT DELIBERATELY LEAVE IT OFF: a RAM-only write is a temporary setting that clears itself. A 20% test limit that vanishes on the next power cycle is safer than one somebody has to remember to undo. Commissioning and fault-finding usually want RAM. A permanent export limit wants flash.`,
  `THIS IS NOT THE SAME THING AS THE UNLOCK SWITCH. A write can fail to do anything for two separate reasons, and they need different fixes:\n  1. THE SWITCH IS OFF — ${ACTIVE_POWER_SWITCH} or ${REACTIVE_POWER_SWITCH} is not holding the code that enables this register. The write is accepted and ignored. Nothing is happening.\n  2. THE SAVE BIT IS CLEAR — the write DID take effect and the machine is doing it right now, but the value is in RAM and dies at power-off. Something is happening, just not tomorrow.\nThe badge on each row tells you which of the two you are looking at.`,
  `${POWER_OFF_SAVING} is written read-modify-write. Setting one save bit here reads the current word and changes only that bit, so the other save bits — and anything a newer firmware put in the reserved bits above BIT03 — are left exactly as they were. A blind write of the whole word is what clears everyone else's bits, and it is what SolisCloud's three separate "Power Down Saving" rows each do.`,
  `DO NOT TOGGLE THESE BITS REPEATEDLY. The documents warn that the flash is rated for fewer than 10000 writes. Set the bit you need, write the value, and leave it alone — this is not a switch to flick while testing.`,
].join('\n\n')

/** The `?` prose for the two unlock switches. Failure mode 1, on its own. */
export const UNLOCK_HELP = [
  `${ACTIVE_POWER_SWITCH} and ${REACTIVE_POWER_SWITCH} are MAGIC-CODE switches, not booleans. Writing 1 to either does nothing at all — no error, no effect.`,
  `${ACTIVE_POWER_SWITCH}:\n${ACTIVE_POWER_CODES.map(
    (c) => `  - ${c.value} (${hex(c.value)}) — ${c.label}`,
  ).join('\n')}`,
  `${REACTIVE_POWER_SWITCH} has THREE codes, and the two ON codes enable DIFFERENT registers:\n${REACTIVE_POWER_CODES.map(
    (c) => `  - ${c.value} (${hex(c.value)}) — ${c.label}`,
  ).join('\n')}\nPicking the wrong one leaves the register you meant to use completely inert, which looks exactly like a failed write.`,
  `Turning a switch OFF does not merely stop the limit — it returns the machine to its default: active power back to 100%, power factor back to 1, reactive power back to 0.`,
  `This is a SEPARATE problem from power-off saving. The switch decides whether the value does anything NOW; ${POWER_OFF_SAVING} decides whether it is still there after a power cut. A control can be unlocked and RAM-only, or saved to flash and locked, and those need different fixes.`,
].join('\n\n')
