# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Docker image published to `ghcr.io/ridrupasinghe/sse-to-mqtt-node` for `linux/amd64` and `linux/arm64` on each release.

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
