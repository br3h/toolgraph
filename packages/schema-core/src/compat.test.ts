import { describe, expect, it } from 'vitest';

import { checkConnection } from './compat';
import type { JsonSchema } from './types';

/** Wire the whole source value into the whole target value. */
function check(source: JsonSchema | undefined, target: JsonSchema, labels?: { source?: string }) {
  return checkConnection({
    sourceSchema: source,
    sourcePointer: '',
    targetSchema: target,
    targetPointer: '',
    ...(labels?.source ? { sourceLabel: labels.source } : {}),
  });
}

const errorsOf = (r: { issues: { severity: string; code: string }[] }) =>
  r.issues.filter((i) => i.severity === 'error').map((i) => i.code);
const warningsOf = (r: { issues: { severity: string; code: string }[] }) =>
  r.issues.filter((i) => i.severity === 'warning').map((i) => i.code);

/* -------------------------------------------------------------------------- */

describe('primitive types', () => {
  const primitives = ['string', 'number', 'boolean', 'object', 'array', 'null'] as const;

  it('accepts every primitive feeding itself', () => {
    for (const type of primitives) {
      const result = check({ type }, { type });
      expect(result.compatible, `${type} -> ${type}`).toBe(true);
      expect(errorsOf(result)).toEqual([]);
    }
  });

  it('rejects every mismatched primitive pair', () => {
    for (const from of primitives) {
      for (const to of primitives) {
        if (from === to) continue;
        const result = check({ type: from }, { type: to });
        expect(result.compatible, `${from} -> ${to} should be rejected`).toBe(false);
        expect(errorsOf(result)).toContain('type_mismatch');
      }
    }
  });

  it('widens integer into number but never the reverse', () => {
    expect(check({ type: 'integer' }, { type: 'number' }).compatible).toBe(true);

    const narrowing = check({ type: 'number' }, { type: 'integer' });
    expect(narrowing.compatible).toBe(false);
    expect(errorsOf(narrowing)).toContain('type_mismatch');
  });

  it('treats a target with no declared type as accepting anything', () => {
    expect(check({ type: 'string' }, {}).compatible).toBe(true);
    expect(check({ type: 'object' }, {}).compatible).toBe(true);
  });

  it('warns rather than blocking when the source declares no type', () => {
    const result = check({}, { type: 'string' });
    expect(result.compatible).toBe(true);
    expect(warningsOf(result)).toContain('type_mismatch');
  });

  it('accepts a source union of types when every member is assignable', () => {
    expect(check({ type: ['integer', 'number'] }, { type: 'number' }).compatible).toBe(true);
  });

  it('rejects a source union of types when any member is not assignable', () => {
    const result = check({ type: ['string', 'number'] }, { type: 'number' });
    expect(result.compatible).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe('objects', () => {
  it('accepts a matching object', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { id: { type: 'string' }, count: { type: 'number' } },
      required: ['id'],
    };
    expect(check(schema, schema).compatible).toBe(true);
  });

  it('rejects a source missing a required target property', () => {
    const result = check(
      { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      {
        type: 'object',
        properties: { id: { type: 'string' }, email: { type: 'string' } },
        required: ['id', 'email'],
      },
    );
    expect(result.compatible).toBe(false);
    expect(errorsOf(result)).toContain('missing_required_property');
    expect(result.issues.find((i) => i.code === 'missing_required_property')?.path).toBe('/email');
  });

  it('rejects an optional source property feeding a required target property', () => {
    const result = check(
      { type: 'object', properties: { id: { type: 'string' } } },
      { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    );
    expect(result.compatible).toBe(false);
    expect(errorsOf(result)).toContain('optional_feeds_required');
  });

  it('allows a required source property feeding an optional target property', () => {
    const result = check(
      { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      { type: 'object', properties: { id: { type: 'string' } } },
    );
    expect(result.compatible).toBe(true);
  });

  it('ignores extra source properties the target does not declare', () => {
    const result = check(
      {
        type: 'object',
        properties: { id: { type: 'string' }, extra: { type: 'number' } },
        required: ['id'],
      },
      { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    );
    expect(result.compatible).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('warns when the target forbids the extra properties the source carries', () => {
    const result = check(
      {
        type: 'object',
        properties: { id: { type: 'string' }, extra: { type: 'number' } },
        required: ['id'],
      },
      {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    );
    expect(result.compatible).toBe(true);
    expect(warningsOf(result)).toContain('additional_properties_forbidden');
  });

  it('reports a mismatch three levels deep with the full dotted field name', () => {
    const source: JsonSchema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            profile: {
              type: 'object',
              properties: { age: { type: 'string' } },
              required: ['age'],
            },
          },
          required: ['profile'],
        },
      },
      required: ['user'],
    };
    const target: JsonSchema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            profile: {
              type: 'object',
              properties: { age: { type: 'number' } },
              required: ['age'],
            },
          },
          required: ['profile'],
        },
      },
      required: ['user'],
    };

    const result = check(source, target);
    expect(result.compatible).toBe(false);

    const issue = result.issues.find((i) => i.code === 'type_mismatch');
    expect(issue?.path).toBe('/user/profile/age');
    expect(issue?.message).toContain('user.profile.age');
    expect(issue?.message).toContain('number');
    expect(issue?.message).toContain('string');
  });
});

/* -------------------------------------------------------------------------- */

describe('arrays and tuples', () => {
  it('accepts matching arrays of primitives', () => {
    expect(
      check(
        { type: 'array', items: { type: 'string' } },
        { type: 'array', items: { type: 'string' } },
      ).compatible,
    ).toBe(true);
  });

  it('rejects arrays whose element types differ', () => {
    const result = check(
      { type: 'array', items: { type: 'number' } },
      { type: 'array', items: { type: 'string' } },
    );
    expect(result.compatible).toBe(false);
    expect(errorsOf(result)).toContain('array_item_mismatch');
  });

  it('recurses into arrays of objects', () => {
    const result = check(
      {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      },
      {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    );
    expect(result.compatible).toBe(false);
  });

  it('warns when the source array does not declare its element type', () => {
    const result = check({ type: 'array' }, { type: 'array', items: { type: 'string' } });
    expect(result.compatible).toBe(true);
    expect(warningsOf(result)).toContain('array_item_mismatch');
  });

  it('accepts a tuple whose positions all match', () => {
    const tuple: JsonSchema = {
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
    };
    expect(check(tuple, tuple).compatible).toBe(true);
  });

  it('rejects a tuple that is too short for the target', () => {
    const result = check(
      { type: 'array', prefixItems: [{ type: 'string' }] },
      { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] },
    );
    expect(result.compatible).toBe(false);
    expect(errorsOf(result)).toContain('tuple_arity_mismatch');
  });

  it('rejects a tuple whose positional types differ', () => {
    const result = check(
      { type: 'array', prefixItems: [{ type: 'string' }, { type: 'string' }] },
      { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] },
    );
    expect(result.compatible).toBe(false);
  });

  it('warns when the target requires more elements than the source guarantees', () => {
    const result = check(
      { type: 'array', items: { type: 'string' } },
      { type: 'array', items: { type: 'string' }, minItems: 2 },
    );
    expect(result.compatible).toBe(true);
    expect(warningsOf(result)).toContain('constraint_not_guaranteed');
  });
});

