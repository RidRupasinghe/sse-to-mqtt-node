# sse-to-mqtt

A general-purpose bridge that opens one or more Server-Sent Events (SSE) connections to a single HTTP endpoint and republishes each event to an MQTT broker. It ships both as an npm library (`src/index.ts`) and as a runnable, config-driven app (`src/app.ts`, also the Docker entrypoint).

This repo is **not** tied to any particular data provider. Provider-specific details (request bodies, topic rules, credentials) belong in config or `.env`, never in `src/`.

## Commands

- `npm run build` — compile `src/` to `dist/` with `tsc` (emits `.d.ts` files)
- `npx tsc --noEmit` — type-check only; run after every change
- `npm run dev` — run `src/app.ts` with nodemon + ts-node
- `npm start` — run the built app (`dist/app.js`)
- `docker build -t sse-to-mqtt .` — the image runs `npm start`

There is no test suite or linter yet. Verify behaviour with `npx ts-node -T -e "..."` scripts against the real classes, and say so when something was only type-checked.

## Layout

| File | Role |
| --- | --- |
| `src/index.ts` | Package entry. Only re-exports the library; no side effects. |
| `src/SseToMqttBridge.ts` | Wires connections to MQTT; resolves topic templates. |
| `src/SseDataProvider.ts` | One SSE connection: request, line parsing, reconnect with backoff, `stop()`. |
| `src/MqttPublisher.ts` | Thin typed wrapper over `mqtt`; builds `baseTopic/…segments`. |
| `src/BearerTokenProvider.ts` | Generic token fetcher (JSON or form body, configurable token field). |
| `src/connectionsConfig.ts` | Loads and validates the JSON connections file. |
| `src/app.ts` | Runnable app: reads `.env`, loads config, starts the bridge. |
| `config/connections.json` | Connection list for the app (`CONNECTIONS_CONFIG` overrides the path). |

## Configuration

`.env` (never commit it): `STREAMING_ENDPOINT`, `MQTT_BROKER_URL`, `MQTT_TOPIC` are required; `MQTT_USERNAME`, `MQTT_PASSWORD` optional. OAuth2 client credentials are enabled only when `AUTHENTICATION_URL` is set, then `CLIENT_ID` and `CLIENT_SECRET` are required and `CLIENT_SCOPE` is optional.

Connection entries: `name`, `method` (`GET` | `POST`), `body` (POST only), `headers`, `topic`. Topics may use `{name}` and `{field.path}` placeholders from the JSON message; a message whose placeholder cannot be resolved is skipped.

## Conventions

- **Classes with an options object.** Each building block is a class whose constructor takes a typed `…Options` object and validates it. Library classes never read `process.env`; only `app.ts` does.
- **Strict typing.** `strict` is on. No `any`, no non-null `!` on env values; catch as `unknown` and narrow. Use discriminated unions for mutually exclusive shapes (see `SseRequest`).
- **Generic over provider data.** Request bodies are type parameters (`TBody`), not hard-coded interfaces.
- **File names** are PascalCase for class files, camelCase otherwise. When renaming, use `git mv` and update every import.
- **Logging** uses `console` with the existing emoji prefixes (✅ ❌ ⚠️ 🔁 📡 🚀). Never log tokens, secrets or full axios error objects; use the `describeError` pattern.
- **Public API.** Anything exported from `src/index.ts` is public. Changing it is a semver decision; export types with `export type`.
- 2-space indentation, single quotes, semicolons.

## Skills

Project skills in `.claude/skills/`:
- `typescript-node` — TypeScript/Node patterns and verification for this codebase
- `npm-publish` — preparing and publishing the package to npm
- `engineering-workflow` — how to scope, change, verify and report work here
