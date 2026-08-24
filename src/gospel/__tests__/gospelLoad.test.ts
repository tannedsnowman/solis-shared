/**
 * Proves the loaders actually READ the synced maps.
 *
 * `gospelSync.test.ts` proves this app's copy matches the gospel. It does not
 * prove the copy is usable: a file can match perfectly and still fail to
 * parse into the lookups, because the loaders were ported from the extension
 * and any drift in the map's SHAPE breaks them silently. So this test does
 * the one thing the hash cannot — it builds the indexes and reads real
 * registers out of them.
 *
 * The registers pinned below are chosen because each one has burned somebody:
 * they are the traps the tier exists to make safe.
 */
import { describe, it, expect } from 'vitest';
import * as hybrid from '../gospel';
import * as pv from '../pvGospel';
import * as epm from '../epmGospel';
import { faults, faultAtBit, solutionForLabel } from '../faultGospel';

describe('hybrid gospel', () => {
  it('loads every register', () => {
    expect(hybrid.registerCount).toBeGreaterThan(1900);
  });

  it('reads the registers the audit pinned', () => {
    // The built-in meter block alternates V/I — it does not list all three
    // voltages then all three currents.
    expect(hybrid.byAddress.get(34292)?.key).toBe('builtInMeterACVoltageA');
    expect(hybrid.byAddress.get(34293)?.key).toBe('builtInMeterACCurrentA');
    // Every PV string current is SIGNED. Reverse current is negative.
    expect(hybrid.byAddress.get(33344)?.kind).toBe('s16');
    expect(hybrid.byAddress.get(33344)?.scale).toBe(0.1);
  });

  it('separates a key that exists at more than one scope', () => {
    // Keys are not unique: the same measurement is reported at module scope
    // and system scope. `byQualifiedKey` is what pins which one you meant.
    expect(hybrid.ambiguousKeys.size).toBeGreaterThan(0);
    expect(hybrid.byQualifiedKey.size).toBe(hybrid.registerCount);
  });
});

describe('pv gospel', () => {
  it('keeps data and settings apart at a colliding address', () => {
    // THE PV TRAP: both spaces start at 3000 and overlap. 3042 is a different
    // register — and a different SIGN — depending on the function code. An
    // address alone never identifies a PV register.
    const data = pv.byAddress.get(3042);
    const setting = pv.settingsByAddress.get(3042);
    expect(data?.key).toBe('inverterTemperature');
    expect(data?.kind).toBe('s16');
    expect(setting?.key).not.toBe(data?.key);
  });
});

describe('epm gospel', () => {
  it('loads both devices', () => {
    expect(epm.registerCount('epm')).toBeGreaterThan(50);
    expect(epm.registerCount('ax')).toBeGreaterThan(50);
  });
});

describe('fault gospel', () => {
  it('loads the whole catalogue', () => {
    expect(faults.length).toBe(653);
  });

  it('decodes a hybrid fault bit', () => {
    expect(faultAtBit(33116, 0)?.label).toBe('No Grid');
  });

  it('still reaches the field-written solutions', () => {
    // These 47 were written from field experience and exist in no document.
    // A null here means they were lost in the port.
    expect(solutionForLabel('No Grid')).toBeTruthy();
  });
});

/**
 * SETTINGS ARE HALF THE TIER — and each family reaches them differently.
 *
 * A map that loaded only the read space would look completely healthy in
 * every other test here: the counts pass, the lookups resolve, the faults
 * decode. The gap would only show up the day someone tried to write a
 * setting. So the settings space gets its own explicit check per family.
 *
 * The three shapes are not an inconsistency, they follow the address maths:
 *   hybrid — data 33000+, settings 43000+. Numerically distinct, so ONE flat
 *            `byAddress` is unambiguous and `scopeOf` names the space.
 *   pv     — both spaces start at 3000 and OVERLAP, so a flat map would
 *            silently serve the wrong register. Settings need their own map.
 *   epm/ax — one module serves two devices, so scope AND device are needed.
 */
describe('settings spaces', () => {
  it('hybrid settings are loaded and scoped', () => {
    const reg = hybrid.byAddress.get(43110);
    expect(reg?.key).toBe('storageControlSwitchValue');
    expect(reg && hybrid.scopeOf(reg)).toBe('settings');

    const settings = [...hybrid.byAddress.values()]
      .filter((r) => hybrid.scopeOf(r) === 'settings');
    expect(settings.length).toBeGreaterThan(900);
  });

  it('pv settings are a SEPARATE map, because the spaces overlap', () => {
    expect(pv.settingsByAddress.size).toBeGreaterThan(300);
    // Same number, different register in each space — the PV trap.
    expect(pv.settingsByAddress.get(3042)?.key)
      .not.toBe(pv.byAddress.get(3042)?.key);
  });

  it('epm and ax both carry their settings', () => {
    expect(epm.registersInScope('epm', 'settings').length).toBeGreaterThan(15);
    expect(epm.registersInScope('ax', 'settings').length).toBeGreaterThan(25);
  });
});
