/**
 * The register maths behind the PV Fan Control screen, with no React in it.
 *
 * This is SolisCloud's "External Fan" block under Inverter Special Function
 * Setting: three independent trigger routes, a three-band speed curve, an
 * initialisation action, a self-test and the de-icing pair.
 *
 * WHY FAN CONTROL IS ITS OWN SCREEN
 * ---------------------------------
 * It was going to be one section of Special Function. It is not, for a reason
 * that only became clear after checking every address against the map:
 * FIFTEEN of its seventeen registers cannot be read by this app at all (see
 * REACHABILITY below), and the two that can are unrelated to each other.
 *
 * A section like that inside a working screen poisons the screen. Every row
 * around it reads and writes normally; these sit there saying "not read"
 * forever, and an engineer reasonably concludes the whole page is broken. On
 * its own screen the same rows can carry one honest explanation at the top,
 * and Special Function stays a page where every row does what it looks like
 * it does.
 *
 * REACHABILITY — READ THIS BEFORE WONDERING WHY NOTHING FILLS IN
 * --------------------------------------------------------------
 * This app files a PV settings reply word only if `pvSettingsMapper` has a
 * key for that register. Its key table stops at printed 3337, and it is
 * sparse below that too. So of the seventeen registers here:
 *
 *   3301 fan self-test          reachable
 *   3312 BIT — not ours          (Special Function screen owns the word)
 *   3340 de-icing main switch    NOT reachable
 *   3342 de-icing threshold      NOT reachable
 *   3500-3512 the fan block      NOT reachable, every one of them
 *
 * That is a limit of THIS APP, not of the inverter. The registers are
 * documented and the machine honours them. Rows are declared with
 * `reachable: false` and drawn as unreachable rather than as empty boxes an
 * installer is invited to type into — the same choice `pvControlPanelModel`
 * made for the SVG season window, and for the same reason.
 *
 * A write to an unreachable register would ALSO be wrong for a second reason:
 * every one of the 3500 block is read-modify-write in spirit (3500 is a
 * bitfield) or range-checked against its partner, and neither can be done
 * against a word the app has never seen.
 *
 * 3500 IS ONE REGISTER, NOT TWO SWITCHES
 * --------------------------------------
 * SolisCloud prints "External Fan Start/Stop Power Switch — 3500" and
 * "External Fan Start/Stop Current Switch — 3500" as two rows. They are two
 * BITS of one word. Printing the word twice and letting a fitter type a value
 * into either row writes a whole word from a single bit's worth of intent —
 * turning the other route off by accident. This screen resolves 3500 to its
 * bits, from the map's own `bit_flags`, and never offers the word as a value.
 *
 * BIT00 is the temperature route and the map says it CANNOT BE SET: "cannot
 * be set, remains on (1)". So it is shown, and shown as fixed. A checkbox
 * that silently does nothing is worse than a label that says why.
 *
 * THREE ROUTES, EACH A START/STOP PAIR
 * ------------------------------------
 * Temperature, power and current each start the fan at one threshold and stop
 * it at another. Six loose number boxes is how SolisCloud draws it and is why
 * it is easy to set a stop point ABOVE its start point — which the map warns
 * about in prose on all six registers and which makes the fan chatter or
 * never stop. `routeFault()` states the rule once, from the map's own
 * direction, and the screen surfaces it. It is a warning, not a block: the
 * inverter is the authority on what it will accept, and refusing a write the
 * machine would have taken is its own kind of wrong.
 *
 * THE SPEED CURVE IS A CURVE
 * --------------------------
 * 3507/3508 are two temperature points; 3509/3510/3511 are the speeds in the
 * three bands they cut the temperature axis into. Five unrelated fields is
 * not what that is. `speedCurve()` returns the ordered bands with their own
 * ranges spelled out, so the screen can draw T <= P1, P1 < T <= P2, T > P2
 * rather than "Speed 1 / Speed 2 / Speed 3".
 *
 * NOTE ON 3511's DESCRIPTION. The map says band 3 is "T > temperature point
 * 1". Bands 2 and 3 would then overlap. Point 2 is plainly meant — it is the
 * only reading under which the two points and three speeds make a curve — but
 * this file does NOT silently correct the map. `SPEED_3_DOC_CONFLICT` carries
 * the discrepancy to the screen so it is reported rather than papered over.
 *
 * WHAT SOLISCLOUD ASKS FOR THAT THE MAP DOES NOT HAVE
 * ---------------------------------------------------
 *   3513 "LoadShed Mode Set"  — no such settings register. Nothing at 3513.
 *   3340 "Fan Control Switch" — 3340 exists but is `fanDeIcingMainSwitch`,
 *                               the DE-ICING switch, not a fan master switch.
 *                               Drawn as what the map says it is.
 *   3342 range "-10~15 C"     — the map says -100 to 150 (raw), scale 0.1,
 *                               i.e. -10.0 to 15.0 C. SolisCloud's numbers are
 *                               the SCALED ones. Ranges here come from the
 *                               map, so this resolves itself.
 *
 * 3341 WAS ON THAT LIST AND IS NOT ANY MORE
 * -----------------------------------------
 * "Fan Gap Time 3341" could not be substantiated when this screen was built:
 * the harvest had taken V17's single blanket row `3156-3239 Reserve`
 * literally and suppressed 84 addresses that V18/V19 actually document. The
 * vault now lets a NAMED row outrank a Reserve range, and 3341 came back as
 * `fanStartInterval`, "Fan start interval", u16 scale 0.1 s, range 1200-6000
 * raw (120-600 s) — which is exactly the range SolisCloud printed.
 *
 * The lesson is in `FAN_START_INTERVAL`'s comment and in the test: this gap
 * has now bitten twice, so the tests pin the register as PRESENT rather than
 * merely not-asserting its absence. A harvest regression must fail loudly.
 *
 * PRINTED ADDRESSES ONLY. `settingWireAddress` performs the PV -1 and is the
 * only place it happens. Nothing here subtracts one.
 */
