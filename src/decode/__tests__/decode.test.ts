import { describe, expect, it } from 'vitest';
import { decodeRaw, decodeWords } from '../decode';
import { fromGospel } from '../fromGospel';
import type { RegisterSpec } from '../types';

const u16 = (over: Partial<RegisterSpec> = {}): RegisterSpec => ({
  kind: 'u16',
  ...over,
});

describe('numeric decode', () => {
  it('scales and formats to the resolution the scale implies', () => {
    const d = decodeWords(u16({ scale: 0.1, units: 'V' }), [2401]);
    expect(d.value).toBeCloseTo(240.1);
    expect(d.text).toBe('240.1');
    expect(d.units).toBe('V');
    expect(d.missing).toBe(false);
  });

  it('renders an undescribed register as its raw number', () => {
    // An address the map does not cover is still real information.
    const d = decodeWords({ kind: null }, [1234]);
    expect(d.value).toBe(1234);
    expect(d.text).toBe('1234');
    expect(d.missing).toBe(false);
  });

  it('signs an s16 before scaling', () => {
    const d = decodeWords({ kind: 's16', scale: 0.1, units: '°C' }, [0xfffb]);
    expect(d.value).toBeCloseTo(-0.5);
  });

  it('treats a zero scale as absent rather than zeroing the reading', () => {
    const d = decodeWords(u16({ scale: 0 }), [50]);
    expect(d.value).toBe(50);
  });
});

describe('missing readings', () => {
  it('is missing when the word was never read', () => {
    expect(decodeWords(u16(), [null]).missing).toBe(true);
    expect(decodeWords(u16(), [undefined]).missing).toBe(true);
    expect(decodeWords(u16(), []).missing).toBe(true);
  });

  it('is missing when a wide register has only its low word', () => {
    // Reporting the low word alone is how a value ends up wrong by 65536.
    const d = decodeWords({ kind: 's32', scale: 1 }, [0x0001]);
    expect(d.missing).toBe(true);
    expect(d.value).toBeNull();
  });

  it('renders missing as the dash, not as zero', () => {
    const d = decodeWords(u16({ scale: 0.1 }), [null]);
    expect(d.text).toBe('--');
    expect(d.value).toBeNull();
  });
});

describe('the sentinel, which must beat scale', () => {
  /*
   * The bug this codebase shipped twice. A generator port with no generator
   * reports 0x80000000. Scaled, that reads as a plausible -2.1 GW, or as
   * "4294937 kW" when the register was mistyped u32.
   */
  it('suppresses the s32 no-reading word', () => {
    const d = decodeWords({ kind: 's32', scale: 0.001, units: 'kW' }, [
      0x8000, 0x0000,
    ]);
    expect(d.missing).toBe(true);
    expect(d.text).toBe('--');
    expect(d.value).toBeNull();
  });

  it('still reads an ordinary negative s32', () => {
    // The sentinel gate must not swallow real negative power.
    const d = decodeWords({ kind: 's32', scale: 1, units: 'W' }, [
      0xffff, 0xf448,
    ]);
    expect(d.value).toBe(-3000);
    expect(d.missing).toBe(false);
  });

  it('honours a per-register sentinel override', () => {
    const d = decodeWords(u16({ scale: 1, noReading: 0xffff }), [0xffff]);
    expect(d.missing).toBe(true);
  });
});

describe('enum beats bits beats numeric', () => {
  it('takes a value_map hit on the RAW value', () => {
    // A status word of 3 is state 3, not state 0.3.
    const d = decodeWords(
      u16({ scale: 0.1, valueMap: { '3': 'Generating' } }),
      [3],
    );
    expect(d.text).toBe('Generating');
    expect(d.label).toBe('Generating');
  });

  it('falls through to the number on an undocumented enum code', () => {
    // Never "Unknown (7)" — a code the map has not caught up with is still
    // information a field engineer can look up.
    const d = decodeWords(u16({ valueMap: { '3': 'Generating' } }), [7]);
    expect(d.text).toBe('7');
    expect(d.label).toBeNull();
  });

  it('lists the set bits of a bitfield', () => {
    const d = decodeWords(
      u16({ bitFlags: ['Over Voltage', 'Under Voltage', 'Over Temp'] }),
      [0b101],
    );
    expect(d.bits).toEqual(['Over Voltage', 'Over Temp']);
    expect(d.text).toBe('Over Voltage, Over Temp');
  });

  it('says None when a bitfield is clear', () => {
    const d = decodeWords(u16({ bitFlags: ['Over Voltage'] }), [0]);
    expect(d.bits).toEqual([]);
    expect(d.text).toBe('None');
  });

  it('skips Reserved padding, which is not a condition', () => {
    const d = decodeWords(
      u16({ bitFlags: ['Over Voltage', 'Reserved', 'Reserve'] }),
      [0b111],
    );
    expect(d.bits).toEqual(['Over Voltage']);
  });
});

describe('word order', () => {
  it('reads a big-endian wide register', () => {
    const d = decodeWords({ kind: 'u32', scale: 1, wordOrder: 'be' }, [
      0x0001, 0x86a0,
    ]);
    expect(d.value).toBe(100000);
  });

  it('reads a little-endian wide register (EPM / EPM-AX)', () => {
    const d = decodeWords({ kind: 'u32', scale: 1, wordOrder: 'le' }, [
      0x86a0, 0x0001,
    ]);
    expect(d.value).toBe(100000);
  });

  it('defaults to big-endian when the spec does not say', () => {
    const d = decodeWords({ kind: 'u32', scale: 1 }, [0x0001, 0x86a0]);
    expect(d.value).toBe(100000);
  });
});

describe('decodeRaw, for stores that hand back a joined value', () => {
  it('agrees with decodeWords on the same register', () => {
    const spec: RegisterSpec = { kind: 's32', scale: 1 };
    const joined = decodeWords(spec, [0xffff, 0xf448]);
    const raw = decodeRaw(spec, 0xfffff448 | 0);
    expect(raw.value).toBe(joined.value);
  });
});

describe('fromGospel adapter', () => {
  it('maps the gospel record onto a spec', () => {
    const spec = fromGospel({
      kind: 's16',
      scale: 0.1,
      units: '°C',
      word_order: 'be',
      value_map: null,
      bit_flags: null,
    });
    expect(spec.kind).toBe('s16');
    expect(spec.scale).toBe(0.1);
    expect(spec.units).toBe('°C');
  });

  it('turns an unknown address into an undescribed spec, not a crash', () => {
    const spec = fromGospel(null);
    expect(spec.kind).toBeNull();
    expect(decodeRaw(spec, 42).text).toBe('42');
  });
});
