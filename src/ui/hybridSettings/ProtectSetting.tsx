/**
 * Protect Setting — SolisCloud's Protect Setting page, with the bits the right
 * way round.
 *
 * WHAT WAS WRONG WITH THE ORIGINAL
 * --------------------------------
 * SolisCloud lists eleven rows, seven of which say "43249", each with its own
 * Read button and a Batch Read at the bottom. Every one of those seven is a
 * BIT of the same single register, so the whole block is one Modbus read — the
 * per-row Read buttons re-read the same word seven times, and the page still
 * shows the RAW BIT, labelled Enable/Disable against the bit value.
 *
 * That last part is the trap. Five of the eight bits are ACTIVE-LOW: the bit
 * SET means the protection is DISABLED. So SolisCloud showing "Enable" against
 * Relay-Fault Func can mean the relay protection is off.
 *
 * WHAT THIS SCREEN DOES INSTEAD
 * -----------------------------
 * - One register, one read. The eight switches all come from 43249, so filling
 *   this screen costs a single word off the wire rather than seven reads of
 *   the same address. Nothing here has a Read button; the ALL sweep on the
 *   range row above already covers it.
 * - Shows the PROTECTION, not the bit. "On" always means protected. The raw
 *   word is printed beside every row so it can still be checked against a
 *   capture or against SolisCloud.
 * - Every inverted row carries a `?` explaining why the two screens will look
 *   like they disagree.
 * - Protections first, as a block, because they share the active-low rule.
 *   The three ordinary switches in the same word are drawn below, separately,
 *   so nobody generalises the inversion to them.
 *
 * AFCI IS NOT IN 43249
 * --------------------
 * SolisCloud lists "AFCI Protect" and "AFCI level" against 43249. The gospel
 * has no AFCI bits there: the master switch is 43076 and the per-string
 * enables are 43624. Those are the registers this screen writes.
 *
 * The register maths — which bit, which direction — lives in
 * `protectSettingModel.ts` and is proven in its test. This file draws it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { at } from '../pv/captures'
import type { HybridWriter } from '../settings/hybridWrite'
import { currentText, rawOf } from '../settings/GospelRows'
import {
  displayToRaw,
  rawToDisplay,
} from '../../settings/editorFor'
import { addressesOf } from '../settings/panelAddresses'
import {
  GroupStatus,
  GroupPane,
  RowOption,
  SaveResult,
  SettingRowOne,
} from '../settings/GroupView'
import { ruleFor } from '../settings/GospelRows'
import { byAddress } from '../../gospel/gospel'
import { C } from '../settings/theme'
import {
  ACTIVE_LOW_HELP,
  AFCI_DETECTION,
  AFCI_HELP,
  AFCI_ONOFF,
  FUNCTION_SWITCHES,
  ILEAK_LIM,
  LEVEL_ROWS,
  changedMask,
  PROTECTION_SWITCHES,
  ProtectSwitch,
  RISO_LIM,
  SPECIAL_SETTINGS,
  ownedMaskOf,
  protectionOn,
  wordForProtection,
} from './protectSettingModel'

interface ProtectSettingProps {
  variables: any
  id: string
  /**
   * Where writes go.
   *
   * REQUIRED HERE, unlike in the extension's own copy. A shared card has no
   * app to fall back to: the extension hands in `useRegisterWrite`, its
   * transport, and SolisConnect hands in its own over the Tauri serial
   * bridge. This file must not know which it got.
   */
  writer: HybridWriter
}

const hex = (n: number) =>
  `0x${(n & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`

/** BIT07 rather than BIT7 — matches how the documents and SolisCloud print it. */
const bitRef = (address: number, bit: number) =>
  `${address} BIT${String(bit).padStart(2, '0')}`

/**
 * Registers this page reads, for the range-button row's highlight.
 * Derived from the rows it renders, so it cannot drift out of step.
 */
export const ADDRESSES = addressesOf(
  [
    [
      {
        title: 'protect setting',
        rows: LEVEL_ROWS.map((r) => ({ address: r.address })),
      },
    ],
  ],
  [SPECIAL_SETTINGS, AFCI_ONOFF, AFCI_DETECTION],
)

/** Age of a reading in ms, or undefined when it was never read. */
function ageOf(variables: any, key: string | undefined, now: number) {
  const stamp = key ? variables?.[key]?.lastUpdated : undefined
  if (!stamp) return undefined
  const t = new Date(stamp).getTime()
  return Number.isFinite(t) ? Math.max(0, now - t) : undefined
}

/** The ten PV strings 43624 carries an enable bit for. */
const AFCI_STRINGS = 10

