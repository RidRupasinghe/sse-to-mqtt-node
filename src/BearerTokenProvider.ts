import { HttpError, describeError } from './errors';
import { Logger, defaultLogger } from './logger';

// Assumed token lifetime when neither the response nor the options give one
const DEFAULT_TOKEN_LIFETIME_MS = 3600000;

export enum BodyType {
  Json = 'application/json',
  FormUrlEncoded = 'application/x-www-form-urlencoded'
}

type TokenResponse = Record<string, unknown>;

export interface BearerTokenProviderOptions<TBody extends object> {
  url: string;
  body: TBody;
  bodyType: BodyType;
  headers?: Record<string, string>;
  // Response fields checked in order for the token
  tokenFields?: string[];
  /** Reuse the token until it is due for refresh or is invalidated. Default true. */
  cache?: boolean;
  /**
   * How long a token is valid, e.g. a JWT's lifetime. When the response also has `expires_in`,
   * the shorter one is used. Default: `expires_in`, or 3600000 (1 hour) without it.
   */
  tokenLifetimeMs?: number;
  /** Replace a token this long before it expires, capped at half its lifetime. Default 300000 (5 minutes). */
  expiryMarginMs?: number;
  logger?: Logger;
}

interface IssuedToken {
  token: string;
  /** When the token is due for refresh (expiry minus margin); Infinity when unknown. */
  refreshAt: number;
}

export class BearerTokenProvider<TBody extends object = Record<string, unknown>> {
  private readonly url: string;
  private readonly body: TBody;
  private readonly bodyType: BodyType;
  private readonly headers: Record<string, string>;
  private readonly tokenFields: string[];
  private readonly cache: boolean;
  private readonly tokenLifetimeMs?: number;
  private readonly expiryMarginMs: number;
  private readonly logger: Logger;

  private current?: IssuedToken;
  private pending?: Promise<string>;

  constructor(options: BearerTokenProviderOptions<TBody>) {
    if (!options.url) {
      throw new Error('BearerTokenProvider requires a url');
    }
    if (options.tokenLifetimeMs !== undefined && !(Number.isFinite(options.tokenLifetimeMs) && options.tokenLifetimeMs > 0)) {
      throw new Error('BearerTokenProvider tokenLifetimeMs must be a positive number');
    }
    if (options.expiryMarginMs !== undefined && !(Number.isFinite(options.expiryMarginMs) && options.expiryMarginMs >= 0)) {
      throw new Error('BearerTokenProvider expiryMarginMs must be zero or a positive number');
    }

    this.url = options.url;
    this.body = options.body;
    this.bodyType = options.bodyType;
    this.headers = options.headers ?? {};
    this.tokenFields = options.tokenFields ?? ['access_token', 'token'];
    this.cache = options.cache ?? true;
    this.tokenLifetimeMs = options.tokenLifetimeMs;
    this.expiryMarginMs = options.expiryMarginMs ?? 300000;
    this.logger = options.logger ?? defaultLogger;
  }

  /** Returns a cached token when still valid; concurrent callers share one request. */
  public getBearerToken(): Promise<string> {
    if (this.cache && this.current && Date.now() < this.current.refreshAt) {
      return Promise.resolve(this.current.token);
    }

    if (!this.pending) {
      this.pending = this.fetchToken().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }

  /** Drops the cached token, e.g. after the server rejected it with 401. */
  public invalidate(): void {
    this.current = undefined;
  }

  /**
   * When `token` is due for refresh (epoch ms), or undefined if the expiry is unknown or `token`
   * is no longer the current one. Connections use this to reconnect before their token expires.
   */
  public refreshAt(token: string): number | undefined {
    if (this.current?.token !== token || !Number.isFinite(this.current.refreshAt)) return undefined;
    return this.current.refreshAt;
  }

  private async fetchToken(): Promise<string> {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...this.headers,
          'Content-Type': this.bodyType
        },
        body: this.serializeBody()
      });

      if (!response.ok) {
        throw new HttpError(response.status, response.statusText, this.url);
      }

      const data: unknown = await response.json();
      const token = this.extractToken(data);

      if (!token) {
        throw new Error(`Token response did not contain any of: ${this.tokenFields.join(', ')}`);
      }

      this.current = { token, refreshAt: this.computeRefreshAt(data) };

      this.logger.debug('Bearer token retrieved');
      return token;
    } catch (error: unknown) {
      this.logger.error(`Failed to retrieve bearer token: ${describeError(error)}`);
      throw error;
    }
  }

  private serializeBody(): string {
    switch (this.bodyType) {
      case BodyType.Json:
        return JSON.stringify(this.body);
      case BodyType.FormUrlEncoded:
        return BearerTokenProvider.toFormUrlEncoded(this.body);
    }
  }

  // Form bodies are flat: undefined/null fields are omitted, nested objects are rejected
  private static toFormUrlEncoded(body: object): string {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'object') {
        throw new Error(`Form-encoded token body field "${key}" must be a primitive value`);
      }
      params.append(key, String(value));
    }

    return params.toString();
  }

  private computeRefreshAt(data: unknown): number {
    const expiresIn = (data as TokenResponse)['expires_in'];
    const seconds = typeof expiresIn === 'string' ? Number(expiresIn) : expiresIn;
    const lifetimes: number[] = [];

    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
      lifetimes.push(seconds * 1000);
    }
    if (this.tokenLifetimeMs !== undefined) {
      lifetimes.push(this.tokenLifetimeMs);
    }

    const lifetimeMs = lifetimes.length > 0 ? Math.min(...lifetimes) : DEFAULT_TOKEN_LIFETIME_MS;
    return Date.now() + lifetimeMs - Math.min(this.expiryMarginMs, lifetimeMs / 2);
  }

  private extractToken(data: unknown): string | undefined {
    if (data === null || typeof data !== 'object') return undefined;

    for (const field of this.tokenFields) {
      const value = (data as TokenResponse)[field];
      if (typeof value === 'string' && value) {
        return value;
      }
    }
    return undefined;
  }
}
