import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpServerConnection } from '@toolgraph/schema-core';

/**
 * The SDK is mocked wholesale. These tests are about the decisions this package
 * makes before a byte leaves the process — which transport is built, whether it
 * is built at all — so a real transport would only add a socket and a process.
 */
const sdk = vi.hoisted(() => {
  const transportClose = vi.fn(async () => {});
  const makeTransport = () => ({
    start: async () => {},
    send: async () => {},
    close: transportClose,
  });

  const connect = vi.fn(async (): Promise<void> => {});
  const listTools = vi.fn(async (): Promise<{ tools: Record<string, unknown>[] }> => ({
    tools: [],
  }));
  const callTool = vi.fn(async (): Promise<Record<string, unknown>> => ({ content: [] }));
  const close = vi.fn(async (): Promise<void> => {});

  return {
    transportClose,
    makeTransport,
    connect,
    listTools,
    callTool,
    close,
    // Function expressions, not arrows: these stand in for classes and the code
    // under test calls them with `new`.
    Client: vi.fn(function () {
      return { connect, listTools, callTool, close };
    }),
    StdioClientTransport: vi.fn(function () {
      return makeTransport();
    }),
    SSEClientTransport: vi.fn(function () {
      return makeTransport();
    }),
    StreamableHTTPClientTransport: vi.fn(function () {
      return makeTransport();
    }),
    getDefaultEnvironment: vi.fn(() => ({ PATH: '/usr/bin' })),
  };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: sdk.Client }));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: sdk.SSEClientTransport,
}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: sdk.StdioClientTransport,
  getDefaultEnvironment: sdk.getDefaultEnvironment,
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: sdk.StreamableHTTPClientTransport,
}));

import { connectMcpServer, introspectServer, McpClientError } from './client';
import { SsrfBlockedError } from './guarded-fetch';
import type { DnsLookupFn, SsrfPolicy } from './ssrf';

const strict: SsrfPolicy = { allowPrivateNetwork: false };
const permissive: SsrfPolicy = { allowPrivateNetwork: true };

const resolvesTo =
  (...addresses: string[]): DnsLookupFn =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

const publicDns = resolvesTo('93.184.216.34');

const httpServer: McpServerConnection = {
  id: 'srv_1',
  name: 'Weather',
  transport: 'http',
  url: 'https://example.com/mcp',
};

const SECRET = 'Bearer super-secret-token';

/** Every transport constructor, for "nothing was built" assertions. */
function transportCalls(): number {
  return (
    sdk.StdioClientTransport.mock.calls.length +
    sdk.SSEClientTransport.mock.calls.length +
    sdk.StreamableHTTPClientTransport.mock.calls.length
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.connect.mockImplementation(async () => {});
  sdk.listTools.mockImplementation(async () => ({ tools: [] }));
  sdk.callTool.mockImplementation(async () => ({ content: [] }));
  sdk.close.mockImplementation(async () => {});
  sdk.transportClose.mockImplementation(async () => {});
});

/* -------------------------------------------------------------------------- */
/* stdio                                                                       */
/* -------------------------------------------------------------------------- */

