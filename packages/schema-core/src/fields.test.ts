import { describe, expect, it } from 'vitest';

import { listSchemaFields, typeLabel } from './fields';
import type { JsonSchema } from './types';

describe('typeLabel', () => {
  it('labels primitives', () => {
    expect(typeLabel({ type: 'string' })).toBe('string');
    expect(typeLabel({ type: 'number' })).toBe('number');
    expect(typeLabel({ type: 'boolean' })).toBe('boolean');
    expect(typeLabel({ type: 'null' })).toBe('null');
  });

  it('labels an unconstrained schema as unknown', () => {
    expect(typeLabel({})).toBe('unknown');
    expect(typeLabel(undefined)).toBe('unknown');
  });

  it('carries string format, which is the point of half the mismatches', () => {
    expect(typeLabel({ type: 'string', format: 'email' })).toBe('string (email)');
  });

  it('labels arrays and tuples', () => {
    expect(typeLabel({ type: 'array', items: { type: 'string' } })).toBe('Array<string>');
    expect(typeLabel({ type: 'array' })).toBe('Array<unknown>');
    expect(
      typeLabel({ type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] }),
    ).toBe('[string, number]');
  });

  it('labels small objects inline and abbreviates large ones', () => {
    expect(
      typeLabel({
        type: 'object',
        properties: { id: { type: 'string' }, age: { type: 'number' } },
        required: ['id'],
      }),
    ).toBe('{ id: string; age?: number }');

    const wide = typeLabel({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
        c: { type: 'string' },
        d: { type: 'string' },
        e: { type: 'string' },
      },
    });
    expect(wide).toContain('…+2');
  });

  it('labels a map as a Record', () => {
    expect(typeLabel({ type: 'object', additionalProperties: { type: 'number' } })).toBe(
      'Record<string, number>',
    );
  });

  it('labels enums and consts as literal unions', () => {
    expect(typeLabel({ enum: ['a', 'b'] })).toBe('"a" | "b"');
    expect(typeLabel({ const: 'fixed' })).toBe('"fixed"');
    expect(typeLabel({ enum: [1, 2] })).toBe('1 | 2');
  });

  it('labels unions', () => {
    expect(typeLabel({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe('string | number');
  });

  it('collapses duplicate union members', () => {
    expect(typeLabel({ anyOf: [{ type: 'string' }, { type: 'string' }] })).toBe('string');
  });
});

describe('listSchemaFields', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The identifier' },
      user: {
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'number' } },
        required: ['name'],
      },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['id', 'user'],
  };

  const fields = listSchemaFields(schema);
  const byPointer = new Map(fields.map((f) => [f.pointer, f]));

  it('always includes the root', () => {
    const root = byPointer.get('');
    expect(root).toBeDefined();
    expect(root?.depth).toBe(0);
    expect(root?.name).toBe('');
  });

  it('lists top-level properties with their required flag', () => {
    expect(byPointer.get('/id')?.required).toBe(true);
    expect(byPointer.get('/tags')?.required).toBe(false);
  });

  it('recurses into nested objects', () => {
    expect(byPointer.get('/user/name')?.typeLabel).toBe('string');
    expect(byPointer.get('/user/name')?.required).toBe(true);
    expect(byPointer.get('/user/age')?.required).toBe(false);
    expect(byPointer.get('/user/age')?.depth).toBe(2);
  });

  it('exposes array elements as addressable fields', () => {
    expect(byPointer.get('/tags/0')?.typeLabel).toBe('string');
  });

  it('carries descriptions through', () => {
    expect(byPointer.get('/id')?.description).toBe('The identifier');
  });

  it('respects maxDepth', () => {
    const shallow = listSchemaFields(schema, { maxDepth: 1 });
    expect(shallow.some((f) => f.pointer === '/user')).toBe(true);
    expect(shallow.some((f) => f.pointer === '/user/name')).toBe(false);
  });

  it('terminates on a recursive schema instead of hanging', () => {
    const recursive: JsonSchema = {
      $defs: {
        Node: {
          type: 'object',
          properties: { name: { type: 'string' }, child: { $ref: '#/$defs/Node' } },
        },
      },
      $ref: '#/$defs/Node',
    };

    const start = Date.now();
    const result = listSchemaFields(recursive);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(result.length).toBeGreaterThan(1);
    expect(result.length).toBeLessThan(500);
  });
});
