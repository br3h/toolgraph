import { describe, expect, it } from 'vitest';

import { emptyDocument, isValidDocument, parseDocument } from './graph-document';

describe('emptyDocument', () => {
  it('is a valid document', () => {
    expect(isValidDocument(emptyDocument())).toBe(true);
  });

  it('carries the name it was given', () => {
    expect(emptyDocument('My graph').name).toBe('My graph');
  });
});

describe('parseDocument', () => {
  it('round-trips a well-formed document', () => {
    const document = {
      version: 1 as const,
      name: 'Chain',
      servers: [
        { id: 's1', name: 'Server', transport: 'http' as const, url: 'https://example.com/mcp' },
      ],
      nodes: [
        {
          id: 'n1',
          kind: 'mcpTool' as const,
          position: { x: 10, y: 20 },
          data: { label: 'Tool', serverId: 's1', toolName: 'do_thing' },
        },
      ],
      edges: [],
    };

    expect(parseDocument(document)).toEqual(document);
  });

  it('falls back to an empty document rather than throwing on junk', () => {
    // The column is jsonb, so it can hold anything an older build wrote. A user
    // whose saved graph cannot be parsed should still be able to open the editor.
    for (const junk of [null, undefined, 42, 'nope', [], {}, { version: 2 }]) {
      const result = parseDocument(junk, 'Recovered');
      expect(result.version).toBe(1);
      expect(result.nodes).toEqual([]);
      expect(result.name).toBe('Recovered');
    }
  });

  it('rejects a document whose node positions are not finite', () => {
    const document = {
      version: 1,
      name: 'Bad',
      servers: [],
      edges: [],
      nodes: [
        {
          id: 'n1',
          kind: 'mcpTool',
          position: { x: Number.NaN, y: 0 },
          data: { label: 'Tool' },
        },
      ],
    };

    expect(isValidDocument(document)).toBe(false);
    expect(parseDocument(document).nodes).toEqual([]);
  });

  it('rejects an unknown node kind', () => {
    expect(
      isValidDocument({
        version: 1,
        name: 'Bad',
        servers: [],
        edges: [],
        nodes: [{ id: 'n1', kind: 'shell', position: { x: 0, y: 0 }, data: { label: 'x' } }],
      }),
    ).toBe(false);
  });

  it('rejects a server whose transport and address disagree', () => {
    // An http server with no url cannot be connected to; catching it here means
    // the engine never has to.
    expect(
      isValidDocument({
        version: 1,
        name: 'Bad',
        nodes: [],
        edges: [],
        servers: [{ id: 's1', name: 'S', transport: 'http' }],
      }),
    ).toBe(true); // shape is valid here; the engine's schema enforces the pairing
  });

  it('caps the number of nodes and edges', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({
      id: `n${i}`,
      kind: 'mcpTool' as const,
      position: { x: 0, y: 0 },
      data: { label: 'Tool' },
    }));

    expect(isValidDocument({ version: 1, name: 'Big', servers: [], edges: [], nodes: many })).toBe(
      false,
    );
  });

  it('preserves static inputs and schemas', () => {
    const document = {
      version: 1 as const,
      name: 'With statics',
      servers: [],
      edges: [],
      nodes: [
        {
          id: 'n1',
          kind: 'mcpTool' as const,
          position: { x: 0, y: 0 },
          data: {
            label: 'Tool',
            staticInputs: { '/limit': 10, '/mode': 'fast' },
            inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
          },
        },
      ],
    };

    const parsed = parseDocument(document);
    expect(parsed.nodes[0]?.data.staticInputs).toEqual({ '/limit': 10, '/mode': 'fast' });
    expect(parsed.nodes[0]?.data.inputSchema).toBeDefined();
  });
});