describe('stdio', () => {
  const stdioServer: McpServerConnection = {
    id: 'srv_local',
    name: 'Local files',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'server-filesystem'],
  };

  it('is refused when the policy forbids private network access', async () => {
    const error = await connectMcpServer({ connection: stdioServer, policy: strict }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(McpClientError);
    expect((error as McpClientError).code).toBe('stdio_not_allowed');
    expect((error as McpClientError).message).toContain('local-development');
  });

  it('spawns nothing when it is refused', async () => {
    await connectMcpServer({ connection: stdioServer, policy: strict }).catch(() => undefined);

    expect(sdk.StdioClientTransport).not.toHaveBeenCalled();
    expect(sdk.Client).not.toHaveBeenCalled();
    expect(transportCalls()).toBe(0);
  });

  it('is allowed for local development, with env layered over the safe defaults', async () => {
    await connectMcpServer({
      connection: stdioServer,
      policy: permissive,
      secrets: { env: { API_KEY: 'k' } },
    });

    expect(sdk.StdioClientTransport).toHaveBeenCalledTimes(1);
    expect(sdk.StdioClientTransport).toHaveBeenCalledWith({
      command: 'npx',
      args: ['-y', 'server-filesystem'],
      env: { PATH: '/usr/bin', API_KEY: 'k' },
    });
    expect(sdk.connect).toHaveBeenCalledTimes(1);
  });

  it('refuses a stdio connection with no command', async () => {
    const error = await connectMcpServer({
      connection: { id: 'x', name: 'Broken', transport: 'stdio' },
      policy: permissive,
    }).catch((e: unknown) => e);

    expect((error as McpClientError).code).toBe('missing_command');
    expect(transportCalls()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The guard runs first                                                        */
/* -------------------------------------------------------------------------- */

describe('the SSRF guard runs before any transport is constructed', () => {
  it('refuses a link-local URL', async () => {
    const error = await connectMcpServer({
      connection: { ...httpServer, url: 'http://169.254.169.254/latest/meta-data/' },
      policy: strict,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SsrfBlockedError);
    expect((error as SsrfBlockedError).code).toBe('blocked_ip');
    expect(transportCalls()).toBe(0);
    expect(sdk.Client).not.toHaveBeenCalled();
  });

  it('refuses a hostname that resolves into the private network (rebinding)', async () => {
    const error = await connectMcpServer({
      connection: { ...httpServer, url: 'https://looks-fine.example/mcp' },
      policy: strict,
      lookup: resolvesTo('127.0.0.1'),
    }).catch((e: unknown) => e);

    expect((error as SsrfBlockedError).code).toBe('blocked_ip');
    expect(transportCalls()).toBe(0);
  });

  it('refuses credentials embedded in the URL', async () => {
    const error = await connectMcpServer({
      connection: { ...httpServer, url: 'https://user:pass@example.com/mcp' },
      policy: strict,
      lookup: publicDns,
    }).catch((e: unknown) => e);

    expect((error as SsrfBlockedError).code).toBe('credentials_in_url');
    expect(transportCalls()).toBe(0);
  });

  it('refuses a non-HTTP protocol even in local development', async () => {
    const error = await connectMcpServer({
      connection: { ...httpServer, url: 'file:///etc/passwd' },
      policy: permissive,
    }).catch((e: unknown) => e);

    expect((error as SsrfBlockedError).code).toBe('protocol_not_allowed');
    expect(transportCalls()).toBe(0);
  });

  it('refuses an http connection with no URL', async () => {
    const error = await connectMcpServer({
      connection: { id: 'x', name: 'Broken', transport: 'http' },
      policy: strict,
    }).catch((e: unknown) => e);

    expect((error as McpClientError).code).toBe('missing_url');
    expect(transportCalls()).toBe(0);
  });

  it('never puts a secret header into the refusal', async () => {
    const error = await connectMcpServer({
      connection: { ...httpServer, url: 'http://127.0.0.1/mcp' },
      policy: strict,
      secrets: { headers: { Authorization: SECRET } },
    }).catch((e: unknown) => e);

    expect(String((error as Error).message)).not.toContain('super-secret-token');
    expect(JSON.stringify(error)).not.toContain('super-secret-token');
  });
});

/* -------------------------------------------------------------------------- */
/* Transport selection                                                         */
/* -------------------------------------------------------------------------- */

describe('transport selection', () => {
  it('uses the streamable HTTP transport for http', async () => {
    await connectMcpServer({
      connection: httpServer,
      policy: strict,
      lookup: publicDns,
      secrets: { headers: { Authorization: SECRET } },
    });

    expect(sdk.StreamableHTTPClientTransport).toHaveBeenCalledTimes(1);
    expect(sdk.SSEClientTransport).not.toHaveBeenCalled();

    const call = sdk.StreamableHTTPClientTransport.mock.calls[0];
    const [url, opts] = call as unknown as [URL, { requestInit: RequestInit; fetch: unknown }];
    expect(url.href).toBe('https://example.com/mcp');
    expect(opts.requestInit.headers).toEqual({ Authorization: SECRET });
    expect(typeof opts.fetch).toBe('function');
  });

  it('uses the SSE transport for sse', async () => {
    await connectMcpServer({
      connection: { ...httpServer, transport: 'sse', url: 'https://example.com/sse' },
      policy: strict,
      lookup: publicDns,
    });

    expect(sdk.SSEClientTransport).toHaveBeenCalledTimes(1);
    expect(sdk.StreamableHTTPClientTransport).not.toHaveBeenCalled();
  });

  it('sends no headers when there are no secrets', async () => {
    await connectMcpServer({ connection: httpServer, policy: strict, lookup: publicDns });

    const call = sdk.StreamableHTTPClientTransport.mock.calls[0];
    const [, opts] = call as unknown as [URL, { requestInit: RequestInit }];
    expect(opts.requestInit.headers).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

describe('lifecycle', () => {
  it('tears the transport down when the handshake fails', async () => {
    sdk.connect.mockRejectedValueOnce(new Error('refused'));

    await expect(
      connectMcpServer({ connection: httpServer, policy: strict, lookup: publicDns }),
    ).rejects.toThrow('refused');

    expect(sdk.close).toHaveBeenCalledTimes(1);
    expect(sdk.transportClose).toHaveBeenCalledTimes(1);
  });

  it('closes at most once however many times close is called', async () => {
    const client = await connectMcpServer({
      connection: httpServer,
      policy: strict,
      lookup: publicDns,
    });

    await client.close();
    await client.close();
    await client.close();

    expect(sdk.close).toHaveBeenCalledTimes(1);
    expect(sdk.transportClose).toHaveBeenCalledTimes(1);
  });

  it('does not surface a failure from close', async () => {
    sdk.close.mockRejectedValue(new Error('already gone'));
    const client = await connectMcpServer({
      connection: httpServer,
      policy: strict,
      lookup: publicDns,
    });

    await expect(client.close()).resolves.toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* listTools                                                                   */
/* -------------------------------------------------------------------------- */

describe('listTools', () => {
  it('maps SDK tools onto descriptors', async () => {
    sdk.listTools.mockResolvedValue({
      tools: [
        {
          name: 'get_forecast',
          description: 'Look up a forecast.',
          inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
          outputSchema: { type: 'object', properties: { tempC: { type: 'number' } } },
        },
      ],
    });

    const client = await connectMcpServer({
      connection: httpServer,
      policy: strict,
      lookup: publicDns,
    });

    expect(await client.listTools()).toEqual([
      {
        serverId: 'srv_1',
        name: 'get_forecast',
        description: 'Look up a forecast.',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { tempC: { type: 'number' } } },
      },
    ]);
  });

  it('normalises a missing, empty or unusable input schema', async () => {
    sdk.listTools.mockResolvedValue({
      tools: [
        { name: 'a' },
        { name: 'b', inputSchema: {} },
        { name: 'c', inputSchema: null },
        { name: 'd', inputSchema: 'nonsense' },
        { name: 'e', inputSchema: { type: 'object' } },
      ],
    });

    const client = await connectMcpServer({
      connection: httpServer,
      policy: strict,
      lookup: publicDns,
    });
    const tools = await client.listTools();

    for (const tool of tools) {
      expect(tool.inputSchema).toEqual({ type: 'object', properties: {} });
    }
    expect(tools).toHaveLength(5);
  });

  it('omits an absent output schema rather than inventing one', async () => {
    sdk.listTools.mockResolvedValue({ tools: [{ name: 'a', outputSchema: {} }] });

    const client = await connectMcpServer({
      connection: httpServer,
      policy: strict,
      lookup: publicDns,
    });
    const [tool] = await client.listTools();

    expect(tool?.outputSchema).toBeUndefined();
    expect(tool?.title).toBeUndefined();
  });

  it('falls back to the annotation title', async () => {
    sdk.listTools.mockResolvedValue({
      tools: [
        { name: 'a', annotations: { title: 'Annotated' } },
        { name: 'b', title: 'Direct' },
      ],
    });

    const client = await connectMcpServer({
      connection: httpServer,
      policy: strict,
      lookup: publicDns,
    });
    const tools = await client.listTools();

    expect(tools[0]?.title).toBe('Annotated');
    expect(tools[1]?.title).toBe('Direct');
  });
});

/* -------------------------------------------------------------------------- */
/* callTool                                                                    */
/* -------------------------------------------------------------------------- */

describe('callTool', () => {
  async function connected() {
    return connectMcpServer({ connection: httpServer, policy: strict, lookup: publicDns });
  }

  it('prefers structuredContent', async () => {
    sdk.callTool.mockResolvedValue({
      content: [{ type: 'text', text: '{"tempC":12}' }],
      structuredContent: { tempC: 12 },
    });

    const client = await connected();
    expect(await client.callTool('get_forecast', { city: 'Oslo' })).toEqual({ tempC: 12 });
  });

  it('falls back to the content array', async () => {
    sdk.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'hello' }] });

    const client = await connected();
    expect(await client.callTool('echo', {})).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('forwards the name, arguments and deadline to the SDK', async () => {
    const client = await connected();
    await client.callTool('echo', { a: 1 }, 1_234);

    expect(sdk.callTool).toHaveBeenCalledWith({ name: 'echo', arguments: { a: 1 } }, undefined, {
      timeout: 1_234,
    });
  });

  it('throws when the server reports a tool error', async () => {
    sdk.callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'city not found' }],
    });

    const client = await connected();
    const error = await client.callTool('get_forecast', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(McpClientError);
    expect((error as McpClientError).code).toBe('tool_call_failed');
    expect((error as McpClientError).message).toContain('city not found');
  });
});

/* -------------------------------------------------------------------------- */
/* introspectServer                                                            */
/* -------------------------------------------------------------------------- */

describe('introspectServer', () => {
  it('connects, lists and disconnects', async () => {
    sdk.listTools.mockResolvedValue({ tools: [{ name: 'a' }] });

    const tools = await introspectServer({
      connection: httpServer,
      policy: strict,
      lookup: publicDns,
    });

    expect(tools).toEqual([
      { serverId: 'srv_1', name: 'a', inputSchema: { type: 'object', properties: {} } },
    ]);
    expect(sdk.close).toHaveBeenCalledTimes(1);
  });

  it('disconnects even when listing fails', async () => {
    sdk.listTools.mockRejectedValue(new Error('nope'));

    await expect(
      introspectServer({ connection: httpServer, policy: strict, lookup: publicDns }),
    ).rejects.toThrow('nope');

    expect(sdk.close).toHaveBeenCalledTimes(1);
  });

  it('refuses a blocked server without connecting', async () => {
    await expect(
      introspectServer({
        connection: { ...httpServer, url: 'http://10.0.0.1/mcp' },
        policy: strict,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);

    expect(sdk.Client).not.toHaveBeenCalled();
    expect(transportCalls()).toBe(0);
  });
});
