/**
 * Representative graphs used by the generator tests.
 *
 * Chosen to cover the shapes that actually break code generators: a plain
 * primitive hand-off, a nested required field, and an array of objects with a
 * static input and an enum alongside it.
 */

import type { McpToolDescriptor, ToolGraphDocument } from './contract';

const server = {
  id: 'srv-1',
  name: 'Example server',
  transport: 'http' as const,
  url: 'https://example.com/mcp',
};

export interface Fixture {
  name: string;
  doc: ToolGraphDocument;
  tools: McpToolDescriptor[];
}

/** Two tools chained, primitive field to primitive field. */
export const simpleChain: Fixture = {
  name: 'simple chain',
  tools: [
    {
      serverId: 'srv-1',
      name: 'create_user',
      description: 'Creates a user and returns it.',
      inputSchema: {
        type: 'object',
        properties: { email: { type: 'string', format: 'email' } },
        required: ['email'],
      },
      outputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, createdAt: { type: 'string' } },
        required: ['id'],
      },
    },
    {
      serverId: 'srv-1',
      name: 'send_email',
      description: 'Sends a message to a user.',
      inputSchema: {
        type: 'object',
        properties: { userId: { type: 'string' }, subject: { type: 'string' } },
        required: ['userId', 'subject'],
      },
      outputSchema: {
        type: 'object',
        properties: { sent: { type: 'boolean' } },
        required: ['sent'],
      },
    },
  ],
  doc: {
    version: 1,
    name: 'Simple chain',
    servers: [server],
    nodes: [
      {
        id: 'n1',
        kind: 'mcpTool',
        position: { x: 0, y: 0 },
        data: {
          label: 'Create user',
          serverId: 'srv-1',
          toolName: 'create_user',
          staticInputs: { '/email': 'someone@example.com' },
        },
      },
      {
        id: 'n2',
        kind: 'mcpTool',
        position: { x: 300, y: 0 },
        data: {
          label: 'Send email',
          serverId: 'srv-1',
          toolName: 'send_email',
          staticInputs: { '/subject': 'Welcome' },
        },
      },
    ],
    edges: [{ id: 'e1', source: 'n1', sourceHandle: '/id', target: 'n2', targetHandle: '/userId' }],
  },
};

/** A nested object output feeding a nested required input. */
export const nestedObjects: Fixture = {
  name: 'nested objects',
  tools: [
    {
      serverId: 'srv-1',
      name: 'fetch_profile',
      inputSchema: {
        type: 'object',
        properties: { handle: { type: 'string' } },
        required: ['handle'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              address: {
                type: 'object',
                properties: { city: { type: 'string' }, postcode: { type: 'string' } },
                required: ['city'],
              },
            },
            required: ['id', 'address'],
          },
        },
        required: ['user'],
      },
    },
    {
      serverId: 'srv-1',
      name: 'record_location',
      inputSchema: {
        type: 'object',
        properties: {
          location: {
            type: 'object',
            properties: { city: { type: 'string' }, source: { type: 'string' } },
            required: ['city'],
          },
        },
        required: ['location'],
      },
    },
  ],
  doc: {
    version: 1,
    name: 'Nested objects',
    servers: [server],
    nodes: [
      {
        id: 'a',
        kind: 'mcpTool',
        position: { x: 0, y: 0 },
        data: {
          label: 'Fetch profile',
          serverId: 'srv-1',
          toolName: 'fetch_profile',
          staticInputs: { '/handle': 'ada' },
        },
      },
      {
        id: 'b',
        kind: 'mcpTool',
        position: { x: 300, y: 0 },
        data: {
          label: 'Record location',
          serverId: 'srv-1',
          toolName: 'record_location',
          staticInputs: { '/location/source': 'profile' },
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'a',
        sourceHandle: '/user/address/city',
        target: 'b',
        targetHandle: '/location/city',
      },
    ],
  },
};

/**
 * Arrays of objects, an enum, a static input, and a field name that is a
 * reserved word in both languages — the awkward case.
 */
export const arraysAndEnums: Fixture = {
  name: 'arrays and enums',
  tools: [
    {
      serverId: 'srv-1',
      name: 'search_docs',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer' },
          mode: { type: 'string', enum: ['fast', 'thorough'] },
        },
        required: ['query'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              // `class` and `from` are reserved in Python and TypeScript
              // respectively; both must be renamed with an alias.
              properties: {
                id: { type: 'string' },
                from: { type: 'string' },
                class: { type: 'string' },
              },
              required: ['id'],
            },
          },
        },
        required: ['results'],
      },
    },
    {
      serverId: 'srv-1',
      name: 'summarise',
      inputSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                from: { type: 'string' },
                class: { type: 'string' },
              },
              required: ['id'],
            },
          },
          style: { type: 'string', enum: ['brief', 'detailed'] },
        },
        required: ['items'],
      },
    },
  ],
  doc: {
    version: 1,
    name: 'Arrays and enums',
    servers: [server],
    nodes: [
      {
        id: 's',
        kind: 'mcpTool',
        position: { x: 0, y: 0 },
        data: {
          label: 'Search docs',
          serverId: 'srv-1',
          toolName: 'search_docs',
          staticInputs: { '/query': 'mcp', '/limit': 10, '/mode': 'fast' },
        },
      },
      {
        id: 'u',
        kind: 'mcpTool',
        position: { x: 300, y: 0 },
        data: {
          label: 'Summarise',
          serverId: 'srv-1',
          toolName: 'summarise',
          staticInputs: { '/style': 'brief' },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 's', sourceHandle: '/results', target: 'u', targetHandle: '/items' },
    ],
  },
};

export const allFixtures: Fixture[] = [simpleChain, nestedObjects, arraysAndEnums];
