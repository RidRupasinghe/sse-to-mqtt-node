import axios, { AxiosError } from 'axios';
import qs from 'qs';
import dotenv from 'dotenv';

dotenv.config();

interface AuthConfig {
  authenticationUrl: string;
  clientId: string;
  clientSecret: string;
  clientScope: string;
}

interface ClientCredentialsRequest {
  client_id: string;
  client_secret: string;
  scope: string;
  grant_type: 'client_credentials';
}

interface TokenResponse {
  access_token?: string;
  token?: string;
  token_type?: string;
  expires_in?: number;
}

function getAuthConfig(): AuthConfig {
  const { AUTHENTICATION_URL, CLIENT_ID, CLIENT_SECRET, CLIENT_SCOPE } = process.env;

  if (!AUTHENTICATION_URL || !CLIENT_ID || !CLIENT_SECRET || !CLIENT_SCOPE) {
    throw new Error('Missing authentication configuration in .env');
  }

  return {
    authenticationUrl: AUTHENTICATION_URL,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    clientScope: CLIENT_SCOPE
  };
}

export async function getBearerToken(): Promise<string> {
  const config = getAuthConfig();

  const requestBody: ClientCredentialsRequest = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: config.clientScope,
    grant_type: 'client_credentials'
  };

  try {
    const response = await axios.post<TokenResponse>(config.authenticationUrl, qs.stringify(requestBody), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const token = response.data.access_token ?? response.data.token;

    if (!token) {
      throw new Error('Token response did not contain an access token');
    }

    console.log('✅ Bearer token retrieved');
    return token;
  } catch (error: unknown) {
    const message = error instanceof AxiosError
      ? `${error.message}${error.response ? ` (status ${error.response.status})` : ''}`
      : error instanceof Error ? error.message : String(error);

    console.error('❌ Failed to retrieve bearer token:', message);
    throw error;
  }
}
