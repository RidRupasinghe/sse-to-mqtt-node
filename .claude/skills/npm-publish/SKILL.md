---
name: npm-publish
description: Prepare, version and publish sse-to-mqtt to the npm registry. Use when the user asks to publish, release, bump the version, check what the package ships, or fix package.json metadata.
---

# Publishing sse-to-mqtt to npm

Publishing is public and effectively irreversible (a version number can never be reused, and unpublishing is restricted). **Always get explicit confirmation before `npm publish` and before pushing tags.**

## 1. Check package.json

- `name` — `sse-to-mqtt` was free on npm when checked; re-check with `npm view <name>` (a 404 means free). Use a scope (`@user/sse-to-mqtt`) if taken.
- `version` — follow semver against the public API in `src/index.ts`: breaking export/option changes → major, new features → minor, fixes → patch.
- `main: dist/index.js`, `types: dist/index.d.ts`. Consider an `exports` map.
- `files: ["dist", "README.md", "LICENSE"]` so only build output ships. Without it, npm falls back to `.gitignore`, and `src/app.ts` and `config/` could be published.
- `author`, `description`, `repository`, `keywords`, `license` (MIT; add a `LICENSE` file), `engines.node` (Dockerfile uses Node 22).
- `scripts.prepublishOnly: "npm run build"` so a stale `dist/` is never published.
- `dependencies` only hold runtime needs of the library. `dotenv` is only used by `src/app.ts`; decide with the user whether the app stays in this package.

## 2. Build clean and inspect

```bash
rm -rf dist && npm run build
npm pack --dry-run          # lists exactly what would ship; check for .env, config, src
```

Nothing secret or deployment-specific should appear. `dist/` can contain leftovers from renamed files, which is why you rebuild from clean.

## 3. Smoke-test the tarball

```bash
npm pack                                   # creates sse-to-mqtt-<version>.tgz
cd "$SCRATCHPAD" && npm init -y && npm i /path/to/sse-to-mqtt-<version>.tgz
node -e "const m = require('sse-to-mqtt'); console.log(Object.keys(m))"
```

Also check the types resolve from a small `.ts` file importing `SseToMqttBridge`.

## 4. Release (after confirmation)

```bash
npm version <patch|minor|major>   # bumps, commits and tags
npm publish                        # add --access public for scoped names
git push && git push --tags
```

`npm whoami` must succeed first. If the user isn't logged in, ask them to run `! npm login` themselves.

## 5. Report

Give the published name@version, the `npm pack` file list, and anything skipped.
