import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConnectionsConfig } from '../src/connectionsConfig';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sse-to-mqtt-'));
let counter = 0;

function writeConfig(content: unknown): string {
  const file = path.join(dir, `config-${counter++}.json`);
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('loadConnectionsConfig', () => {
  it('loads GET and POST connections with all fields', () => {
    const connections = loadConnectionsConfig(writeConfig([
      { name: 'a', method: 'GET', url: '/a', topic: '{name}', qos: 1, retain: true, headers: { 'X-Key': 'k' } },
      { name: 'b', method: 'POST', body: { q: 1 }, topic: ['{name}', '{id}'] }
    ]));

    expect(connections).toEqual([
      { name: 'a', method: 'GET', url: '/a', topic: '{name}', qos: 1, retain: true, headers: { 'X-Key': 'k' } },
      { name: 'b', method: 'POST', body: { q: 1 }, topic: ['{name}', '{id}'], url: undefined, qos: undefined, retain: undefined, headers: undefined }
    ]);
  });

  it.each([
    ['a non-array', { name: 'a' }, /non-empty array/],
    ['an empty array', [], /non-empty array/],
    ['a missing name', [{ method: 'GET' }], /requires a "name"/],
    ['an unknown method', [{ name: 'a', method: 'PUT' }], /"GET" or "POST"/],
    ['a body on GET', [{ name: 'a', method: 'GET', body: {} }], /cannot have a "body"/],
    ['a non-object body', [{ name: 'a', method: 'POST', body: 'x' }], /JSON object/],
    ['non-string headers', [{ name: 'a', method: 'GET', headers: { a: 1 } }], /object of strings/],
    ['a numeric topic', [{ name: 'a', method: 'GET', topic: 5 }], /"topic"/],
    ['an invalid qos', [{ name: 'a', method: 'GET', qos: 3 }], /"qos"/],
    ['a non-boolean retain', [{ name: 'a', method: 'GET', retain: 'yes' }], /"retain"/]
  ])('rejects %s', (_label, content, message) => {
    expect(() => loadConnectionsConfig(writeConfig(content))).toThrow(message);
  });

  it('reports invalid JSON and missing files with the path', () => {
    expect(() => loadConnectionsConfig(writeConfig('{nope'))).toThrow(/Failed to read connections config/);
    expect(() => loadConnectionsConfig(path.join(dir, 'missing.json'))).toThrow(/missing\.json/);
  });
});
