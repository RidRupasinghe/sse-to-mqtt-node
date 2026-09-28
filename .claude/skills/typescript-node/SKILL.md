---
name: typescript-node
description: TypeScript and Node.js patterns for sse-to-mqtt. Use when writing or refactoring any file in src/, adding types, handling async/streams/errors, adding dependencies, or verifying a change compiles and behaves correctly.
---

# TypeScript & Node.js in sse-to-mqtt

## Before editing

1. Read the file and its callers (`grep -rn "<symbol>" src/`). Files may have been changed by the user since you last saw them; build on the current version.
2. Check `tsconfig.json`: CommonJS output, target ES2020, `strict`, `declaration`, `rootDir: src`.

## Writing code

- **Types first.** Model inputs as `interface …Options`; model either/or shapes as discriminated unions:
  ```ts
  export type SseRequest<TBody extends object> =
    | { method: 'GET'; body?: never }
    | { method: 'POST'; body?: TBody };
  ```
- **No escape hatches.** Avoid `any`, `as` casts on untrusted data and `!` assertions. Parse external data (`JSON.parse`, HTTP responses, config files) as `unknown` and narrow with type guards, as `src/connectionsConfig.ts` does.
- **Errors.** `catch (error: unknown)`, narrow with `instanceof AxiosError` / `instanceof Error`, log a short message, and rethrow when the caller must decide. Never let a rejected promise go unhandled; for fire-and-forget calls attach `.catch()` or prefix with `void` only when the function handles its own errors.
- **Async.** Don't `await` inside loops when calls are independent; use `Promise.all`. Keep timers (`setTimeout`) and `AbortController`s on the instance so `stop()` can cancel them.
- **Streams and events.** Register listeners once per connection. Adding `once(...)` listeners per message leaks listeners and duplicates work.
- **Config boundary.** Only `src/app.ts` reads `process.env` / `dotenv`. Library classes receive values through options.
- **Exports.** Anything new and public must be exported from `src/index.ts`, with types exported via `export type`.
- **Dependencies.** Prefer Node built-ins (`fs`, `stream`, `readline`, `AbortController`). Before adding a package, check it's maintained and ships types; put type-only packages in `devDependencies`. Note: `eventsource` and `@types/ws` are currently unused.

## Verifying

Run all of these that apply, and report which ones you ran:

```bash
npx tsc --noEmit                     # always
npm run build                        # when exports, tsconfig or package.json change
npx ts-node -T -e "<script>"         # exercise real classes/functions with sample inputs
```

- To check that a type *rejects* bad input, write a temporary file with `// @ts-expect-error`, run `tsc --noEmit`, then delete the file.
- Write temp files for experiments to the session scratchpad, not the repo.
- For behaviour needing a broker, `mosquitto/` holds a local Mosquitto config. If you couldn't run against a real broker or SSE endpoint, say so.