import {
  byScopedAddress,
  settingsByAddress,
  type GospelRegister,
} from '../../gospel/pvGospel'
import { ruleFor, type PvRule } from '../../gospel/pvRules'
import { first, group } from './captures'

/* ------------------------------------------------------------------ *
 * Addresses. PRINTED, always.
 * ------------------------------------------------------------------ */

/** Fan self-test. 0x0000 idle, 0x0001 starts the test. */
export const FAN_SELF_TEST = 3301

/** De-icing master switch. 0 off, 1 on. NOT a general fan switch. */
export const DEICE_SWITCH = 3340

/** De-icing temperature threshold, signed, scale 0.1 C. */
export const DEICE_THRESHOLD = 3342

/** The start/stop CONDITION word. A bitfield — see the header. */
export const FAN_CONDITION_SWITCH = 3500

export const TEMP_START = 3501
export const TEMP_STOP = 3502
export const POWER_START = 3503
export const POWER_STOP = 3504
export const CURRENT_START = 3505
export const CURRENT_STOP = 3506

export const CURVE_TEMP_1 = 3507
export const CURVE_TEMP_2 = 3508
export const CURVE_SPEED_1 = 3509
export const CURVE_SPEED_2 = 3510
export const CURVE_SPEED_3 = 3511

/** Restores 3500-3511 to factory values. Takes 0x00AA, not 1. */
export const FAN_INIT = 3512

/**
 * Fan start interval — the minimum gap between fan starts, in seconds.
 *
 * RECOVERED 2026-08-22. This register was missing from the map entirely,
 * suppressed by a stale `3156-3239 Reserve` range from V17 that outranked the
 * named rows V18/V19 print inside it. SolisCloud calls it "Fan Gap Time"; the
 * map calls it `fanStartInterval`, and the map's name is the one used here.
 *
 * Scale 0.1 s and a raw range of 1200-6000, i.e. 120-600 s. Neither the scale
 * nor the range is written into this file — both come off the gospel record
 * at draw time, like every other value row.
 */
export const FAN_START_INTERVAL = 3341

