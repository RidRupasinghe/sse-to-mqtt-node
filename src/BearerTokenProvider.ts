import axios, { AxiosError } from 'axios';
import qs from 'qs';

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
      const response = await axios.post<TokenResponse>(this.url, this.serializeBody(), {
        headers: {
          ...this.headers,
          'Content-Type': this.bodyType
        }
      });

      const token = this.extractToken(response.data);

      if (!token) {
        throw new Error(`Token response did not contain any of: ${this.tokenFields.join(', ')}`);
      }

      console.log('✅ Bearer token retrieved');
      return token;
    } catch (error: unknown) {
      console.error('❌ Failed to retrieve bearer token:', BearerTokenProvider.describeError(error));
      throw error;
    }
  }

  private serializeBody(): string {
    switch (this.bodyType) {
      case BodyType.Json:
        return JSON.stringify(this.body);
      case BodyType.FormUrlEncoded:
        return qs.stringify(this.body);
    }
  }

  private extractToken(data: TokenResponse): string | undefined {
    for (const field of this.tokenFields) {
      const value = data[field];
      if (typeof value === 'string' && value) {
        return value;
      }
    }
    return undefined;
  }

  private static describeError(error: unknown): string {
    if (error instanceof AxiosError) {
      return `${error.message}${error.response ? ` (status ${error.response.status})` : ''}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
