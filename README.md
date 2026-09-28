# sse-to-mqtt

Bridge Server-Sent Events (SSE) streams to MQTT topics.

Use it as a Node.js library or as a CLI. Streams can be GET or POST, optionally authenticated with OAuth2 client credentials. MQTT topics are built from a prefix, optional stream name, and an optional JSON field from each event.

## Install

```bash
npm install sse-to-mqtt
```

## Library

```ts
import { SseToMqtt } from 'sse-to-mqtt';

const bridge = new SseToMqtt({
  mqtt: {
    brokerUrl: process.env.MQTT_BROKER_URL!,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
  },
  topic: 'ais',
  topicKey: 'imoNumber',
  streams: [
    {
      name: 'north-sea',
      url: 'https://example.com/events',
      method: 'GET',
    },
  ],
});

bridge.start();
```

Each matching event is published to:

```text
{topic}/{stream.name}/{topicKey value}
```

For the example above: `ais/north-sea/1234567`. Events are skipped when `topicKey` is set and that field is missing.

You can also supply a function:

```ts
const bridge = new SseToMqtt({
  mqtt: { brokerUrl: 'mqtt://localhost:1883' },
  topic: ({ payload, parsed, stream }) => {
    const id = (parsed as { id?: string })?.id;
    return id ? `events/${stream.name}/${id}` : null;
  },
  streams: [{ name: 'alerts', url: 'https://example.com/sse' }],
});
```

### OAuth2 client credentials

```ts
{
  name: 'area-1',
  url: process.env.STREAMING_ENDPOINT!,
  method: 'POST',
  auth: {
    type: 'oauth2-client-credentials',
    tokenUrl: process.env.AUTHENTICATION_URL!,
    clientId: process.env.CLIENT_ID!,
    clientSecret: process.env.CLIENT_SECRET!,
    scope: process.env.CLIENT_SCOPE,
  },
  body: { modelType: 'Full', downsample: false },
}
```

Call `bridge.stop()` to abort SSE connections and disconnect MQTT.

## CLI

```bash
npx sse-to-mqtt --config ./config.json
```

`${ENV_VAR}` placeholders in the JSON file are replaced from the environment (and from `.env` if present).

```json
{
  "mqtt": {
    "brokerUrl": "${MQTT_BROKER_URL}",
    "username": "${MQTT_USERNAME}",
    "password": "${MQTT_PASSWORD}"
  },
  "topic": "ais",
  "topicKey": "imoNumber",
  "streams": [
    {
      "name": "area-1",
      "url": "https://example.com/sse",
      "method": "GET"
    }
  ]
}
```

A Barentswatch AIS example is in [`examples/barentswatch.config.json`](examples/barentswatch.config.json):

```bash
npx sse-to-mqtt --config examples/barentswatch.config.json
```

## Config reference

| Field | Description |
| --- | --- |
| `mqtt.brokerUrl` | MQTT broker URL (`mqtt://`, `mqtts://`, `ws://`, …) |
| `mqtt.username` / `mqtt.password` | Optional credentials |
| `mqtt.qos` | Publish QoS (`0`, `1`, or `2`). Default `0` |
| `mqtt.retain` | MQTT retain flag. Default `false` |
| `topic` | Topic prefix, or a function when using the library |
| `topicKey` | JSON path appended to the topic (`imoNumber`, `vessel.id`) |
| `streams[].name` | Optional topic segment and log label |
| `streams[].url` | SSE endpoint |
| `streams[].method` | `GET` or `POST` (defaults to `POST` when `body` is set) |
| `streams[].headers` | Extra HTTP headers |
| `streams[].body` | JSON body for POST streams |
| `streams[].auth` | Optional `oauth2-client-credentials` |
| `reconnect.initialMs` / `reconnect.maxMs` | Backoff for SSE reconnects |

## Docker

```bash
docker build -t sse-to-mqtt .
docker run --env-file .env -v "$PWD/config.json:/app/config.json" sse-to-mqtt
```

## License

MIT
