import mqtt, { MqttClient } from 'mqtt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SseToMqttBridge } from '../src/SseToMqttBridge';
import { TestServer, sendEvents, startServer } from './httpServer';

// Integration tests need a broker, e.g.: docker run -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
const BROKER = process.env.MQTT_TEST_URL;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!BROKER)('SseToMqttBridge (needs MQTT_TEST_URL)', () => {
  let server: TestServer;
  let subscriber: MqttClient;
  let baseTopic: string;
  let received: string[];
  let bridge: SseToMqttBridge | undefined;

  beforeEach(async () => {
    server = await startServer((req, res, body) => {
      if (req.url === '/a') sendEvents(res, ['data: {"id":1}\n\n', 'data: {"x":1}\n\n'], false);
      else if (req.url === '/b') sendEvents(res, [`data: {"id":2,"body":${body || 'null'}}\n\n`], false);
      else sendEvents(res, [], false);
    });
    baseTopic = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    received = [];
    subscriber = await mqtt.connectAsync(BROKER as string);
    subscriber.on('message', (topic, payload) => received.push(`${topic.slice(baseTopic.length + 1)}=${payload.toString()}`));
    await subscriber.subscribeAsync(`${baseTopic}/#`);
  });

  afterEach(async () => {
    await bridge?.stop();
    await subscriber.endAsync();
    await server.close();
  });

  it('publishes each connection to its resolved topic and skips unresolved messages', async () => {
    bridge = new SseToMqttBridge({
      endpoint: server.url,
      mqtt: { brokerUrl: BROKER as string, baseTopic },
      connections: [
        { name: 'a', method: 'GET', url: '/a', topic: '{name}/{id}' },
        { name: 'b', method: 'POST', url: '/b', body: { q: 1 } }
      ]
    });
    await bridge.start();
    await wait(300);

    expect(received.sort()).toEqual(['a/1={"id":1}', 'b={"id":2,"body":{"q":1}}']);
  });

  it('applies transforms and emits lifecycle events', async () => {
    const events: string[] = [];
    bridge = new SseToMqttBridge({
      endpoint: server.url,
      mqtt: { brokerUrl: BROKER as string, baseTopic },
      connections: [{ name: 'a', method: 'GET', url: '/a', transform: (data) => (data.includes('id') ? { wrapped: JSON.parse(data) } : undefined) }]
    });
    bridge.on('connected', (name) => events.push(`connected ${name}`));
    bridge.on('published', (name, topic) => events.push(`published ${name} ${topic}`));
    await bridge.start();
    await wait(300);

    expect(received).toEqual(['a={"wrapped":{"id":1}}']);
    expect(events).toEqual(['connected a', 'published a a']);
  });

  it('leaves a client passed in open after stop()', async () => {
    const client = await mqtt.connectAsync(BROKER as string);
    bridge = new SseToMqttBridge({ endpoint: server.url, mqtt: { client, baseTopic }, connections: [{ name: 'a', method: 'GET', url: '/a' }] });
    await bridge.start();
    await wait(200);
    await bridge.stop();
    bridge = undefined;

    expect(client.connected).toBe(true);
    await client.endAsync();
  });
});