/* ------------------------------------------------------------------ *
 * Lookups. Every one names its scope, because a bare PV address is not
 * an identity. See `pvGospel.ts`.
 * ------------------------------------------------------------------ */

/** Gospel record for a settings register, or null when the map lost it. */
export function settingReg(address: number): GospelRegister | null {
  return byScopedAddress('settings', address)
}

/**
 * The rule for a settings register, or undefined when it has none.
 *
 * Looked up at CALL TIME, never captured at module load: `pvRules.json` is
 * being extended alongside this screen, and a rule that appears for 3500
 * tomorrow must reach the screen without an edit here.
 */
export function ruleForSetting(address: number): PvRule | undefined {
  return ruleFor('settings', address)
}

/* ------------------------------------------------------------------ *
 * Reachability. See the header.
 * ------------------------------------------------------------------ */

/**
 * Can this app hold a reading for this printed settings address?
 *
 * Answered from `pvSettingsMapper` at runtime rather than from a list typed
 * here, so the day someone extends the key table these rows light up on their
 * own. The caller passes the mapper in; the model never imports the store,
 * which is what keeps it testable without one.
 *
 * The mapper's indexes are relative to PRINTED 3000 — the wire -1 belongs to
 * the band, not to this arithmetic. See `Pv/gospelMapper.ts`.
 */
export function isReachable(
  mapper: Record<string, number | number[]>,
  address: number,
): boolean {
  const want = address - 3000
  for (const index of Object.values(mapper)) {
    if (Array.isArray(index)) {
      if (index.includes(want)) return true
    } else if (index === want) return true
  }
  return false
}

/* ------------------------------------------------------------------ *
 * 3500, resolved to bits.
 * ------------------------------------------------------------------ */

/** One switch inside the 3500 condition word. */
export interface FanConditionBit {
  bit: number
  /** From the map's `bit_flags`, never typed here. */
  label: string
  /**
   * True when the map says the bit cannot be written.
   *
   * BIT00 is the temperature route, which the document states is fixed on.
   * The screen shows it and refuses to move it, rather than offering a
   * checkbox whose write the inverter ignores.
   */
  fixed: boolean
  /** Which start/stop pair this bit arms, for the screen to group by. */
  route: FanRouteId
}

export type FanRouteId = 'temperature' | 'power' | 'current'

/**
 * The bit -> route mapping, matched on the map's own label text.
 *
 * Matched on the WORD in the label rather than on the bit number, for the
 * same reason `protectSettingModel.bitNamed` does it: if a revision ever
 * renumbers the bits, the route follows the meaning instead of staying
 * attached to a stale position and arming the wrong pair.
 */
const ROUTE_WORDS: Array<[FanRouteId, RegExp]> = [
  ['temperature', /temperature/i],
  ['power', /power/i],
  ['current', /current/i],
]

/**
 * The bits of 3500, read out of the map's `bit_flags`.
 *
 * Returns an empty list when the map carries no flags, which makes the screen
 * say so rather than invent three checkboxes. A bit whose label matches no
 * route word is dropped: it is a reserve bit the map happens to name, and
 * this screen has no pair to attach it to.
 */
export function fanConditionBits(): FanConditionBit[] {
  const flags = settingsByAddress.get(FAN_CONDITION_SWITCH)?.bit_flags
  if (!flags) return []
  const out: FanConditionBit[] = []
  flags.forEach((label, bit) => {
    if (!label || label === 'Reserve' || label === 'Reserved') return
    const match = ROUTE_WORDS.find(([, re]) => re.test(label))
    if (!match) return
    out.push({
      bit,
      label,
      // The map states the fixed one in the label itself — "(fixed on)".
      fixed: /fixed|cannot be set/i.test(label),
      route: match[0],
    })
  })
  return out
}

/** Is the route armed in this word? */
export function routeArmed(word: number, sw: FanConditionBit): boolean {
  return ((word >> sw.bit) & 1) === 1
}

