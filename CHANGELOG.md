# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `BearerTokenProvider` option `tokenLifetimeMs` for token (e.g. JWT) lifetimes, and `refreshAt(token)`.
- Open SSE connections reconnect with a fresh token before the current one expires, when the token provider implements the new optional `TokenProvider.refreshAt(token)`.
- CLI environment variables `TOKEN_LIFETIME_SECONDS` and `TOKEN_REFRESH_MARGIN_SECONDS`.

### Changed

- `BearerTokenProvider` tokens without `expires_in` are now assumed to be valid for 1 hour (previously cached indefinitely).
- `BearerTokenProvider` `expiryMarginMs` now defaults to 5 minutes (was 30 seconds) and is capped at half the token lifetime.

## [0.1.2] - 2026-09-28

### Added

- Docker images for `linux/amd64` and `linux/arm64`, published on each release to Docker Hub (`ridmarupasinghe/sse-to-mqtt-node`) and GitHub Container Registry (`ghcr.io/ridrupasinghe/sse-to-mqtt-node`).

### Changed

- The Docker image no longer includes a connections config; mount one at `/config/connections.json`. It is smaller (production dependencies only), runs as a non-root user and handles `docker stop` gracefully.

## [0.1.1] - 2026-09-28

First public release.

### Added

- `SseToMqttBridge`: multiple GET/POST SSE connections published to MQTT, with typed lifecycle events.
- `sse-to-mqtt-node` CLI driven by a JSON connections file and environment variables.
- Topic templates with `{name}` and `{field.path}` placeholders, MQTT-safe value sanitizing, and skipping of unresolved messages.
- Per-connection `url`, `headers`, `qos`, `retain` and payload `transform`.
- Spec-compliant SSE parsing with `Last-Event-ID` resume and server `retry:` support.
- Reconnect backoff with jitter, `maxRetries` and `connectTimeoutMs`.
- `BearerTokenProvider` with JSON or form bodies, token caching and refresh after 401.
- `MqttPublisher` accepting broker settings or an existing mqtt.js client.
- Pluggable `Logger`; the library is silent by default.