const ProtectSetting: React.FC<ProtectSettingProps> = ({ variables, id, writer }) => {
  const { write, lastError } = writer
  const now = Date.now()

  const specialReg = byAddress.get(SPECIAL_SETTINGS)
  const readSpecial = rawOf(variables, specialReg?.key ?? '')
  const specialRead = readSpecial !== undefined

  const afciReg = byAddress.get(AFCI_ONOFF)
  const readAfci = rawOf(variables, afciReg?.key ?? '')
  const afciRead = readAfci !== undefined

  const detectReg = byAddress.get(AFCI_DETECTION)
  const readDetect = rawOf(variables, detectReg?.key ?? '')
  const detectRead = readDetect !== undefined

  /*
   * Staged as WHOLE WORDS, like Storage Mode: the bit maths is expressed as a
   * word transform, so holding a word is the representation that already
   * matches. `undefined` means "no staged change", which is what keeps an
   * unread register from being written as 0.
   */
  const [stagedSpecial, setStagedSpecial] = useState<number | undefined>()
  const [stagedDetect, setStagedDetect] = useState<number | undefined>()
  const [stagedAfci, setStagedAfci] = useState<number | undefined>()
  const [numberEdits, setNumberEdits] = useState<Record<number, number>>({})

  // A fresh reading drops staged edits: what is on screen must be what the
  // device just said, not an edit made against the previous word.
  useEffect(() => {
    setStagedSpecial(undefined)
    setStagedDetect(undefined)
    setStagedAfci(undefined)
    setNumberEdits({})
  }, [variables])

  const specialWord = stagedSpecial ?? readSpecial
  const detectWord = stagedDetect ?? readDetect
  const specialDirty =
    stagedSpecial !== undefined && stagedSpecial !== readSpecial
  const detectDirty = stagedDetect !== undefined && stagedDetect !== readDetect

  const specialRule = ruleFor(SPECIAL_SETTINGS)

  /**
   * Write one staged bit word, masked so bits outside the rule survive.
   *
   * Refuses outright when the register has not been read. The Save button is
   * already disabled in that case; this makes the rule hold even if something
   * else ever reaches the handler.
   *
   * `currentValue` is deliberately NOT passed. On this screen every toggle
   * writes immediately, and 43249 holds eight unrelated protections — so the
   * hook re-reads the register right before merging, and a word that went
   * stale while the tab sat open cannot silently revert a switch somebody else
   * changed. One extra read per write is a cheap price for that.
   */
  const saveBitWord = useCallback(
    async (
      address: number,
      staged: number | undefined,
      read: number | undefined,
    ): Promise<SaveResult> => {
      if (read === undefined) {
        return { ok: false, error: 'Not read — read the group first' }
      }
      const reg = byAddress.get(address)
      /*
       * A mask is only meaningful where the rules file describes the bits.
       * 43249 is a rule-file bitfield, so the write is masked to the eight
       * switches it names and anything a newer firmware added survives.
       *
       * 43624 has no rule: it is ten string-enable bits, this screen draws
       * every one of them, and `useRegisterWrite` will send it as a plain
       * write. Asking `ownedMaskOf` for it would throw — the model refuses to
       * invent a mask for a register the gospel does not describe, which is
       * the behaviour we want everywhere else.
       */
      const rule = ruleFor(address)
      /*
       * The mask is the bits the user MOVED, not every bit the rule names.
       * See `changedMask` — claiming the whole rule mask would let a stale
       * page revert the seven switches nobody touched, and the pre-write
       * re-read would not stop it. Bounded by the rule's mask so a bit the
       * screen does not own can never be claimed even if the staged word
       * somehow differs there.
       */
      const out = await write({
        address,
        value: staged ?? read,
        ...(rule?.write === 'read_modify_write'
          ? { ownedMask: changedMask(read, staged) & ownedMaskOf(address) }
          : {}),
        variableKey: reg?.key,
        id,
      })
      return { ok: out.ok, error: out.error }
    },
    [write, id],
  )

  const saveSpecial = useCallback(
    () => saveBitWord(SPECIAL_SETTINGS, stagedSpecial, readSpecial),
    [saveBitWord, stagedSpecial, readSpecial],
  )

  /**
   * One switch of 43249, drawn as the PROTECTION rather than as the bit.
   *
   * The `current` text shows the raw word, so the row says both things at
   * once: the toggle says whether you are protected, the hex says what is
   * actually in the register.
   */
  const switchRow = (sw: ProtectSwitch, last = false) => {
    const on = specialWord === undefined ? false : protectionOn(specialWord, sw)
    return (
      <div key={sw.bit} data-testid={`row-${SPECIAL_SETTINGS}-bit${sw.bit}`}>
        <SettingRowOne
          label={sw.label}
          reg={bitRef(SPECIAL_SETTINGS, sw.bit)}
          description={
            sw.inverted
              ? `${sw.description} Stored active-low: this row shows the protection, so On means protected even though the bit reads 0.`
              : sw.description
          }
          current={specialWord === undefined ? undefined : hex(specialWord)}
          hasBeenRead={specialRead}
          ageMs={ageOf(variables, specialReg?.key, now)}
          dirty={specialDirty}
          hint={sw.inverted ? 'Active-low — see the ? for what that means' : specialRule?.summary}
          help={sw.inverted ? ACTIVE_LOW_HELP : undefined}
          helpTitle={sw.inverted ? `${sw.label} — stored backwards` : undefined}
          last={last}
          sendMode="immediate"
          editor={{
            kind: 'toggle',
            on,
            // The model owns the inversion. Never invert here as well.
            onChange: (next) =>
              setStagedSpecial(wordForProtection(specialWord ?? 0, sw, next)),
          }}
          onSave={saveSpecial}
        />
      </div>
    )
  }

  /** One numeric row (the two trip levels), staged and saved on its own. */
  const numberRow = (
    address: number,
    label: string,
    description: string,
    last = false,
  ) => {
    const reg = byAddress.get(address)
    const scale = reg?.scale ?? 1
    const raw = rawOf(variables, reg?.key ?? '')
    const hasBeenRead = raw !== undefined
    const staged = numberEdits[address]
    const shown =
      staged !== undefined
        ? rawToDisplay(staged, scale)
        : raw === undefined
          ? ''
          : rawToDisplay(raw, scale)

    return (
      <div key={address} data-testid={`row-${address}`}>
        <SettingRowOne
          label={label}
          reg={address}
          description={description}
          current={currentText(reg, raw)}
          hasBeenRead={hasBeenRead}
          ageMs={ageOf(variables, reg?.key, now)}
          dirty={staged !== undefined}
          hint={reg?.revision_note ?? description}
          last={last}
          sendMode="immediate"
          editor={{
            kind: 'number',
            value: shown === '' ? '' : Number(shown),
            unit: reg?.units ?? '',
            onChange: (v) =>
              setNumberEdits((e) => ({ ...e, [address]: displayToRaw(v, scale) })),
          }}
          onSave={async () => {
            const value = staged ?? raw
            if (value === undefined) {
              return { ok: false, error: 'Not read — read the group first' }
            }
            const out = await write({
              address,
              value,
              currentValue: raw,
              variableKey: reg?.key,
              id,
            })
            return { ok: out.ok, error: out.error }
          }}
        />
      </div>
    )
  }

  /*
   * The AFCI master switch. A plain enum register, not a bit of 43249 and not
   * inverted — 1 is on, the ordinary way round.
   */
  const afciOptions: RowOption[] = [
    { value: 0, label: 'Disabled' },
    { value: 1, label: 'Enabled' },
  ]
  const afciValue = stagedAfci ?? readAfci

  /*
   * Per-string AFCI detection: BIT00..BIT09 of 43624 are PV1..PV10.
   *
   * Drawn as one row of ten small toggles rather than ten SettingRowOne rows.
   * They are the same switch repeated, they share one register and one Save,
   * and ten full-width rows for one word would push everything else off the
   * screen — the same "one register, one read" argument that shapes the rest
   * of the page.
   */
  const stringOn = (i: number) =>
    detectWord !== undefined && ((detectWord >> i) & 1) === 1

  const toggleString = (i: number) => {
    const word = detectWord ?? 0
    setStagedDetect(
      stringOn(i) ? (word & ~(1 << i)) & 0xffff : (word | (1 << i)) & 0xffff,
    )
  }

  const enabledStrings = useMemo(() => {
    if (detectWord === undefined) return null
    const on: number[] = []
    for (let i = 0; i < AFCI_STRINGS; i++) {
      if ((detectWord >> i) & 1) on.push(i + 1)
    }
    return on
  }, [detectWord])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        width: '100%',
      }}
    >
      <GroupStatus
        lastReadAt={
          specialReg?.key && variables?.[specialReg.key]?.lastUpdated
            ? new Date(variables[specialReg.key].lastUpdated).getTime()
            : null
        }
        /* No read button: ALL on the range-button row above is the one route
           to the wire, and all eight switches are one word anyway. */
        now={now}
      />

      <GroupPane>
        {/* The five active-low protections, together, because they share the
            rule. Anything below this block is NOT inverted. */}
        {PROTECTION_SWITCHES.map((sw) => switchRow(sw))}

        {/* Each trip level sits directly under the switch that arms it, so it
            is obvious the number does nothing while the switch is off. */}
        {numberRow(
          ILEAK_LIM,
          at(LEVEL_ROWS, 0, 'LEVEL_ROWS').label,
          at(LEVEL_ROWS, 0, 'LEVEL_ROWS').description,
        )}
        {numberRow(
          RISO_LIM,
          at(LEVEL_ROWS, 1, 'LEVEL_ROWS').label,
          at(LEVEL_ROWS, 1, 'LEVEL_ROWS').description,
        )}

        {/* The three ordinary switches in the same word. Drawn apart so the
            active-low rule above is not generalised onto them. */}
        {FUNCTION_SWITCHES.map((sw) => switchRow(sw))}

        {/* AFCI. A different register entirely — see AFCI_HELP. */}
        <div data-testid={`row-${AFCI_ONOFF}`}>
          <SettingRowOne
            label="AFCI (arc fault) protection"
            reg={AFCI_ONOFF}
            description={`Master arc-fault switch. Not a bit of ${SPECIAL_SETTINGS}, and not inverted — SolisCloud lists it against ${SPECIAL_SETTINGS}, which the gospel does not support.`}
            current={currentText(afciReg, readAfci)}
            hasBeenRead={afciRead}
            ageMs={ageOf(variables, afciReg?.key, now)}
            dirty={stagedAfci !== undefined && stagedAfci !== readAfci}
            hint={afciReg?.revision_note ?? undefined}
            help={AFCI_HELP}
            helpTitle="AFCI is not in 43249"
            sendMode="immediate"
            editor={{
              kind: 'segmented',
              value: afciValue === undefined ? '' : afciValue,
              options: afciOptions,
              onChange: (v) => setStagedAfci(v),
            }}
            onSave={async () => {
              if (readAfci === undefined) {
                return { ok: false, error: 'Not read — read the group first' }
              }
              const out = await write({
                address: AFCI_ONOFF,
                value: stagedAfci ?? readAfci,
                currentValue: readAfci,
                variableKey: afciReg?.key,
                id,
              })
              return { ok: out.ok, error: out.error }
            }}
          />
        </div>

        {/* Per-string AFCI detection: ten bits of one register, one Save. */}
        <div data-testid={`row-${AFCI_DETECTION}`}>
          <SettingRowOne
            label="AFCI detection per string"
            reg={AFCI_DETECTION}
            description={
              enabledStrings === null
                ? `BIT00–BIT09 are PV1–PV10. Leave a string off if nothing is connected to it, or it will report arc faults on an open input.`
                : enabledStrings.length === 0
                  ? `No strings enabled. BIT00–BIT09 are PV1–PV10.`
                  : `On: PV${enabledStrings.join(', PV')}. Leave a string off if nothing is connected to it.`
            }
            current={detectWord === undefined ? undefined : hex(detectWord)}
            hasBeenRead={detectRead}
            ageMs={ageOf(variables, detectReg?.key, now)}
            dirty={detectDirty}
            help={AFCI_HELP}
            helpTitle="AFCI is not in 43249"
            last
            sendMode="immediate"
            /* The ten string toggles are drawn below rather than in the row's
               own editor slot, which holds one control. The editor is the
               whole-word view; the chips are how you set it. */
            editor={{
              kind: 'toggle',
              on: (detectWord ?? 0) !== 0,
              onChange: (on) => setStagedDetect(on ? 0x03ff : 0x0000),
            }}
            onSave={() =>
              saveBitWord(AFCI_DETECTION, stagedDetect, readDetect)
            }
          />
        </div>

        {/* The per-string chips. Disabled until 43624 has actually been read,
            for the same reason every other row is: a masked write needs a word
            it has really seen. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 3,
            padding: '4px 8px 8px',
          }}
        >
          {Array.from({ length: AFCI_STRINGS }, (_, i) => (
            <button
              key={i}
              type="button"
              disabled={!detectRead}
              onClick={() => toggleString(i)}
              title={`PV${i + 1} — ${AFCI_DETECTION} BIT${String(i).padStart(2, '0')}`}
              style={{
                font: '600 9px/1 Helvetica,Arial',
                padding: '4px 6px',
                cursor: detectRead ? 'pointer' : 'default',
                color: !detectRead ? C.mute : stringOn(i) ? C.white : C.mute3,
                background: stringOn(i) ? C.accent : C.headBg,
                border: `1px solid ${stringOn(i) ? C.accent : C.line}`,
                borderRadius: 2,
              }}
            >
              PV{i + 1}
            </button>
          ))}
        </div>

        {lastError && (
          <div
            style={{
              padding: '5px 8px',
              font: '600 9px/1.4 Helvetica,Arial',
              color: C.red,
            }}
          >
            {lastError}
          </div>
        )}
      </GroupPane>
    </div>
  )
}

export default ProtectSetting
