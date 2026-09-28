# sse-to-mqtt-node

A general-purpose bridge that opens one or more Server-Sent Events (SSE) connections and republishes each event to an MQTT broker. It ships as an npm library (`src/index.ts`) and as a config-driven CLI (`src/cli.ts`, the `sse-to-mqtt-node` bin and the Docker entrypoint). User-facing docs live in `README.md`.

This repo is **not** tied to any data provider. Provider-specific details (request bodies, topic rules, credentials) belong in config or `.env`, never in `src/`. `config/connections.json` is the maintainer's own deployment config and is not published.

## Commands

- `npm run typecheck`: type-check `src/` and `test/` (run after every change)
- `npm run lint`: ESLint with typescript-eslint strict rules
- `npm test`: vitest unit tests; set `MQTT_TEST_URL=mqtt://localhost:1883` to also run broker integration tests
- `npm run build`: clean `dist/` and compile with `tsc` (emits `.d.ts`)
- `npm run dev`: run the CLI from source with nodemon + ts-node
- `npm start`: run the built CLI (`dist/cli.js`)

A throwaway broker for integration tests: `docker run -d -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf`. CI (`.github/workflows/ci.yml`) runs all of the above on Node 22 and 24 and checks the npm package contents.

## Layout

| File | Role |
| --- | --- |
| `src/index.ts` | Package entry. Only re-exports the public API; no side effects. |
| `src/SseToMqttBridge.ts` | Typed EventEmitter wiring connections to MQTT; per-connection url/qos/retain/transform. |
| `src/SseDataProvider.ts` | One SSE connection: fetch, reconnect backoff with jitter, timeouts, hooks, `stop()`. |
| `src/SseParser.ts` | Spec-compliant SSE line parser (`data`, `event`, `id`, `retry`). |
| `src/topicTemplate.ts` | `{name}` / `{field.path}` topic templates and MQTT-safe sanitizing. |
| `src/MqttPublisher.ts` | Wrapper over mqtt.js; owns its client or reuses one passed in. |
| `src/BearerTokenProvider.ts` | Token fetcher (JSON or form body) with caching and `invalidate()`. |
| `src/connectionsConfig.ts` | Loads and validates the JSON connections file. |
| `src/logger.ts` | `Logger` interface, console and silent loggers. |
| `src/errors.ts` | `HttpError`, `describeError`. |
| `src/cli.ts` | CLI: args, `.env`, logger, signal handling. The only file that reads `process.env`. |
| `test/` | vitest tests; `httpServer.ts` is a local SSE/HTTP test server helper. |

## Conventions

- **Classes with an options object.** Each building block is a class whose constructor takes a typed `…Options` object and validates it. Library code never reads `process.env` or writes to the console; it logs through the injected `Logger` (silent by default).
- **Strict typing.** No `any`, no `!` on external values; catch as `unknown` and narrow. Use discriminated unions for either/or shapes (`SseRequest`, `MqttPublisherOptions`). Document public options with JSDoc.
- **Generic over provider data.** Request bodies are type parameters (`TBody`), not hard-coded interfaces.
- **HTTP** uses Node's built-in `fetch`; don't add HTTP client dependencies.
- **Errors** thrown with context keep the original as `{ cause }`. Never log tokens or secrets.
- **Public API.** Anything exported from `src/index.ts` is public and follows semver (0.x: breaking changes bump the minor). Export types with `export type`, and record user-visible changes in `CHANGELOG.md`.
- **File names** are PascalCase for class files, camelCase otherwise. Rename with `git mv`.
- 2-space indentation, single quotes, semicolons.

## Skills

Project skills in `.claude/skills/`:
- `typescript-node`: TypeScript/Node patterns and verification for this codebase
- `npm-publish`: preparing and publishing the package to npm
- `engineering-workflow`: how to scope, change, verify and report work here
