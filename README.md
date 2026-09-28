# sse-to-mqtt

Bridge [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html) (SSE) streams to MQTT topics.

Open any number of SSE connections (GET or POST, each with its own body, headers and topic rule) and republish every event to an MQTT broker. Use it as a **CLI** driven by a JSON config file, or as a typed **library** in your own Node.js app.

- Spec-compliant SSE parsing: multi-line `data:`, `event:`, `id:`, `retry:`, and `Last-Event-ID` on reconnect
- Topic templates such as `vessels/{name}/{imoNumber}` filled from message fields
- Automatic reconnects with exponential backoff, jitter, retry limits and connect timeouts
- Optional OAuth2 client credentials with token caching and refresh on 401
- Typed lifecycle events, a pluggable logger (silent by default), and zero HTTP dependencies (built-in `fetch`)

Requires Node.js 22 or later.

## CLI

```bash
npm install -g sse-to-mqtt
# or run without installing: npx sse-to-mqtt --config connections.json
```

Create `connections.json`:

```json
[
  { "name": "ticker", "method": "GET", "url": "/ticker" },
  {
    "name": "orders",
    "method": "POST",
    "url": "/orders/stream",
    "body": { "region": "eu" },
    "topic": "{name}/{orderId}",
    "qos": 1
  }
]
```

Set the environment (a `.env` file in the working directory is loaded automatically) and start it:

```bash
export STREAMING_ENDPOINT=https://api.example.com
export MQTT_BROKER_URL=mqtt://localhost:1883
export MQTT_TOPIC=example
sse-to-mqtt --config connections.json
```

Events from `/ticker` are published to `example/ticker`; events from `/orders/stream` go to `example/orders/<orderId>`.

| Variable | Required | Description |
| --- | --- | --- |
| `STREAMING_ENDPOINT` | yes | Base URL of the SSE server. Connection `url`s are resolved against it. |
| `MQTT_BROKER_URL` | yes | e.g. `mqtt://localhost:1883`, `mqtts://broker:8883` |
| `MQTT_TOPIC` | yes | Base topic prefixed to every published topic |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | no | Broker credentials |
| `CONNECTIONS_CONFIG` | no | Config path, if `--config` is not given |
| `AUTHENTICATION_URL` | no | Enables OAuth2 client credentials; then `CLIENT_ID` and `CLIENT_SECRET` are required |
| `CLIENT_ID`, `CLIENT_SECRET`, `CLIENT_SCOPE` | no | OAuth2 client credentials (`CLIENT_SCOPE` is optional) |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn` or `error` |

The CLI stops cleanly on `SIGINT` / `SIGTERM`.

### Connection config

Each entry in the JSON array:

| Field | Type | Description |
| --- | --- | --- |
| `name` | string | Unique name, available as `{name}` in topics |
| `method` | `"GET"` \| `"POST"` | HTTP method |
| `body` | object | JSON request body; only allowed for `POST` |
| `url` | string | Absolute URL, or a path resolved against the endpoint. Defaults to the endpoint |
| `headers` | object | Extra request headers |
| `topic` | string \| string[] | Topic template relative to `MQTT_TOPIC`. Defaults to `"{name}"` |
| `qos` | `0` \| `1` \| `2` | MQTT QoS (default 0) |
| `retain` | boolean | MQTT retain flag (default false) |

The file is validated at startup; mistakes stop the CLI with a message naming the connection and field.

### Topic templates

- `{name}` is the connection name.
- `{field}` or `{nested.field}` reads a field from the event data parsed as JSON.
- If a placeholder has no value (missing, `null`, empty or an object), the event is **skipped**. Use this to filter.
- Values have `+`, `#`, `/` and NUL replaced with `_`, so message content can't add topic levels or wildcards. Literal wildcards in the template itself are rejected.
- The payload is the raw event data. Only templates that reference fields parse it as JSON, so non-JSON streams work with `{name}`-only topics.

## Library

```bash
npm install sse-to-mqtt
```

