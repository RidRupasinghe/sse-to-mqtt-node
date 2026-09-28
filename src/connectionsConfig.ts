import fs from 'fs';
import { SseConnection } from './SseToMqttBridge';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateConnection(value: unknown, index: number): SseConnection {
  const where = `connection #${index + 1}`;

  if (!isPlainObject(value)) {
    throw new Error(`${where} must be an object`);
  }

  const { name, method, body, headers, topic } = value;

  if (typeof name !== 'string' || !name) {
    throw new Error(`${where} requires a "name"`);
  }
  if (method !== 'GET' && method !== 'POST') {
    throw new Error(`"${name}": "method" must be "GET" or "POST"`);
  }
  if (method === 'GET' && body !== undefined) {
    throw new Error(`"${name}": GET connections cannot have a "body"`);
  }
  if (body !== undefined && !isPlainObject(body)) {
    throw new Error(`"${name}": "body" must be a JSON object`);
  }
  if (headers !== undefined && !(isPlainObject(headers) && Object.values(headers).every((h) => typeof h === 'string'))) {
    throw new Error(`"${name}": "headers" must be an object of strings`);
  }
  if (topic !== undefined && typeof topic !== 'string' && !isStringArray(topic)) {
    throw new Error(`"${name}": "topic" must be a string or an array of strings`);
  }

  const common = {
    name,
    headers: headers as Record<string, string> | undefined,
    topic: topic as string | string[] | undefined
  };

  return method === 'POST'
    ? { ...common, method, body: body as Record<string, unknown> | undefined }
    : { ...common, method };
}

export function loadConnectionsConfig(path: string): SseConnection[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (error: unknown) {
    throw new Error(`Failed to read connections config "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Connections config "${path}" must be a non-empty array`);
  }

  return parsed.map(validateConnection);
}
