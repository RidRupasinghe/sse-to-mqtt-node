import { HttpError, describeError } from './errors';
import { Logger, defaultLogger } from './logger';

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
  /** Reuse the token until it expires (from `expires_in`) or is invalidated. Default true. */
  cache?: boolean;
  /** Refresh this long before `expires_in` runs out. Default 30000. */
  expiryMarginMs?: number;
  logger?: Logger;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class BearerTokenProvider<TBody extends object = Record<string, unknown>> {
  private readonly url: string;
  private readonly body: TBody;
  private readonly bodyType: BodyType;
  private readonly headers: Record<string, string>;
  private readonly tokenFields: string[];
  private readonly cache: boolean;
  private readonly expiryMarginMs: number;
  private readonly logger: Logger;

  private cached?: CachedToken;
  private pending?: Promise<string>;

  constructor(options: BearerTokenProviderOptions<TBody>) {
    if (!options.url) {
      throw new Error('BearerTokenProvider requires a url');
    }

    this.url = options.url;
    this.body = options.body;
    this.bodyType = options.bodyType;
    this.headers = options.headers ?? {};
    this.tokenFields = options.tokenFields ?? ['access_token', 'token'];
    this.cache = options.cache ?? true;
    this.expiryMarginMs = options.expiryMarginMs ?? 30000;
    this.logger = options.logger ?? defaultLogger;
  }

  /** Returns a cached token when still valid; concurrent callers share one request. */
  public getBearerToken(): Promise<string> {
    if (this.cache && this.cached && Date.now() < this.cached.expiresAt) {
      return Promise.resolve(this.cached.token);
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
    this.cached = undefined;
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

      if (this.cache) {
        this.cached = { token, expiresAt: this.computeExpiry(data) };
      }

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

  private computeExpiry(data: unknown): number {
    const expiresIn = (data as TokenResponse)['expires_in'];
    const seconds = typeof expiresIn === 'string' ? Number(expiresIn) : expiresIn;

    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    return Date.now() + Math.max(0, seconds * 1000 - this.expiryMarginMs);
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
