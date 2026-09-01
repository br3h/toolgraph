import { describe, expect, it } from 'vitest';

import {
  formatPointer,
  mergeAllOf,
  normalizeSchema,
  parsePointer,
  resolvePointer,
  resolveRef,
} from './pointer';
import type { JsonSchema } from './types';

describe('pointer syntax', () => {
  it('round-trips ordinary tokens', () => {
    expect(parsePointer('/a/b/c')).toEqual(['a', 'b', 'c']);
    expect(formatPointer(['a', 'b', 'c'])).toBe('/a/b/c');
  });

  it('treats the empty pointer as the root', () => {
    expect(parsePointer('')).toEqual([]);
    expect(formatPointer([])).toBe('');
  });

  it('decodes ~1 as / and ~0 as ~, in the order RFC 6901 requires', () => {
    expect(parsePointer('/a~1b')).toEqual(['a/b']);
    expect(parsePointer('/a~0b')).toEqual(['a~b']);
    // The ordering trap: ~01 must decode to ~1, not to /.
    expect(parsePointer('/a~01b')).toEqual(['a~1b']);
  });

  it('escapes on the way back out', () => {
    expect(formatPointer(['a/b'])).toBe('/a~1b');
    expect(formatPointer(['a~b'])).toBe('/a~0b');
    expect(parsePointer(formatPointer(['a~1b']))).toEqual(['a~1b']);
  });

  it('accepts a pointer missing its leading slash', () => {
    expect(parsePointer('a/b')).toEqual(['a', 'b']);
  });
});

describe('$ref resolution', () => {
  const root: JsonSchema = {
    $defs: {
      Id: { type: 'string' },
      Chain: { $ref: '#/$defs/Id' },
      Loop: { $ref: '#/$defs/Loop' },
    },
  };

  it('resolves a direct reference', () => {
    expect(resolveRef({ $ref: '#/$defs/Id' }, root)?.type).toBe('string');
  });

  it('follows a chain of references', () => {
    expect(resolveRef({ $ref: '#/$defs/Chain' }, root)?.type).toBe('string');
  });

  it('returns undefined for a self-referential loop instead of hanging', () => {
    expect(resolveRef({ $ref: '#/$defs/Loop' }, root)).toBeUndefined();
  });

  it('returns undefined for a dangling reference', () => {
    expect(resolveRef({ $ref: '#/$defs/Nope' }, root)).toBeUndefined();
  });

  it('refuses external references', () => {
    expect(resolveRef({ $ref: 'https://example.com/schema.json' }, root)).toBeUndefined();
  });

  it('does not let a $ref reach through the prototype chain', () => {
    expect(resolveRef({ $ref: '#/__proto__' }, root)).toBeUndefined();
    expect(resolveRef({ $ref: '#/constructor' }, root)).toBeUndefined();
  });

  it('keeps constraining siblings of a $ref', () => {
    const resolved = resolveRef({ $ref: '#/$defs/Id', minLength: 3 }, root);
    expect(resolved?.type).toBe('string');
    expect(resolved?.minLength).toBe(3);
  });
});

describe('allOf flattening', () => {
  it('unions properties and required lists', () => {
    const merged = mergeAllOf({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    });
    // Key order is not part of the JSON Schema contract; only membership is.
    expect(Object.keys(merged?.properties ?? {}).sort()).toEqual(['a', 'b']);
    expect(merged?.required?.sort()).toEqual(['a', 'b']);
    expect(merged?.allOf).toBeUndefined();
  });

  it('keeps a closed object closed however it was composed', () => {
    const merged = mergeAllOf({
      allOf: [{ type: 'object', additionalProperties: false }, { type: 'object' }],
    });
    expect(merged?.additionalProperties).toBe(false);
  });

  it('leaves a schema without allOf untouched', () => {
    const schema: JsonSchema = { type: 'string' };
    expect(mergeAllOf(schema)).toBe(schema);
  });
});

describe('resolving pointers over schemas', () => {
  const schema: JsonSchema = {
    $defs: { Tag: { type: 'string', minLength: 1 } },
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: { id: { type: 'number' } },
      },
      tags: { type: 'array', items: { $ref: '#/$defs/Tag' } },
      pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'boolean' }] },
      map: { type: 'object', additionalProperties: { type: 'number' } },
    },
  };

  it('returns the root for the empty pointer', () => {
    expect(resolvePointer(schema, '')?.type).toBe('object');
  });

  it('walks named properties', () => {
    expect(resolvePointer(schema, '/user/id')?.type).toBe('number');
  });

  it('walks into array items and resolves their $ref', () => {
    expect(resolvePointer(schema, '/tags/0')?.minLength).toBe(1);
  });

  it('addresses tuple positions individually', () => {
    expect(resolvePointer(schema, '/pair/0')?.type).toBe('string');
    expect(resolvePointer(schema, '/pair/1')?.type).toBe('boolean');
  });

  it('addresses map values through additionalProperties', () => {
    expect(resolvePointer(schema, '/map/anything')?.type).toBe('number');
  });

  it('returns undefined for a pointer that addresses nothing', () => {
    expect(resolvePointer(schema, '/user/missing')).toBeUndefined();
    expect(resolvePointer(schema, '/nope')).toBeUndefined();
  });
});

describe('normalizeSchema', () => {
  it('resolves a ref and then flattens allOf in one step', () => {
    const root: JsonSchema = {
      $defs: {
        Composed: {
          allOf: [
            { type: 'object', properties: { a: { type: 'string' } } },
            { type: 'object', properties: { b: { type: 'number' } } },
          ],
        },
      },
    };
    const normalized = normalizeSchema({ $ref: '#/$defs/Composed' }, root);
    expect(Object.keys(normalized?.properties ?? {}).sort()).toEqual(['a', 'b']);
  });
});
