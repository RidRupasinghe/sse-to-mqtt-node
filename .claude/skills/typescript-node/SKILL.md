---
name: typescript-node
description: TypeScript and Node.js patterns for sse-to-mqtt-node. Use when writing or refactoring any file in src/, adding types, handling async/streams/errors, adding dependencies, or verifying a change compiles and behaves correctly.
---

# TypeScript & Node.js in sse-to-mqtt-node

## Before editing

1. Read the file and its callers (`grep -rn "<symbol>" src/`). Files may have been changed by the user since you last saw them; build on the current version.
2. Check `tsconfig.json`: CommonJS output, target ES2022, `strict`, `declaration`, `rootDir: src`. `tsconfig.test.json` extends it to type-check `test/` too.

## Writing code

- **Types first.** Model inputs as `interface …Options`; model either/or shapes as discriminated unions:
  ```ts
  export type SseRequest<TBody extends object> =
    | { method: 'GET'; body?: never }
    | { method: 'POST'; body?: TBody };
  ```
- **No escape hatches.** Avoid `any`, `as` casts on untrusted data and `!` assertions. Parse external data (`JSON.parse`, HTTP responses, config files) as `unknown` and narrow with type guards, as `src/connectionsConfig.ts` does.
- **Errors.** `catch (error: unknown)`, narrow with `instanceof HttpError` / `instanceof Error`, log a short message via `describeError`, and rethrow (with `{ cause }` when wrapping) when the caller must decide. Never let a rejected promise go unhandled; for fire-and-forget calls attach `.catch()` or prefix with `void` only when the function handles its own errors.
- **Async.** Don't `await` inside loops when calls are independent; use `Promise.all`. Keep timers (`setTimeout`) and `AbortController`s on the instance so `stop()` can cancel them.
- **Streams and events.** Register listeners once per connection. Adding `once(...)` listeners per message leaks listeners and duplicates work.
- **Config boundary.** Only `src/cli.ts` reads `process.env` / `dotenv` or writes to the console. Library classes receive values and a `Logger` through options.
- **Exports.** Anything new and public must be exported from `src/index.ts`, with types exported via `export type`.
- **Dependencies.** Runtime deps are only `mqtt` and `dotenv` (CLI). Prefer Node built-ins (`fetch`, `URLSearchParams`, `stream`, `readline`, `AbortController`, `util.parseArgs`). Before adding a package, check it's maintained, ships types and supports the `engines` range (Node 22+); put tooling in `devDependencies`.

## Verifying

Run all of these that apply, and report which ones you ran:

```bash
npm run typecheck && npm run lint    # always
npm test                             # always; add or update tests in test/ for behaviour changes
MQTT_TEST_URL=mqtt://127.0.0.1:1883 npm test   # when bridge/publisher behaviour changes
npm run build                        # when exports, tsconfig or package.json change
```

- To check that a type *rejects* bad input, write a temporary file with `// @ts-expect-error`, run `tsc --noEmit`, then delete the file.
- Write temp files for experiments to the session scratchpad, not the repo.
- Use `test/httpServer.ts` (`startServer`, `sendEvents`) for SSE/HTTP behaviour. It calls `flushHeaders()`: without it Node sends no headers until the first write, and `fetch` waits.
- For a broker, start a throwaway one: `docker run -d -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf`. Don't publish test traffic to the maintainer's own broker. If you couldn't run against a real broker or SSE endpoint, say so.
