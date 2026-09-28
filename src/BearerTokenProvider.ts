import { HttpError, describeError } from './errors';

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
}

export class BearerTokenProvider<TBody extends object = Record<string, unknown>> {
  private readonly url: string;
  private readonly body: TBody;
  private readonly bodyType: BodyType;
  private readonly headers: Record<string, string>;
  private readonly tokenFields: string[];

  constructor(options: BearerTokenProviderOptions<TBody>) {
    if (!options.url) {
      throw new Error('BearerTokenProvider requires a url');
    }

    this.url = options.url;
    this.body = options.body;
    this.bodyType = options.bodyType;
    this.headers = options.headers ?? {};
    this.tokenFields = options.tokenFields ?? ['access_token', 'token'];
  }

  public async getBearerToken(): Promise<string> {
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

      console.log('✅ Bearer token retrieved');
      return token;
    } catch (error: unknown) {
      console.error('❌ Failed to retrieve bearer token:', describeError(error));
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