/* -------------------------------------------------------------------------- */

describe('enums and constants', () => {
  it('accepts a narrower source enum', () => {
    expect(check({ enum: ['a'] }, { enum: ['a', 'b'] }).compatible).toBe(true);
  });

  it('rejects a wider source enum', () => {
    const result = check({ enum: ['a', 'b', 'c'] }, { enum: ['a', 'b'] });
    expect(result.compatible).toBe(false);
    expect(errorsOf(result)).toContain('enum_not_subset');
    expect(result.issues[0]?.message).toContain('"c"');
  });

  it('accepts a const inside the target enum', () => {
    expect(check({ const: 'a' }, { enum: ['a', 'b'] }).compatible).toBe(true);
  });

  it('rejects a const outside the target enum', () => {
    expect(check({ const: 'z' }, { enum: ['a', 'b'] }).compatible).toBe(false);
  });

  it('warns when an unconstrained source feeds an enum', () => {
    const result = check({ type: 'string' }, { type: 'string', enum: ['a', 'b'] });
    expect(result.compatible).toBe(true);
    expect(warningsOf(result)).toContain('enum_not_subset');
  });
});

/* -------------------------------------------------------------------------- */

describe('unions', () => {
  it('requires every source branch to satisfy the target', () => {
    const bad = check({ anyOf: [{ type: 'string' }, { type: 'number' }] }, { type: 'string' });
    expect(bad.compatible).toBe(false);

    const good = check({ anyOf: [{ type: 'string' }, { type: 'string' }] }, { type: 'string' });
    expect(good.compatible).toBe(true);
  });

  it('accepts a source matching any one target branch', () => {
    const result = check({ type: 'number' }, { anyOf: [{ type: 'string' }, { type: 'number' }] });
    expect(result.compatible).toBe(true);
  });

  it('rejects a source matching no target branch', () => {
    const result = check({ type: 'boolean' }, { anyOf: [{ type: 'string' }, { type: 'number' }] });
    expect(result.compatible).toBe(false);
    expect(errorsOf(result)).toContain('union_no_compatible_branch');
  });

  it('handles oneOf the same way as anyOf', () => {
    expect(
      check({ type: 'number' }, { oneOf: [{ type: 'string' }, { type: 'number' }] }).compatible,
    ).toBe(true);
  });

  it('merges allOf on both sides before comparing', () => {
    const source: JsonSchema = {
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    };
    const target: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
    };
    expect(check(source, target).compatible).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe('$ref resolution', () => {
  it('resolves $defs on both sides', () => {
    const schema: JsonSchema = {
      $defs: { Id: { type: 'string' } },
      type: 'object',
      properties: { id: { $ref: '#/$defs/Id' } },
      required: ['id'],
    };
    expect(check(schema, schema).compatible).toBe(true);
  });

  it('resolves the legacy definitions keyword', () => {
    const schema: JsonSchema = {
      definitions: { Id: { type: 'number' } },
      type: 'object',
      properties: { id: { $ref: '#/definitions/Id' } },
      required: ['id'],
    };
    const target: JsonSchema = {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    };
    expect(check(schema, target).compatible).toBe(false);
  });

  it('terminates on a recursive $ref instead of hanging', () => {
    const recursive: JsonSchema = {
      $defs: {
        Node: {
          type: 'object',
          properties: { child: { $ref: '#/$defs/Node' }, name: { type: 'string' } },
          required: ['name'],
        },
      },
      $ref: '#/$defs/Node',
    };

    const start = Date.now();
    const result = check(recursive, recursive);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(result).toBeDefined();
  });

  it('reports an unresolvable $ref as an error', () => {
    const result = check({ $ref: '#/$defs/Missing' }, { type: 'string' });
    expect(result.compatible).toBe(false);
    expect(errorsOf(result)).toContain('unresolved_ref');
  });
});

/* -------------------------------------------------------------------------- */

describe('pointers into schemas', () => {
  const source: JsonSchema = {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: { id: { type: 'number' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['user'],
  };

  it('wires a nested source field into a flat target field', () => {
    const result = checkConnection({
      sourceSchema: source,
      sourcePointer: '/user/name',
      targetSchema: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
      targetPointer: '/userId',
    });
    expect(result.compatible).toBe(true);
  });

  it('catches the classic number-into-string mismatch with a usable message', () => {
    const result = checkConnection({
      sourceSchema: source,
      sourcePointer: '/user/id',
      targetSchema: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
      targetPointer: '/userId',
      sourceLabel: 'createUser',
    });

    expect(result.compatible).toBe(false);
    const message = result.issues[0]?.message ?? '';
    expect(message).toContain('userId');
    expect(message).toContain('string');
    expect(message).toContain('number');
    expect(message).toContain('createUser');
  });

  it('addresses an array element through its index', () => {
    const result = checkConnection({
      sourceSchema: source,
      sourcePointer: '/tags/0',
      targetSchema: { type: 'string' },
      targetPointer: '',
    });
    expect(result.compatible).toBe(true);
  });

  it('reports a pointer that addresses nothing', () => {
    const result = checkConnection({
      sourceSchema: source,
      sourcePointer: '/user/missing',
      targetSchema: { type: 'string' },
      targetPointer: '',
    });
    expect(result.compatible).toBe(false);
    expect(errorsOf(result)).toContain('pointer_not_found');
  });
});

/* -------------------------------------------------------------------------- */

describe('under-specified schemas', () => {
  it('warns, rather than blocking, when the source declares no output schema', () => {
    const result = check(undefined, { type: 'string' }, { source: 'searchDocs' });
    expect(result.compatible).toBe(true);
    expect(warningsOf(result)).toContain('unknown_source_schema');
    expect(result.issues[0]?.message).toContain('searchDocs');
  });

  it('warns on a format the source does not promise', () => {
    const result = check({ type: 'string' }, { type: 'string', format: 'email' });
    expect(result.compatible).toBe(true);
    expect(warningsOf(result)).toContain('format_mismatch');
  });

  it('accepts a matching format without complaint', () => {
    const result = check({ type: 'string', format: 'email' }, { type: 'string', format: 'email' });
    expect(result.issues).toEqual([]);
  });

  it('warns on numeric bounds the source does not guarantee', () => {
    const result = check({ type: 'number' }, { type: 'number', minimum: 1 });
    expect(result.compatible).toBe(true);
    expect(warningsOf(result)).toContain('constraint_not_guaranteed');
  });

  it('accepts a source whose bound is at least as strict', () => {
    const result = check({ type: 'number', minimum: 5 }, { type: 'number', minimum: 1 });
    expect(result.issues).toEqual([]);
  });
});