/**
 * The word with one route's bit moved.
 *
 * A fixed bit is a no-op rather than a throw: the screen already refuses to
 * offer it, and a model that throws on a state the UI cannot reach is a
 * crash waiting for a future refactor rather than a safeguard.
 */
export function wordForRoute(
  word: number,
  sw: FanConditionBit,
  armed: boolean,
): number {
  if (sw.fixed) return word & 0xffff
  return (armed ? word | (1 << sw.bit) : word & ~(1 << sw.bit)) & 0xffff
}

/** Bits this screen may claim in a masked write of 3500. */
export function conditionOwnedMask(): number {
  return fanConditionBits()
    .filter((b) => !b.fixed)
    .reduce((mask, b) => mask | (1 << b.bit), 0)
}

/* ------------------------------------------------------------------ *
 * The three start/stop routes.
 * ------------------------------------------------------------------ */

/** One trigger route: a start threshold and the stop threshold below it. */
export interface FanRoute {
  id: FanRouteId
  label: string
  /** PRINTED address of the start threshold. */
  start: number
  /** PRINTED address of the stop threshold. */
  stop: number
  description: string
}

/**
 * The three routes, start first.
 *
 * Start before stop in every one, because that is the order the values must
 * be in: the map states on all six registers that start >= stop. Drawing them
 * the other way round would make the constraint read backwards.
 *
 * No units, scales or ranges here — those come from each register's own
 * gospel record at draw time.
 */
export const FAN_ROUTES: FanRoute[] = [
  {
    id: 'temperature',
    label: 'Temperature route',
    start: TEMP_START,
    stop: TEMP_STOP,
    description:
      'Runs the fan once the inverter gets this hot and stops it once it has cooled back to the stop point. Always armed — the temperature bit of the condition word cannot be turned off.',
  },
  {
    id: 'power',
    label: 'Power route',
    start: POWER_START,
    stop: POWER_STOP,
    description:
      'Runs the fan above this output, as a percentage of rated power, and stops it once output falls back to the stop point. Armed by its bit in the condition word.',
  },
  {
    id: 'current',
    label: 'Current route',
    start: CURRENT_START,
    stop: CURRENT_STOP,
    description:
      'Runs the fan above this output current and stops it once current falls back to the stop point. Armed by its bit in the condition word.',
  },
]

/**
 * Is this route's pair the wrong way round?
 *
 * The rule, stated once: STOP must be at or below START. Every one of the six
 * registers carries it in prose, in both directions ("the start point must be
 * greater than or equal to the stop point", "the stop point must be less than
 * or equal to the start point"), which is the same rule said twice.
 *
 * Compares RAW values, which is safe because a route's two registers always
 * share a scale — they are the same measurement at two thresholds. Comparing
 * display values would mean scaling twice for no gain.
 *
 * Returns null when either value is missing: an unread register is not a
 * misconfiguration, and claiming one would put a red warning on a screen that
 * simply has not been read yet.
 */
export function routeFault(
  startRaw: number | undefined,
  stopRaw: number | undefined,
): string | null {
  if (startRaw === undefined || stopRaw === undefined) return null
  if (stopRaw <= startRaw) return null
  return 'Stop point is above the start point. The fan will not stop cleanly — set the stop point at or below the start point.'
}

/* ------------------------------------------------------------------ *
 * The speed curve.
 * ------------------------------------------------------------------ */

/** One band of the speed curve: a temperature range and the speed in it. */
export interface SpeedBand {
  /** PRINTED address of the speed register for this band. */
  speed: number
  /** How the band's temperature range reads, built from the point labels. */
  range: string
  /** The point registers that bound it, for the screen to reference. */
  bounds: number[]
}

/**
 * The curve, low band first.
 *
 * Expressed as bands rather than as five fields so the screen can draw an
 * ordered curve. The ranges are written against the POINT REGISTERS by
 * number, not against their values, because the values change and the
 * structure does not.
 */
