import { describe, expect, it } from 'vitest';
import { planWrite, widthForKind, wantsCurrentValue } from '../planWrite';
import { packAll, packField } from '../packedFields';

const RMW = 'read_modify_write';
const W16 = { width: 16 as const, wordOrder: 'be' as const };
const W32 = { width: 32 as const, wordOrder: 'be' as const };

describe('the safety rule: read_modify_write never guesses', () => {
  /*
   * Writing a bare value to 43110 clears battery wake-up and grid charging
   * along with it, and nothing in the Modbus reply says so. Both halves of the
   * rule are load-bearing: without the MASK we do not know which bits are
   * ours, and without the CURRENT WORD we cannot preserve the rest.
   */
  it('refuses when the owned mask is missing', () => {
    const p = planWrite({ address: 43110, value: 0x0004, rule: RMW, ...W16, currentValue: 0x0021 });
    expect(p.kind).toBe('refuse');
    if (p.kind === 'refuse') expect(p.code).toBe('needs-mask');
  });

  it('asks for a read rather than assuming zero', () => {
    const p = planWrite({ address: 43110, value: 0x0004, rule: RMW, ...W16, ownedMask: 0x0004 });
    expect(p.kind).toBe('refuse');
    if (p.kind === 'refuse') expect(p.code).toBe('needs-read');
    // The hook answers THIS refusal by reading; every other one is final.
    expect(wantsCurrentValue(p)).toBe(true);
  });

  it('keeps the bits it does not own', () => {
    const p = planWrite({
      address: 43110, value: 0x0004, rule: RMW, ...W16,
      ownedMask: 0x0004, currentValue: 0x0021,
    });
    expect(p.kind).toBe('write');
    if (p.kind === 'write') {
      expect(p.merged).toBe(0x0025); // 0x0021 kept, bit 2 added
      expect(p.fn).toBe(6);
    }
  });

  it('clearing an owned bit leaves the others standing', () => {
    const p = planWrite({
      address: 43110, value: 0x0000, rule: RMW, ...W16,
      ownedMask: 0x0004, currentValue: 0x0025,
    });
    if (p.kind === 'write') expect(p.merged).toBe(0x0021);
  });

  it('a mask of zero is a real answer, not a missing one', () => {
    const p = planWrite({
      address: 43110, value: 0xffff, rule: RMW, ...W16,
      ownedMask: 0, currentValue: 0x0021,
    });
    expect(p.kind).toBe('write');
    if (p.kind === 'write') expect(p.merged).toBe(0x0021);
  });

  it('a currentValue of zero is a real answer too', () => {
    const p = planWrite({
      address: 43110, value: 0x0004, rule: RMW, ...W16,
      ownedMask: 0x0004, currentValue: 0,
    });
    expect(p.kind).toBe('write');
  });
});

describe('width decides the function code', () => {
  it('sends a 32-bit register as function 16, high word first', () => {
    const p = planWrite({ address: 44227, value: 100000, rule: 'none', ...W32 });
    expect(p.kind).toBe('write');
    if (p.kind === 'write') {
      expect(p.fn).toBe(16);
      expect(p.words).toEqual([0x0001, 0x86a0]);
    }
  });

  it('honours little-endian word order rather than assuming', () => {
    const p = planWrite({ address: 44227, value: 100000, rule: 'none', width: 32, wordOrder: 'le' });
    if (p.kind === 'write') expect(p.words).toEqual([0x86a0, 0x0001]);
  });

  it('sends a 16-bit register as function 6', () => {
    const p = planWrite({ address: 43000, value: 5, rule: 'none', ...W16 });
    if (p.kind === 'write') { expect(p.fn).toBe(6); expect(p.words).toEqual([5]); }
  });

  it('refuses a wide read-modify-write rather than sending half a merge', () => {
    const p = planWrite({ address: 44227, value: 1, rule: RMW, ...W32, ownedMask: 1, currentValue: 0 });
    if (p.kind === 'refuse') expect(p.code).toBe('wide-rmw-unsupported');
  });

  it('width only ever forces UP', () => {
    expect(widthForKind('u16', 32)).toBe(32);
    expect(widthForKind('s32')).toBe(32);
    expect(widthForKind(null)).toBe(16);
  });
});

describe('read-only', () => {
  it('refuses before anything else', () => {
    const p = planWrite({ address: 33000, value: 1, rule: 'read_only', ...W16 });
    if (p.kind === 'refuse') expect(p.code).toBe('read-only');
  });
});

describe('packAll leaves absent values alone', () => {
  /*
   * Caught by noUncheckedIndexedAccess during the rebuild. `values[i]` on a
   * short array is undefined, and `undefined << shift` is 0 — so the old code
   * silently CLEARED a field the caller never passed.
   */
  it('does not clear a field the caller did not supply', () => {
    const fields = [
      { key: 'lo', mask: 0x00ff, shift: 0, label: 'low' },
      { key: 'hi', mask: 0xff00, shift: 8, label: 'high' },
    ];
    expect(packAll(0xabcd, fields as never, [0x12])).toBe(0xab12);
  });

  it('still packs every field when all are supplied', () => {
    const fields = [
      { key: 'lo', mask: 0x00ff, shift: 0, label: 'low' },
      { key: 'hi', mask: 0xff00, shift: 8, label: 'high' },
    ];
    expect(packAll(0x0000, fields as never, [0x12, 0x34])).toBe(0x3412);
  });

  it('packField itself is unchanged', () => {
    expect(packField(0xabcd, { key: 'lo', mask: 0x00ff, shift: 0 } as never, 0x12)).toBe(0xab12);
  });
});