```ts
import { SseToMqttBridge, createConsoleLogger } from 'sse-to-mqtt';

const bridge = new SseToMqttBridge({
  endpoint: 'https://api.example.com',
  mqtt: { brokerUrl: 'mqtt://localhost:1883', baseTopic: 'example' },
  logger: createConsoleLogger('info'),
  connections: [
    { name: 'ticker', method: 'GET', url: '/ticker' },
    {
      name: 'orders',
      method: 'POST',
      url: '/orders/stream',
      body: { region: 'eu' },
      topic: '{name}/{orderId}',
      // Reshape or drop events before publishing (return undefined to skip)
      transform: (data) => {
        const order = JSON.parse(data);
        return order.status === 'test' ? undefined : { id: order.orderId, total: order.total };
      }
    }
  ]
});

bridge.on('published', (connection, topic) => console.log(`${connection} -> ${topic}`));
bridge.on('error', (error, connection) => console.error(connection, error.message));

await bridge.start();
// later
await bridge.stop();
```

Connection `topic` can also be a function `(data, connectionName) => string | string[] | undefined` for full control.

### Options

| Option | Description |
| --- | --- |
| `endpoint` | Base URL; each connection's `url` is resolved against it |
| `connections` | Connections as described above; `transform` and function `topic`s are library-only |
| `mqtt` | `{ brokerUrl, baseTopic, username?, password?, qos?, retain?, clientOptions? }`, or `{ client, baseTopic }` to reuse an existing [mqtt.js](https://github.com/mqttjs/MQTT.js) client (left open on `stop()`) |
| `tokenProvider` | Anything with `getBearerToken(): Promise<string>` (and optionally `invalidate()`), e.g. `BearerTokenProvider` |
| `headers` | Headers sent on every connection |
| `retry` | `{ initialDelayMs = 2000, maxDelayMs = 30000, maxRetries = Infinity, jitter = 0.2 }` |
| `connectTimeoutMs` | Fail an attempt if no response headers arrive in time (default 30000) |
| `logger` | `{ debug, info, warn, error }`; compatible with console, pino and winston. Silent by default |

### Events

| Event | Arguments |
| --- | --- |
| `connected` | `connection` |
| `disconnected` | `connection, error?` |
| `reconnecting` | `connection, delayMs, attempt` |
| `gaveUp` | `connection` (after `maxRetries`) |
| `message` | `connection, event` (`{ data, event, id? }`) |
| `published` | `connection, topic, payload` |
| `error` | `error, connection`: only emitted when you listen for it, so an unhandled `error` never crashes your process |

### Authentication

```ts
import { BearerTokenProvider, BodyType } from 'sse-to-mqtt';

const tokenProvider = new BearerTokenProvider({
  url: 'https://auth.example.com/oauth/token',
  bodyType: BodyType.FormUrlEncoded, // or BodyType.Json
  body: { grant_type: 'client_credentials', client_id: '...', client_secret: '...' }
});
```

Tokens are cached until `expires_in` (minus `expiryMarginMs`, default 30s), concurrent requests share one token fetch, and a 401 from the SSE server triggers a fresh token. Use `tokenFields` if the token isn't in `access_token` or `token`.

### Building blocks

`SseDataProvider` (a single reconnecting SSE connection), `SseParser`, `MqttPublisher` and `loadConnectionsConfig` are exported too, for custom pipelines.

## Docker

The repository's `Dockerfile` runs the CLI with `CONNECTIONS_CONFIG=config/connections.json`. Mount your own config and pass the environment:

```bash
docker build -t sse-to-mqtt .
docker run --env-file .env -v "$PWD/connections.json:/app/config/connections.json:ro" sse-to-mqtt
```

## Development

```bash
npm install
npm run typecheck && npm run lint && npm test
MQTT_TEST_URL=mqtt://localhost:1883 npm test   # also run broker integration tests
npm run build
```

A broker for the integration tests: `docker run -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf`

## License

MIT