export function speedCurve(): SpeedBand[] {
  return [
    {
      speed: CURVE_SPEED_1,
      range: `T ≤ point 1 (${CURVE_TEMP_1})`,
      bounds: [CURVE_TEMP_1],
    },
    {
      speed: CURVE_SPEED_2,
      range: `point 1 (${CURVE_TEMP_1}) < T ≤ point 2 (${CURVE_TEMP_2})`,
      bounds: [CURVE_TEMP_1, CURVE_TEMP_2],
    },
    {
      speed: CURVE_SPEED_3,
      range: `T > point 2 (${CURVE_TEMP_2})`,
      bounds: [CURVE_TEMP_2],
    },
  ]
}

/**
 * The two curve temperature points must be at least 2 C apart.
 *
 * Stated on both registers: "Temperature point 1 <= (temperature point 2 -
 * 2 C)". The 2 is in the map's prose and nowhere in its structure — there is
 * no field for a minimum separation — so it is read back OUT of that prose
 * rather than typed, and `curveGapMatchesMap` below fails if the wording
 * changes. Returns null when the map does not state it, which makes the check
 * disappear rather than assert a number nobody wrote down.
 */
export function curveMinGapRaw(): number | null {
  const reg = settingsByAddress.get(CURVE_TEMP_1)
  const prose = reg?.description ?? ''
  // "temperature point 2 - 2℃" — the number between the minus and the degree.
  const found = prose.match(/point\s*2\s*-\s*(\d+(?:\.\d+)?)\s*℃/i)
  if (!found) return null
  const degrees = Number(found[1])
  const scale = reg?.scale ?? 1
  return Number.isFinite(degrees) ? Math.round(degrees / scale) : null
}

/** True while the map still states the separation this screen enforces. */
export function curveGapMatchesMap(): boolean {
  return curveMinGapRaw() !== null
}

/**
 * Are the two curve points too close together?
 *
 * Raw comparison, like `routeFault` — the two points share a scale. Null
 * whenever a value is missing or the map does not state the gap, for the same
 * reason: silence is the honest answer, not a warning.
 */
export function curveFault(
  point1Raw: number | undefined,
  point2Raw: number | undefined,
): string | null {
  if (point1Raw === undefined || point2Raw === undefined) return null
  const gap = curveMinGapRaw()
  if (gap === null) return null
  if (point2Raw - point1Raw >= gap) return null
  const reg = settingsByAddress.get(CURVE_TEMP_1)
  const scale = reg?.scale ?? 1
  return `Point 2 must be at least ${gap * scale}${reg?.units ?? ''} above point 1.`
}

/**
 * The map's own text for the top speed band, so the screen can quote it.
 *
 * 3511 says its band is "T > temperature point 1", which overlaps band 2.
 * Point 2 is plainly meant. This file does not correct the map — it carries
 * the conflict up so a human decides, which is the whole reason the gospel is
 * the source and the screen is not.
 */
export const SPEED_3_DOC_CONFLICT = [
  `The map's description of ${CURVE_SPEED_3} says its band is "T > temperature point 1". Read literally that overlaps band 2, which is "point 1 < T <= point 2" — two speeds would apply to the same temperature.`,
  `Point 2 is almost certainly meant: two points cut the temperature axis into exactly three bands, and three speed registers is exactly what the map provides. This screen draws it that way.`,
  `It is flagged rather than silently corrected because the map is the source of truth in this app and a wrong band boundary is the kind of thing that gets copied forward. If the document really does mean point 1, the curve is not a curve and this screen is drawing it wrong.`,
].join('\n\n')

/* ------------------------------------------------------------------ *
 * The two actions.
 * ------------------------------------------------------------------ */

/**
 * An action row: a button that writes one magic value. No value to show.
 *
 * Typed apart from the value rows deliberately. An action has no reading, no
 * range and no editor, and giving it the same shape as a value row is how it
 * eventually acquires one.
 */
export interface FanAction {
  address: number
  label: string
  description: string
  /**
   * True when the write undoes settings the installer made.
   *
   * Fan initialisation resets 3500-3511 — twelve registers, every threshold
   * and the whole speed curve — so it is confirmed like a reset, not clicked
   * like a test.
   */
  destructive: boolean
}

