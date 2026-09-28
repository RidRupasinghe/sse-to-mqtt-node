#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import dotenv from 'dotenv';
import { BearerTokenProvider, BodyType } from './BearerTokenProvider';
import { SseToMqttBridge } from './SseToMqttBridge';
import { TokenProvider } from './SseDataProvider';
import { loadConnectionsConfig } from './connectionsConfig';
import { LogLevel, Logger, createConsoleLogger } from './logger';

const USAGE = `Usage: sse-to-mqtt-node --config <connections.json>

Bridges Server-Sent Events streams to MQTT topics.

Options:
  -c, --config <path>   Connections config file (or CONNECTIONS_CONFIG)
  -h, --help            Show this help
  -v, --version         Show the version

Environment (a .env file in the working directory is loaded):
  STREAMING_ENDPOINT    SSE endpoint URL (required)
  MQTT_BROKER_URL       e.g. mqtt://localhost:1883 (required)
  MQTT_TOPIC            Base topic for all messages (required)
  MQTT_USERNAME, MQTT_PASSWORD
  AUTHENTICATION_URL    Enables OAuth2 client credentials; then CLIENT_ID and
                        CLIENT_SECRET are required, CLIENT_SCOPE is optional
  LOG_LEVEL             debug | info | warn | error (default info)`;

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

function requireEnv(...keys: string[]): Record<string, string> {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  return Object.fromEntries(keys.map((key) => [key, process.env[key] as string]));
}

function readVersion(): string {
  const packageJson: unknown = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const version = (packageJson as { version?: unknown }).version;
  return typeof version === 'string' ? version : 'unknown';
}

// OAuth2 client credentials, enabled only when AUTHENTICATION_URL is set
function createTokenProvider(logger: Logger): TokenProvider | undefined {
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

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' }
    }
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (values.version) {
    console.log(readVersion());
    return;
  }

  dotenv.config();

  const configPath = values.config ?? process.env.CONNECTIONS_CONFIG;
  if (!configPath) {
    throw new Error('No connections config given. Use --config <path> or set CONNECTIONS_CONFIG.');
  }

  const logger = createConsoleLogger(parseLogLevel(process.env.LOG_LEVEL));
  const env = requireEnv('STREAMING_ENDPOINT', 'MQTT_BROKER_URL', 'MQTT_TOPIC');

  const bridge = new SseToMqttBridge({
    endpoint: env.STREAMING_ENDPOINT,
    logger,
    tokenProvider: createTokenProvider(logger),
    mqtt: {
      brokerUrl: env.MQTT_BROKER_URL,
      baseTopic: env.MQTT_TOPIC,
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD
    },
    connections: loadConnectionsConfig(configPath)
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info(`Received ${signal}, shutting down`);
    bridge.stop().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await bridge.start();
}

main().catch((error: unknown) => {
  console.error(`sse-to-mqtt-node: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
