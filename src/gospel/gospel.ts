/**
 * The one place the gospel map and its rules are loaded.
 *
 * hybrid.json is 1.4 MB. Import it here only; every consumer takes the
 * prebuilt lookups below so webpack bundles the payload once.
 *
 * ADDRESS IS THE PRIMARY IDENTITY
 * -------------------------------
 * `byAddress` is total and lossless: one entry per register, keyed by the
 * absolute printed address. Everything else in this file is a convenience
 * index over it.
 *
 * KEYS ARE NOT UNIQUE
 * -------------------
 * 31 keys appear at more than one address. They are NOT redundant copies —
 * they are the same measurement reported at a different SCOPE:
 *
 *   - MODULE blocks. The map contains self-describing modules, each opened by
 *     a `moduleId<N>...` header, followed by a `module<N>RegisterCount` whose
 *     description declares the block's span, followed by a 0xAA55 valid
 *     marker. Module 1 = this unit's port powers, Module 6 = the whole
 *     PV + hybrid system, Module 7 = remote control. So
 *     `generatorTotalActivePower` exists at module-1 scope AND module-6 scope.
 *   - The PARALLEL-system block, whose keys already carry a `parallelSystem`
 *     prefix, plus the few unprefixed rows that sit inside its span.
 *   - DATA vs SETTINGS collisions (`year`, `meterCTPosition`, ...): the same
 *     name in the 33000 read space and in the 43000 holding space.
 *   - A handful of repeated blocks with no distinguishing text in the map
 *     itself (grid-protection stage pairs, dispatch groups, `reserved`
 *     padding). Those get a deterministic positional suffix — see
 *     `positionalSuffix` below.
 *
 * `byQualifiedKey` gives every one of the registers a unique key by pinning
 * the scope. `allByKey` answers "every scope this measurement exists at".
 */
import gospelJson from './generated/hybrid.json';
import rulesJson from './generated/hybridRules.json';

export type GospelKind = 'u16' | 's16' | 'u32' | 's32' | 'ascii' | 'bit' | null;

export interface GospelRegister {
  address_start: number;
  address_end: number | null;
  key: string;
  name: string;
  kind: GospelKind;
  scale: number;
  units: string;
  category: string;
  word_order: 'be' | 'le';
  value_map: Record<string, string> | null;
  bit_flags: string[] | null;
  unverified: boolean;
  revision_note: string | null;
  /**
   * Absolute address of this reading's HIGH word, when the 32-bit value is
   * split across two NON-ADJACENT registers.
   *
   * `address_end` covers the ordinary wide register, whose words are
   * contiguous. Three readings are not: a later document revision added the
   * high word wherever there was room, up to 1 196 registers away. Null for
   * everything else.
   */
  high_word_address?: number | null;
  description: string;
}

/** The scope a register is reported at. See the file header. */
export type GospelScope =
  | 'data'
  | 'settings'
  | 'parallel'
  | 'module1'
  | 'module6'
  | 'module7';

interface RawSpace {
  space: string;
  reg_type: string;
  registers: GospelRegister[];
}

const spaces: RawSpace[] = (gospelJson as any).register_spaces;

const all: GospelRegister[] = spaces.flatMap((s) => s.registers);

/** Look up by absolute printed address, e.g. 43110. */
export const byAddress = new Map<number, GospelRegister>(
  all.map((r) => [r.address_start, r]),
);

/* ------------------------------------------------------------------ *
 * Space (data vs settings), read from the map, never hardcoded.
 * ------------------------------------------------------------------ */

/** address -> 'data' | 'settings', taken from the register_space it lives in. */
const spaceOfAddress = new Map<number, 'data' | 'settings'>();
for (const s of spaces) {
  const kind = s.reg_type === 'settings' ? 'settings' : 'data';
  for (const r of s.registers) spaceOfAddress.set(r.address_start, kind);
}

/* ------------------------------------------------------------------ *
 * Module blocks, DERIVED from the map's own self-description.
 *
 * We scan for `moduleId<N>...` headers rather than hardcoding 34600 /
 * 34900 / 25000. The span comes from the following `module<N>RegisterCount`
 * record, whose description literally states the range of valid registers
 * ("Number of valid registers in 34602~34649"). If that text ever stops
 * parsing we fall back to the header address plus the declared 48-register
 * window, so the block is still bounded rather than silently empty.
 * ------------------------------------------------------------------ */

