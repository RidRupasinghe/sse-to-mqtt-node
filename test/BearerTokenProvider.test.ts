import { afterEach, describe, expect, it } from 'vitest';
import { BearerTokenProvider, BodyType } from '../src/BearerTokenProvider';
import { HttpError } from '../src/errors';
import { TestServer, startServer } from './httpServer';

let server: TestServer | undefined;
afterEach(async () => server?.close());

function json(res: import('http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

describe('BearerTokenProvider', () => {
  it('sends a form-encoded body, omitting undefined fields', async () => {
    server = await startServer((_req, res) => json(res, 200, { access_token: 't' }));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.FormUrlEncoded, body: { a: 'x y', b: 1, c: undefined } });

    await expect(provider.getBearerToken()).resolves.toBe('t');
    expect(server.requests[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(server.requests[0].body).toBe('a=x+y&b=1');
  });

  it('sends a JSON body and reads custom token fields', async () => {
    server = await startServer((_req, res) => json(res, 200, { jwt: 'j' }));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.Json, body: { a: { b: 1 } }, tokenFields: ['jwt'] });

    await expect(provider.getBearerToken()).resolves.toBe('j');
    expect(JSON.parse(server.requests[0].body)).toEqual({ a: { b: 1 } });
  });

  it('rejects nested values in form bodies', async () => {
    const provider = new BearerTokenProvider({ url: 'http://127.0.0.1:1', bodyType: BodyType.FormUrlEncoded, body: { a: { b: 1 } } });
    await expect(provider.getBearerToken()).rejects.toThrow(/primitive/);
  });

  it('throws HttpError on non-2xx responses', async () => {
    server = await startServer((_req, res) => json(res, 401, {}));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.Json, body: {} });

    const error = await provider.getBearerToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(401);
  });

  it('throws when the response has no token', async () => {
    server = await startServer((_req, res) => json(res, 200, {}));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.Json, body: {} });
    await expect(provider.getBearerToken()).rejects.toThrow(/access_token, token/);
  });

  it('shares one request between concurrent callers and caches the token', async () => {
    server = await startServer((_req, res, _body, count) => setTimeout(() => json(res, 200, { access_token: `t${count}` }), 20));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.Json, body: {} });

    const tokens = await Promise.all([provider.getBearerToken(), provider.getBearerToken(), provider.getBearerToken()]);
    expect(tokens).toEqual(['t1', 't1', 't1']);
    await expect(provider.getBearerToken()).resolves.toBe('t1');
    expect(server.requests).toHaveLength(1);
  });

  it('refreshes after expiry and after invalidate()', async () => {
    server = await startServer((_req, res, _body, count) => json(res, 200, { access_token: `t${count}`, expires_in: 0.1 }));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.Json, body: {}, expiryMarginMs: 20 });

    await expect(provider.getBearerToken()).resolves.toBe('t1');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(provider.getBearerToken()).resolves.toBe('t2');
    provider.invalidate();
    await expect(provider.getBearerToken()).resolves.toBe('t3');
  });

  it('uses tokenLifetimeMs minus the margin when the response has no expires_in', async () => {
    server = await startServer((_req, res) => json(res, 200, { access_token: 't' }));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.Json, body: {}, tokenLifetimeMs: 3600000 });

    const before = Date.now();
    const token = await provider.getBearerToken();
    const refreshAt = provider.refreshAt(token) ?? 0;

    expect(refreshAt).toBeGreaterThanOrEqual(before + 3300000);
    expect(refreshAt).toBeLessThanOrEqual(Date.now() + 3300000);
    expect(provider.refreshAt('other')).toBeUndefined();
  });

  it('uses the shorter of expires_in and tokenLifetimeMs, capping the margin at half the lifetime', async () => {
    server = await startServer((_req, res) => json(res, 200, { access_token: 't', expires_in: '60' }));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.Json, body: {}, tokenLifetimeMs: 3600000 });

    const before = Date.now();
    const refreshAt = provider.refreshAt(await provider.getBearerToken()) ?? 0;

    expect(refreshAt).toBeGreaterThanOrEqual(before + 30000);
    expect(refreshAt).toBeLessThanOrEqual(Date.now() + 30000);
  });

  it('assumes a 1 hour lifetime when neither expires_in nor tokenLifetimeMs is given', async () => {
    server = await startServer((_req, res) => json(res, 200, { access_token: 't' }));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.Json, body: {} });

    const before = Date.now();
    const refreshAt = provider.refreshAt(await provider.getBearerToken()) ?? 0;

    expect(refreshAt).toBeGreaterThanOrEqual(before + 3300000);
    expect(refreshAt).toBeLessThanOrEqual(Date.now() + 3300000);
  });

  it('prefers a longer expires_in over the default lifetime', async () => {
    server = await startServer((_req, res) => json(res, 200, { access_token: 't', expires_in: 7200 }));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.Json, body: {} });

    const before = Date.now();
    expect(provider.refreshAt(await provider.getBearerToken()) ?? 0).toBeGreaterThanOrEqual(before + 6900000);
  });

  it('rejects invalid lifetimes and margins', () => {
    expect(() => new BearerTokenProvider({ url: 'http://x', bodyType: BodyType.Json, body: {}, tokenLifetimeMs: 0 })).toThrow(/tokenLifetimeMs/);
    expect(() => new BearerTokenProvider({ url: 'http://x', bodyType: BodyType.Json, body: {}, expiryMarginMs: -1 })).toThrow(/expiryMarginMs/);
  });

  it('does not cache when cache is false', async () => {
    server = await startServer((_req, res, _body, count) => json(res, 200, { access_token: `t${count}` }));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.Json, body: {}, cache: false });

    await provider.getBearerToken();
    await expect(provider.getBearerToken()).resolves.toBe('t2');
  });
});