/**
 * The magic value that performs fan initialisation.
 *
 * Read out of the register's own description rather than typed as 0x00AA.
 * The document states it ("0x00AA — means on"), and a screen that hardcodes
 * it would keep sending the old code after a revision changed it — writing a
 * number the inverter treats as "no", silently.
 *
 * Prefers the rule's `unlock_value` when one appears, since that is the
 * structured field for exactly this and the rules file is being extended.
 * Returns null when neither source states it, which disarms the button.
 */
export function fanInitValue(): number | null {
  const fromRule = ruleForSetting(FAN_INIT)?.unlock_value
  if (typeof fromRule === 'number') return fromRule

  const prose = settingsByAddress.get(FAN_INIT)?.description ?? ''
  // "0x00AA — means on". Take the hex code that is not the zero one.
  const codes = [...prose.matchAll(/0x([0-9a-f]{2,4})/gi)]
    .map((m) => parseInt(group(m, 1), 16))
    .filter((n) => n !== 0)
  return codes.length ? first(codes) : null
}

/**
 * The value that starts the fan self-test.
 *
 * 3301 has no rule and no `value_map`; its description states the two codes
 * in prose ("0000H — not started, 0001H — started"). Read from there for the
 * same reason as above. Null disarms the button.
 */
export function fanSelfTestValue(): number | null {
  const prose = settingsByAddress.get(FAN_SELF_TEST)?.description ?? ''
  const codes = [...prose.matchAll(/([0-9a-f]{4})H/gi)]
    .map((m) => parseInt(group(m, 1), 16))
    .filter((n) => n !== 0)
  return codes.length ? first(codes) : null
}

export const FAN_INIT_ACTION: FanAction = {
  address: FAN_INIT,
  label: 'Restore fan settings to factory',
  description:
    'Resets every fan register from the condition word through the speed curve back to its factory value. Every threshold and every speed set on this screen is lost. Takes a magic value, not 1.',
  destructive: true,
}

export const FAN_SELF_TEST_ACTION: FanAction = {
  address: FAN_SELF_TEST,
  label: 'Fan self-test',
  description:
    'Spins the fan to check it turns. After it runs, read data register 3044: a fan abnormal alarm (F011H) there means the test failed. Nothing on this screen reports the result — it comes back as an alarm.',
  destructive: false,
}

/* ------------------------------------------------------------------ *
 * De-icing.
 * ------------------------------------------------------------------ */

/** A plain settings row this screen draws an editor for. */
export interface FanRow {
  /** PRINTED address, settings space. */
  address: number
  label: string
  description: string
}

/**
 * Fan start interval — how long the fan must stay stopped before restarting.
 *
 * Sits with the trigger routes rather than with de-icing or the curve,
 * because it constrains all three routes at once: whatever asks the fan to
 * start, this decides whether it is allowed to yet. Drawn after the three
 * routes so it reads as a rule over them rather than as a fourth route.
 *
 * It is the anti-chatter setting, and it is the natural partner of the
 * `routeFault` warning above — an inverted start/stop pair makes the fan
 * chatter, and a long interval is what stops it doing so while the pair is
 * being corrected.
 */
export const INTERVAL_ROW: FanRow = {
  address: FAN_START_INTERVAL,
  label: 'Fan start interval',
  description:
    'The shortest time the fan may stay off before it is allowed to start again. Applies to all three trigger routes at once. Raising it stops a fan hunting on and off around a threshold; it does not fix the threshold that is making it hunt.',
}

/**
 * The de-icing pair.
 *
 * Grouped apart from the three trigger routes because de-icing runs the fan
 * for the opposite reason — to clear ice, not to shed heat — and the
 * threshold is a COLD one. Lumping it in with the temperature route would
 * suggest they are two ends of one setting. They are not.
 */
export const DEICE_ROWS: FanRow[] = [
  {
    address: DEICE_SWITCH,
    label: 'Fan de-icing',
    description:
      'Runs the fan to clear ice when it is cold enough. SolisCloud lists this address as a general "Fan Control Switch"; the map calls it the de-icing main switch, which is what it is.',
  },
  {
    address: DEICE_THRESHOLD,
    label: 'De-icing temperature threshold',
    description:
      'The temperature at or below which de-icing runs. Signed — a negative value is normal here, and is the whole point of the setting.',
  },
]

