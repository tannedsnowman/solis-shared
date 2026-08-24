# The plan: one gospel, one decoder, one settings model

Three repos, side by side in `_Active`. `@solis/shared` holds what both apps
must agree on. The apps hold what makes them different.

```
_Active/
  solis-shared/                <- the shared truth
  SolisDebuggerToolExtension/  <- Chrome MV3, scrape + signed API
  serialTauriApp/              <- SolisConnect, serial + cloud
```

## Status: all four phases COMPLETE (2026-08-24)

| # | Phase | Outcome |
|---|---|---|
| 1 | Gospel into shared | done — 9 maps, 7 loaders, one sync script |
| 2 | One decoder | done — **fixed the scrape-path decode bug** |
| 3 | Shared settings model | done — `planWrite` is the seam |
| 4 | Retire the hand-maps | done — **11 Hybrid + 10 PV indices corrected** |

---

## What lives where

| Layer | Where | Why |
|---|---|---|
| Register maps (`generated/*.json`) | **shared** | were byte-identical in both repos |
| Gospel loaders | **shared** | 6 of 7 were byte-identical |
| Decode arithmetic | **shared** | the drift bugs all lived here |
| Settings model | **shared** | the rules are data; both apps read the same data |
| Settings widgets (JSX, stores) | **each app** | ~600px popup vs a desktop window |
| Transport (scrape, API, serial, cloud) | **each app** | this is the actual difference |

The rule that keeps this honest: **no `dom` lib in this tsconfig.** Touching
`window`, `document`, `chrome.*` or `@tauri-apps` is a compile error.

---

## Bugs this found and fixed

**The scrape path decoded differently from the API path** (phase 2).
`decodeModbusReply` hand-rolled a second copy of the band table and passed
`kinds` for PV only, `wordOrder` never. Every signed hybrid register decoded
unsigned — a battery discharging at -500 W read as 4294966796 — and every
32-bit EPM register was wrong by a factor of 65536. Both paths now route
through `bandFor`, and `kinds`/`wordOrder` are REQUIRED so a new band cannot
omit them.

**Making them required exposed a second bug**: the hybrid SETTINGS band had
silently declared no `kinds` at all, so every signed hybrid setting decoded
unsigned too. Invisible because the field was optional.

**The built-in meter read four of six values off the wrong register** (phase 4).
The hand-map listed V-A, V-B, V-C then I-A, I-B, I-C; the device interleaves
them. `builtInMeterACVoltageB` was reading a CURRENT and scaling it as volts —
~120 V on a 240 V phase.

**The PV MPPT current block was shifted one register low** along its whole
length (phase 4). `mppt7Current` was reading MPPT 6; ten currents each reported
under the next MPPT's name.

**`packAll` silently cleared fields** the caller never passed, because
`undefined << shift` is 0. Caught by `noUncheckedIndexedAccess` during the
rebuild.

---

## The one thing that wastes a day

This package compiles to `dist/`. The apps read `dist/`, never `src/`.

```powershell
cd C:\Users\Tanne\Documents\_Active\solis-shared
npm run watch
```

Without it, an edit does not reach either app and the app behaves exactly as
though you never made the change.

`tsc --watch` does NOT re-fire on a JSON change. Re-syncing maps from the vault
needs a full `npm run build`.

---

## Verifying a change

```powershell
cd C:\Users\Tanne\Documents\_Active\solis-shared
npm run build; npm test

cd C:\Users\Tanne\Documents\_Active\SolisDebuggerToolExtension
npx tsc --noEmit; npm test; npm run build

cd C:\Users\Tanne\Documents\_Active\serialTauriApp
node node_modules/typescript/bin/tsc --noEmit; npm test; npm run build
```

**`npx tsc` in serialTauriApp is a decoy** that prints "This is not the tsc
command you are looking for", exits non-zero and typechecks nothing. Use the
explicit path there.

**Known flake:** the extension's `corpus.test.ts` asserts a scan finishes inside
1000 ms and measures 1011-1512 ms under load. It fails on `main` too. Only that
failing is green.

---

## Hard-won lessons

**A new subpath export needs THREE edits.** Vite and webpack 5 honour
`exports`; CRA's `moduleResolution: "node"` and `jest-resolve` do not. Add it to
`exports`, `typesVersions`, AND the extension's craco `moduleNameMapper`. Phase
1 lost time to this at 81 broken suites.

**`noUncheckedIndexedAccess` is ON here, OFF in both apps.** Code moving in
sprouts indexed-access errors. Prefer a real guard; use a narrow `!` with a
comment when the index provably cannot miss. It has already caught one real bug.

**The gospel barrel is NAMESPACED, not flat.** Every family exports `byKey`,
`byAddress`, `ruleFor`, `registerCount`, each meaning something different. A
flat barrel would silently resolve to whichever family was re-exported last.

**Optional fields hide omissions.** This is the bug class behind most of the
above. Prefer required fields with an explicit empty value — "I forgot" should
not typecheck.

**Never `Remove-Item -Recurse -Force` a junction.** It follows the link and
deletes the target. This destroyed the repo once, `.git` included; only the
GitHub remote and a scratchpad backup saved it. **Push after every phase.**

---

## What we are NOT doing

- **No monorepo.** Three `git pull`s is the accepted cost.
- **No shared React components.** Same data, different widgets, on purpose.
- **No react-scripts upgrade.** CRA 5.0.1 is its last release, so "upgrading"
  means a Vite migration, and `craco.config.js` carries the multi-entry MV3
  build, `runtimeChunk: false`, the buffer alias and a Windows Jest `testRegex`
  fix. Its own project.
- **No npm publish.** `file:../solis-shared` linking only.
- **The hand-maps STAY.** Phase 4 established this: the key namespace is
  load-bearing (one widget names 258 keys as string literals) and the maps carry
  fields the gospel lacks (`invalidSentinel`, `unwrapAgainst`). Only indices
  move; the gospel owns the address, enforced by a conformance test per family.