export interface ModuleBlock {
  /** 1, 6, 7, ... as printed in the moduleId header. */
  id: number;
  /** Address of the `moduleId<N>` header register. */
  headerAddress: number;
  /** First address covered by the block (inclusive) — the header itself. */
  start: number;
  /** Last address covered by the block (inclusive). */
  end: number;
  /** The scope name, e.g. 'module1'. */
  scope: GospelScope;
}

/** Both an ASCII tilde and a unicode en/em dash appear as range separators. */
const RANGE_RE = /(\d{4,5})\s*[~–—-]\s*(\d{4,5})/;

/** Default window a module declares when the count text cannot be parsed. */
const MODULE_FALLBACK_WINDOW = 49;

function findModuleBlocks(): ModuleBlock[] {
  const blocks: ModuleBlock[] = [];
  for (const r of all) {
    const m = /^moduleId(\d+)/.exec(r.key);
    if (!m) continue;
    const id = Number(m[1]);
    const header = r.address_start;

    // The count register sits directly after the header and declares the span.
    const count = byAddress.get(header + 1);
    let end = header + MODULE_FALLBACK_WINDOW;
    if (count && /RegisterCount$/i.test(count.key)) {
      const range = RANGE_RE.exec(count.description || '');
      if (range) {
        const hi = Number(range[2]);
        if (hi > header) end = hi;
      }
    }
    blocks.push({
      id,
      headerAddress: header,
      start: header,
      end,
      scope: `module${id}` as GospelScope,
    });
  }
  return blocks.sort((a, b) => a.start - b.start);
}

/** Every self-describing module block found in the map, span derived. */
export const moduleBlocks: ModuleBlock[] = findModuleBlocks();

function moduleBlockAt(address: number): ModuleBlock | undefined {
  return moduleBlocks.find((b) => address >= b.start && address <= b.end);
}

/* ------------------------------------------------------------------ *
 * The parallel-system block.
 *
 * Most of its rows already carry a `parallelSystem` prefix. A few unprefixed
 * rows sit between them in the same contiguous run (34490..34497). We derive
 * the run from the prefixed rows themselves: take the tightest contiguous
 * cluster of `parallelSystem*` addresses and let the rows inside it count as
 * parallel scope too. Prefixed rows elsewhere (25012, 33388, ...) keep the
 * parallel scope by their key alone.
 * ------------------------------------------------------------------ */

/** Largest address gap still considered "the same block". */
const PARALLEL_CLUSTER_GAP = 8;

interface Span {
  start: number;
  end: number;
}

function findParallelSpans(): Span[] {
  const addrs = all
    .filter((r) => /^parallelSystem/.test(r.key))
    .map((r) => r.address_start)
    .sort((a, b) => a - b);
  if (addrs.length === 0) return [];

  // Cluster the prefixed addresses into runs with no gap bigger than the
  // threshold. A lone prefixed row is its own (degenerate) run.
  // `!` below: the empty case returned above, `i` is bounded by
  // `addrs.length`, and `runs` is seeded so it always has a last element.
  const runs: Span[] = [{ start: addrs[0]!, end: addrs[0]! }];
  for (let i = 1; i < addrs.length; i += 1) {
    const last = runs[runs.length - 1]!;
    if (addrs[i]! - last.end <= PARALLEL_CLUSTER_GAP) last.end = addrs[i]!;
    else runs.push({ start: addrs[i]!, end: addrs[i]! });
  }

  // Extend each run over the contiguous UNPREFIXED sibling totals that follow
  // it. Those are the same block's rows; the generator simply did not carry
  // the prefix onto them. Only "...TotalPower"/"...TotalActivePower" siblings
  // are absorbed, and never across a module boundary.
  for (const run of runs) {
    let end = run.end;
    for (;;) {
      const next = byAddress.get(end + 1);
      if (!next || moduleBlockAt(next.address_start)) break;
      if (!/Total(Active)?Power$/.test(next.key)) break;
      end = next.address_start;
    }
    run.end = end;
  }
  return runs;
}

const parallelSpans = findParallelSpans();

function inParallelSpan(address: number): boolean {
  return parallelSpans.some((s) => address >= s.start && address <= s.end);
}

/* ------------------------------------------------------------------ *
 * scopeOf
 * ------------------------------------------------------------------ */

/**
 * The scope a register is reported at.
 *
 * Precedence: module block > parallel block > register space. A module block
 * is the tightest, most explicit statement the map makes about a register, so
 * it wins; the parallel block is next; otherwise the register is plain data or
 * plain settings.
 */
