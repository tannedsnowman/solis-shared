# @solis/shared

Register decoding shared by **SolisConnect** (`serialTauriApp`) and the
**Soliscloud Engineering Debugger** (`SolisDebuggerToolExtension`).

Three repos, on purpose — one `git pull` each, no monorepo.

---

## ⚡ Working on shared code? Run this first

Open a terminal, leave it running all session:

```powershell
cd C:\Users\Tanne\Documents\_Active\solis-shared
npm run watch
```

Now editing a file in `src/` rebuilds it automatically and both apps pick it
up on their next hot reload — same feel as editing app code. **Without this,
your change does not reach either app.**

### Why a build step exists at all

The apps do not read `src/*.ts`. They read `dist/*.js`, which `tsc` produces.
`npm install file:../solis-shared` makes each app's `node_modules/@solis/shared`
a link back to this folder, so there is exactly ONE copy of the decoder and both
apps follow the link to the same `dist/`.

`dist/` is gitignored, so it does not exist in a fresh clone. **After cloning or
pulling, run `npm run build` once** before the apps can import anything.

### Just pulled on the other machine?

```powershell
cd C:\Users\Tanne\Documents\_Active\solis-shared
npm install
npm run build
```

`npm install` here only fetches `typescript` and `vitest` — the tools that
compile and test this folder. Nothing from here ships into the apps' bundles
except the compiled decoder itself.

### Forgot to rebuild?

The symptom is an app behaving as though your edit never happened, because for
it, the edit never did — it is still reading the last `dist/` you built. If an
app cannot resolve `@solis/shared` at all, `dist/` is missing entirely: run
`npm run build`.

---

## Why

Before this package the two apps carried:

- **7** implementations of `decimalsForScale`
- **5** implementations of sign extension
- **2** full decoders, agreeing on the common cases and disagreeing at the edges

They also carry byte-identical copies of the gospel register maps, synced by
hand from `Solis Vault Ingest`. The maps were already shared in practice; the
*decoding* was not, and that is where the drift bugs came from.

Two divergences are settled here, both documented at the code:

| | SolisConnect | extension | settled |
|---|---|---|---|
| `decimalsForScale` | `Math.ceil` | `Math.round` | **`ceil`** — `round` discards a digit the device reported |
| sign extension | `Int16Array`/`Int32Array` | arithmetic | **arithmetic** — same answers, allocates nothing |

## Linking an app (once per machine, per app)

```powershell
cd C:\Users\Tanne\Documents\_Active\SolisDebuggerToolExtension
npm install file:../solis-shared
```

```powershell
cd C:\Users\Tanne\Documents\_Active\serialTauriApp
npm install file:../solis-shared
```

The `file:../solis-shared` path is relative, so all three folders must sit side
by side in `_Active`. Move one and the link breaks.

## Use

```ts
import { decodeWords, fromGospel } from '@solis/shared';
import { byAddress } from './mapper/gospel';

const spec = fromGospel(byAddress.get(33139) ?? null);
const soc = decodeWords(spec, [rawWord]);
soc.text; // "87.0"
```

`fromGospel` is the seam: it answers *which map am I on* once, rather than at
every call site. `fromDescription` does the same for SolisConnect's legacy
hand-maps, so that side can adopt the decoder before finishing its migration
to the gospel.

Prefer `decodeWords` over `decodeRaw` wherever the words are available — only
`decodeWords` can apply word order. A value the caller already joined has
committed to an endianness, right or wrong.

## Rules

Verified end to end against both toolchains: Vite 6 / Vitest 2 on one side,
webpack 5 / Jest via craco on the other, both on TypeScript 5.9.3.

- **No platform imports.** No `chrome.*`, `@tauri-apps`, `window`, `document`,
  `fs`. The `tsconfig` omits the `dom` lib so this is a compile error, not a
  runtime surprise in whichever app imported it second.
- **No Vite-only syntax.** No `?raw` imports, no `import.meta.glob`. Webpack
  cannot resolve them. `import.meta.url` is fine in Vitest but not in Jest —
  keep it out of `src/`.
- **Pure functions only.** No React, no stores, no I/O. Widgets and transport
  stay in the apps.

## Layout

```
src/decode/
  primitives.ts   sign, scale, decimals, word join/split — the arithmetic
  types.ts        RegisterSpec (what a decode reads) and Decoded (what it returns)
  decode.ts       the rule order: join, sentinel, sign, enum, bits, scale
  fromGospel.ts   adapters from each app's map record to a RegisterSpec
```

## Test

```powershell
npm test
```
