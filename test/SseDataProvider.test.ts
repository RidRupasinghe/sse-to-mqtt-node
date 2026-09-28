import { afterEach, describe, expect, it } from 'vitest';
import { SseDataProvider, SseDataProviderOptions, TokenProvider } from '../src/SseDataProvider';
import { SseEvent } from '../src/SseParser';
import { TestServer, sendEvents, startServer } from './httpServer';

let server: TestServer | undefined;
let provider: SseDataProvider | undefined;
afterEach(async () => {
  provider?.stop();
  await server?.close();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function create(options: Partial<SseDataProviderOptions<Record<string, unknown>>> & { url: string }, received: SseEvent[] = []): SseDataProvider {
  provider = new SseDataProvider({
    name: 'test',
    method: 'GET',
    retry: { initialDelayMs: 20, jitter: 0 },
    onMessage: (_data, event) => received.push(event),
    ...options
  } as SseDataProviderOptions<Record<string, unknown>>);
  return provider;
}

describe('SseDataProvider', () => {
  it('receives events over GET with an SSE Accept header', async () => {
    server = await startServer((_req, res) => sendEvents(res, ['data: {"id":1}\n\n'], false));
    const received: SseEvent[] = [];
    await create({ url: server.url }, received).start();
    await wait(50);

    expect(received.map((e) => e.data)).toEqual(['{"id":1}']);
    expect(server.requests[0].method).toBe('GET');
    expect(server.requests[0].headers.accept).toBe('text/event-stream');
  });

  it('sends a JSON body over POST', async () => {
    server = await startServer((_req, res) => sendEvents(res, [], false));
    await create({ url: server.url, method: 'POST', body: { q: 1 } }).start();

    expect(server.requests[0].method).toBe('POST');
    expect(server.requests[0].headers['content-type']).toBe('application/json');
    expect(JSON.parse(server.requests[0].body)).toEqual({ q: 1 });
  });

  it('reconnects after the stream ends and sends Last-Event-ID', async () => {
    server = await startServer((_req, res, _body, count) => sendEvents(res, [`id: ${count}\ndata: x\n\n`]));
    await create({ url: server.url }).start();
    await wait(150);
    provider?.stop();

    expect(server.requests.length).toBeGreaterThanOrEqual(3);
    expect(server.requests[0].headers['last-event-id']).toBeUndefined();
    expect(server.requests[1].headers['last-event-id']).toBe('1');
    expect(server.requests[2].headers['last-event-id']).toBe('2');
  });

  it('reports errors, backs off and gives up after maxRetries', async () => {
    server = await startServer((_req, res) => { res.writeHead(500); res.end(); });
    const events: string[] = [];
    await create({
      url: server.url,
      retry: { initialDelayMs: 10, jitter: 0, maxRetries: 2 },
      hooks: {
        onError: (e) => events.push(`error ${e.message.includes('500')}`),
        onReconnecting: (delay, attempt) => events.push(`reconnecting ${delay} #${attempt}`),
        onGaveUp: () => events.push('gaveUp')
      }
    }).start();
    await wait(150);

    expect(events).toEqual(['error true', 'reconnecting 10 #1', 'error true', 'reconnecting 20 #2', 'error true', 'gaveUp']);
    expect(server.requests).toHaveLength(3);
  });

  it('invalidates the token after a 401', async () => {
    server = await startServer((req, res) => {
      if (req.headers.authorization === 'Bearer old') { res.writeHead(401); res.end(); return; }
      sendEvents(res, [], false);
    });
    let token = 'old';
    const tokenProvider: TokenProvider = { getBearerToken: async () => token, invalidate: () => { token = 'new'; } };
    await create({ url: server.url, tokenProvider }).start();
    await wait(80);

    expect(server.requests.map((r) => r.headers.authorization)).toEqual(['Bearer old', 'Bearer new']);
  });

  it('times out when the server never responds', async () => {
    server = await startServer(() => undefined);
    const errors: string[] = [];
    await create({ url: server.url, connectTimeoutMs: 50, retry: { maxRetries: 0 }, hooks: { onError: (e) => errors.push(e.message) } }).start();

    expect(errors).toEqual(['No response within 50ms']);
  });

  it('stops reconnecting after stop()', async () => {
    server = await startServer((_req, res) => sendEvents(res, ['data: x\n\n']));
    await create({ url: server.url }).start();
    provider?.stop();
    const count = server.requests.length;
    await wait(100);

    expect(server.requests).toHaveLength(count);
  });
});
