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
    server = await startServer((_req, res, _body, count) => json(res, 200, { access_token: `t${count}`, expires_in: 1 }));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.Json, body: {}, expiryMarginMs: 950 });

    await expect(provider.getBearerToken()).resolves.toBe('t1');
    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(provider.getBearerToken()).resolves.toBe('t2');
    provider.invalidate();
    await expect(provider.getBearerToken()).resolves.toBe('t3');
  });

  it('does not cache when cache is false', async () => {
    server = await startServer((_req, res, _body, count) => json(res, 200, { access_token: `t${count}` }));
    const provider = new BearerTokenProvider({ url: server.url, bodyType: BodyType.Json, body: {}, cache: false });

    await provider.getBearerToken();
    await expect(provider.getBearerToken()).resolves.toBe('t2');
  });
});