export function scopeOf(reg: GospelRegister): GospelScope {
  const address = reg.address_start;
  const block = moduleBlockAt(address);
  if (block) return block.scope;
  if (/^parallelSystem/.test(reg.key)) return 'parallel';
  if (inParallelSpan(address)) return 'parallel';
  return spaceOfAddress.get(address) ?? 'data';
}

/* ------------------------------------------------------------------ *
 * Indexes
 * ------------------------------------------------------------------ */

/**
 * key -> every register carrying that key, ordered by ascending address.
 *
 * Use this to ask "at what scopes does this measurement exist?".
 */
export const allByKey: Map<string, GospelRegister[]> = (() => {
  const out = new Map<string, GospelRegister[]>();
  for (const r of all) {
    const list = out.get(r.key);
    if (list) list.push(r);
    else out.set(r.key, [r]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.address_start - b.address_start);
  }
  return out;
})();

/** Every key that appears at more than one address. */
export const ambiguousKeys: ReadonlySet<string> = new Set(
  [...allByKey.entries()].filter(([, v]) => v.length > 1).map(([k]) => k),
);

/**
 * Look up by camelCase key, e.g. "storageControlSwitchValue".
 *
 * DOCUMENTED RESOLUTION FOR AMBIGUOUS KEYS: the LOWEST address in the DATA
 * space wins; if the key exists only in the settings space, the lowest
 * settings address wins. This is stable (address order, not file order) and
 * never silently depends on which record the generator emitted last.
 *
 * Callers that need a specific scope must use `byQualifiedKey`; callers that
 * need to know a key is ambiguous can test `ambiguousKeys`, or read every
 * scope from `allByKey`.
 */
export const byKey: Map<string, GospelRegister> = (() => {
  const out = new Map<string, GospelRegister>();
  for (const [key, list] of allByKey) {
    const dataFirst = list.filter((r) => spaceOfAddress.get(r.address_start) === 'data');
    // `!`: allByKey is built by pushing, so no list is ever empty.
    out.set(key, (dataFirst.length ? dataFirst : list)[0]!);
  }
  return out;
})();

/**
 * Deterministic positional suffix for duplicate families the map itself does
 * NOT distinguish.
 *
 * Applies to the grid-protection stage pairs in 33779..33833, the repeated
 * remote-dispatch group blocks (44129/44169, 44156/44196) and the `reserved`
 * padding at 43252..43254. The map's own `name`/`description` fields do not
 * name the stage or the group number, so no semantics are invented: the
 * suffix is simply the 1-based occurrence in ASCENDING ADDRESS order, e.g.
 * `data.upperLimit81S1#1` (33780) and `data.upperLimit81S1#2` (33782).
 *
 * Because it is derived from address order it is stable across rebuilds.
 */
function positionalSuffix(reg: GospelRegister, siblings: GospelRegister[]): string {
  const index = siblings.findIndex((r) => r.address_start === reg.address_start);
  return `#${index + 1}`;
}

/**
 * key -> register, with EVERY register reachable. One entry per register.
 *
 * Unambiguous keys are stored bare, exactly as `byKey` has them, so existing
 * lookups keep working. Ambiguous keys are stored as `<scope>.<key>`, and if
 * two records still collide inside a single scope they additionally get the
 * positional suffix described above.
 *
 * The map holds EXACTLY one entry per register — `byQualifiedKey.size` equals
 * `registerCount`. Ambiguous keys are therefore NOT also present bare here;
 * for the documented default of an ambiguous key use `byKey`.
 */
export const byQualifiedKey: Map<string, GospelRegister> = (() => {
  const out = new Map<string, GospelRegister>();
  for (const [key, list] of allByKey) {
    if (list.length === 1) {
      out.set(key, list[0]!);
      continue;
    }
    // Group by scope so we only reach for a positional suffix when the scope
    // alone still does not separate two records.
    const byScope = new Map<GospelScope, GospelRegister[]>();
    for (const r of list) {
      const scope = scopeOf(r);
      const bucket = byScope.get(scope);
      if (bucket) bucket.push(r);
      else byScope.set(scope, [r]);
    }
    for (const [scope, bucket] of byScope) {
      for (const r of bucket) {
        const suffix = bucket.length > 1 ? positionalSuffix(r, bucket) : '';
        out.set(`${scope}.${key}${suffix}`, r);
      }
    }
  }
  return out;
})();

/** Behavioural rules, keyed by address. Only ~11 registers have one. */
export const rulesByAddress: Record<string, any> = (rulesJson as any).rules;

export const registerCount = all.length;
