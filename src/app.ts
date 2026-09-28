import dotenv from 'dotenv';
import { BearerTokenProvider, BodyType } from './BearerTokenProvider';
import { SseToMqttBridge } from './SseToMqttBridge';
import { TokenProvider } from './SseDataProvider';
import { loadConnectionsConfig } from './connectionsConfig';
import { LogLevel, createConsoleLogger } from './logger';

dotenv.config();

interface ClientCredentialsBody {
  client_id: string;
  client_secret: string;
  scope?: string;
  grant_type: 'client_credentials';
}

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function parseLogLevel(value: string | undefined): LogLevel {
  if (!value) return 'info';
  if (!LOG_LEVELS.includes(value as LogLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }
  return value as LogLevel;
}

const logger = createConsoleLogger(parseLogLevel(process.env.LOG_LEVEL));

function requireEnv(...keys: string[]): Record<string, string> {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing configuration in .env: ${missing.join(', ')}`);
  }
  return Object.fromEntries(keys.map((key) => [key, process.env[key] as string]));
}

// OAuth2 client credentials, enabled only when AUTHENTICATION_URL is set
function createTokenProvider(): TokenProvider | undefined {
  if (!process.env.AUTHENTICATION_URL) return undefined;

  const env = requireEnv('AUTHENTICATION_URL', 'CLIENT_ID', 'CLIENT_SECRET');

  return new BearerTokenProvider<ClientCredentialsBody>({
    url: env.AUTHENTICATION_URL,
    bodyType: BodyType.FormUrlEncoded,
    logger,
    body: {
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      scope: process.env.CLIENT_SCOPE || undefined,
      grant_type: 'client_credentials'
    }
  });
}

const env = requireEnv('STREAMING_ENDPOINT', 'MQTT_BROKER_URL', 'MQTT_TOPIC');

const bridge = new SseToMqttBridge({
  endpoint: env.STREAMING_ENDPOINT,
  logger,
  tokenProvider: createTokenProvider(),
  mqtt: {
    brokerUrl: env.MQTT_BROKER_URL,
    baseTopic: env.MQTT_TOPIC,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
  },
  connections: loadConnectionsConfig(process.env.CONNECTIONS_CONFIG || 'config/connections.json')
});

void bridge.start();
