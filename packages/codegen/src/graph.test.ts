import { describe, expect, it } from 'vitest';

import {
  isValidPyIdentifier,
  isValidTsIdentifier,
  parseJsonPointer,
  pointerToAccessPath,
  sanitizePyIdentifier,
  sanitizeTsIdentifier,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  topologicalSort,
  uniqueName,
} from './graph';
import { simpleChain } from './fixtures';
import type { ToolGraphDocument } from './contract';

describe('topologicalSort', () => {
  it('orders a chain by its edges', () => {
    const { order, cycle } = topologicalSort(simpleChain.doc);
    expect(cycle).toBeUndefined();
    expect(order.map((node) => node.id)).toEqual(['n1', 'n2']);
  });

  it('reports a cycle rather than throwing', () => {
    const cyclic: ToolGraphDocument = {
      ...simpleChain.doc,
      edges: [
        { id: 'e1', source: 'n1', sourceHandle: '', target: 'n2', targetHandle: '/userId' },
        { id: 'e2', source: 'n2', sourceHandle: '', target: 'n1', targetHandle: '/email' },
      ],
    };

    const { cycle } = topologicalSort(cyclic);
    expect(cycle).toBeDefined();
    expect(cycle?.length).toBeGreaterThan(0);
  });

  it('is stable across repeated calls', () => {
    const first = topologicalSort(simpleChain.doc).order.map((n) => n.id);
    const second = topologicalSort(simpleChain.doc).order.map((n) => n.id);
    expect(first).toEqual(second);
  });
});

describe('json pointers', () => {
  it('parses and unescapes', () => {
    expect(parseJsonPointer('')).toEqual([]);
    expect(parseJsonPointer('/a/b')).toEqual(['a', 'b']);
    expect(parseJsonPointer('/a~1b')).toEqual(['a/b']);
    expect(parseJsonPointer('/a~0b')).toEqual(['a~b']);
  });

  it('renders a TypeScript access path', () => {
    expect(pointerToAccessPath('/user/id', 'ts')).toBe('.user.id');
    expect(pointerToAccessPath('/items/0', 'ts')).toBe('.items[0]');
  });

  it('uses bracket notation for a key that is not an identifier', () => {
    // Single-quoted, matching the style the rest of the generated code uses.
    expect(pointerToAccessPath('/my-key', 'ts')).toBe("['my-key']");
    expect(pointerToAccessPath('/with space', 'ts')).toBe("['with space']");
  });

  it('renders a Python access path', () => {
    const path = pointerToAccessPath('/user/id', 'py');
    expect(path).toMatch(/user/);
    expect(path).toMatch(/id/);
  });

  it('returns an empty path for the root pointer', () => {
    expect(pointerToAccessPath('', 'ts')).toBe('');
    expect(pointerToAccessPath('', 'py')).toBe('');
  });
});

describe('identifier hygiene', () => {
  it('recognises valid identifiers', () => {
    expect(isValidTsIdentifier('userId')).toBe(true);
    expect(isValidTsIdentifier('user-id')).toBe(false);
    expect(isValidTsIdentifier('1abc')).toBe(false);
    expect(isValidPyIdentifier('user_id')).toBe(true);
    expect(isValidPyIdentifier('user-id')).toBe(false);
  });

  it('rejects reserved words as bare identifiers', () => {
    // `class` is reserved in Python, `from` in neither as a variable but both
    // are worth renaming; `import` is reserved in both.
    expect(isValidPyIdentifier('class')).toBe(false);
    expect(isValidPyIdentifier('import')).toBe(false);
    expect(isValidTsIdentifier('const')).toBe(false);
  });

  it('renames a reserved word rather than emitting broken code', () => {
    expect(sanitizePyIdentifier('class')).not.toBe('class');
    expect(isValidPyIdentifier(sanitizePyIdentifier('class'))).toBe(true);
    expect(sanitizeTsIdentifier('const')).not.toBe('const');
    expect(isValidTsIdentifier(sanitizeTsIdentifier('const'))).toBe(true);
  });

  it('rescues a name that is entirely invalid', () => {
    expect(isValidTsIdentifier(sanitizeTsIdentifier('!!!'))).toBe(true);
    expect(isValidPyIdentifier(sanitizePyIdentifier('123'))).toBe(true);
  });
});

describe('case conversion', () => {
  it('converts between the conventions each language expects', () => {
    expect(toPascalCase('create_user')).toBe('CreateUser');
    expect(toPascalCase('create-user')).toBe('CreateUser');
    expect(toCamelCase('create_user')).toBe('createUser');
    expect(toSnakeCase('createUser')).toBe('create_user');
    expect(toSnakeCase('CreateUser')).toBe('create_user');
  });
});

describe('uniqueName', () => {
  it('suffixes a collision instead of shadowing it', () => {
    const taken = new Set<string>();
    expect(uniqueName('Thing', taken)).toBe('Thing');
    expect(uniqueName('Thing', taken)).not.toBe('Thing');
    expect(taken.size).toBe(2);
  });
});
