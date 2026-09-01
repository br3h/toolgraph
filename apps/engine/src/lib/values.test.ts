import { describe, expect, it } from 'vitest';

import { getAtPointer, pointerTokens, setAtPointer } from './values';

describe('pointerTokens', () => {
  it('decodes escapes in the order RFC 6901 requires', () => {
    expect(pointerTokens('')).toEqual([]);
    expect(pointerTokens('/a/b')).toEqual(['a', 'b']);
    expect(pointerTokens('/a~1b')).toEqual(['a/b']);
    expect(pointerTokens('/a~0b')).toEqual(['a~b']);
    expect(pointerTokens('/a~01b')).toEqual(['a~1b']);
  });
});

describe('getAtPointer', () => {
  const value = { user: { id: 7, tags: ['a', 'b'] }, empty: null };

  it('returns the whole value for the empty pointer', () => {
    expect(getAtPointer(value, '')).toBe(value);
  });

  it('reads nested properties and array indices', () => {
    expect(getAtPointer(value, '/user/id')).toBe(7);
    expect(getAtPointer(value, '/user/tags/1')).toBe('b');
  });

  it('returns undefined rather than throwing on a missing path', () => {
    expect(getAtPointer(value, '/user/missing')).toBeUndefined();
    expect(getAtPointer(value, '/empty/deep')).toBeUndefined();
    expect(getAtPointer(value, '/user/tags/9')).toBeUndefined();
    expect(getAtPointer(undefined, '/a')).toBeUndefined();
  });

  it('refuses to read through the prototype chain', () => {
    expect(getAtPointer({}, '/__proto__')).toBeUndefined();
    expect(getAtPointer({}, '/constructor')).toBeUndefined();
    expect(getAtPointer({ a: 1 }, '/toString')).toBeUndefined();
  });
});

describe('setAtPointer', () => {
  it('replaces the root for the empty pointer', () => {
    expect(setAtPointer({ a: 1 }, '', 'replaced')).toBe('replaced');
  });

  it('writes a top-level key', () => {
    expect(setAtPointer({}, '/a', 1)).toEqual({ a: 1 });
  });

  it('creates intermediate objects', () => {
    expect(setAtPointer({}, '/a/b/c', 'deep')).toEqual({ a: { b: { c: 'deep' } } });
  });

  it('preserves siblings and does not mutate the input', () => {
    const original = { keep: 1, nested: { keep: 2 } };
    const next = setAtPointer(original, '/nested/added', 3);

    expect(next).toEqual({ keep: 1, nested: { keep: 2, added: 3 } });
    expect(original).toEqual({ keep: 1, nested: { keep: 2 } });
  });

  it('refuses to write through a prototype-polluting path', () => {
    expect(() => setAtPointer({}, '/__proto__/polluted', true)).toThrow(/unsafe/i);
    expect(() => setAtPointer({}, '/a/constructor/x', true)).toThrow(/unsafe/i);
    expect(() => setAtPointer({}, '/prototype', true)).toThrow(/unsafe/i);

    // The attack this prevents: nothing may leak onto Object.prototype.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