/* ------------------------------------------------------------------ *
 * Help text.
 * ------------------------------------------------------------------ */

/** Why almost nothing on this screen fills in. */
export const UNREACHABLE_HELP = [
  `Most of this screen cannot be read or written by this app yet. That is a limit of the APP, not of the inverter — the registers are documented and the machine honours them.`,
  `This app files a PV settings reply word only if its key table has a name for that register. The table (\`pvSettingsMapper\`) stops at printed 3337 and is sparse below that, so the whole external-fan block at ${FAN_CONDITION_SWITCH}-${FAN_INIT}, plus de-icing at ${DEICE_SWITCH} and ${DEICE_THRESHOLD} and the start interval at ${FAN_START_INTERVAL}, is read off the wire and then discarded.`,
  `Only the fan self-test at ${FAN_SELF_TEST} is wired in.`,
  `The rows are drawn anyway rather than hidden, because an engineer who has come here looking for the fan curve needs to know it exists and that this build is not showing it — not to conclude the inverter has no fan settings.`,
  `Writing to them is refused for a second reason on top of that: ${FAN_CONDITION_SWITCH} is a bitfield and the six thresholds are range-checked against their partners, and neither can be done safely against a word this app has never seen.`,
].join('\n\n')

/** Why 3500 appears twice in SolisCloud and once here. */
export const CONDITION_WORD_HELP = [
  `SolisCloud prints ${FAN_CONDITION_SWITCH} as two separate rows — "External Fan Start/Stop Power Switch" and "External Fan Start/Stop Current Switch" — both against the same address. They are not two registers. They are two BITS of one word.`,
  `Typing a value into either of those rows writes the WHOLE word from one bit's worth of intent, which turns the other route off by accident. This screen resolves the word to its bits and never offers it as a plain number.`,
  `BIT00 is the temperature route. The document says it "cannot be set, remains on (1)", so it is shown here as fixed rather than as a switch that quietly ignores you. Temperature is always a reason the fan may run.`,
  `The bit labels come from the map's own flags for ${FAN_CONDITION_SWITCH}, so a corrected map moves this screen without an edit.`,
].join('\n\n')

/** Why start and stop are drawn as a pair. */
export const ROUTE_PAIR_HELP = [
  `The fan has three independent reasons to run: it is too hot, output power is high, or output current is high. Each is a PAIR — a start threshold and a stop threshold — and the pair must be the right way round.`,
  `The stop point must be at or BELOW the start point. Every one of the six registers says so in its own description. Set a stop point above its start point and the fan has no clean state to settle in: it starts, immediately satisfies the stop condition or never satisfies it, and either chatters or runs continuously.`,
  `This screen warns when a pair is inverted but does not refuse the write. The inverter is the authority on what it accepts, and blocking a write the machine would have taken is its own kind of wrong.`,
  `The three routes are independent and any combination may be armed. Arming none does not stop the fan — the temperature route cannot be disarmed.`,
].join('\n\n')

/**
 * Every settings register this screen concerns itself with, for the range
 * button highlight.
 *
 * The unreachable ones are included on purpose: the highlight is about which
 * part of the map the screen is about, and hiding them would make the range
 * button disagree with the rows on screen. Built from the row structures, so
 * a row added or removed moves this with it.
 */
export function pvFanAddresses(): number[] {
  return Array.from(
    new Set([
      FAN_SELF_TEST,
      ...DEICE_ROWS.map((r) => r.address),
      FAN_CONDITION_SWITCH,
      ...FAN_ROUTES.flatMap((r) => [r.start, r.stop]),
      INTERVAL_ROW.address,
      CURVE_TEMP_1,
      CURVE_TEMP_2,
      ...speedCurve().map((b) => b.speed),
      FAN_INIT,
    ]),
  ).sort((a, b) => a - b)
}
