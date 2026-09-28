---
name: npm-publish
description: Prepare, version and publish sse-to-mqtt-node to the npm registry. Use when the user asks to publish, release, bump the version, check what the package ships, or fix package.json metadata.
---

# Publishing sse-to-mqtt-node to npm

Publishing is public and effectively irreversible (a version number can never be reused, and unpublishing is restricted). **Always get explicit confirmation before `npm publish` and before pushing tags.**

## 1. Check package.json

- `name` — `sse-to-mqtt-node` was free on npm when checked; re-check with `npm view <name>` (a 404 means free). Use a scope (`@user/sse-to-mqtt-node`) if taken.
- `version` — follow semver against the public API in `src/index.ts`: breaking export/option changes → major, new features → minor, fixes → patch.
- Already in place (keep them working): `main`/`types`/`exports` pointing at `dist/`, `bin` → `dist/cli.js`, `files: ["dist", "CHANGELOG.md"]` (README and LICENSE are always included), metadata, `engines.node >=22`, and `prepublishOnly` running typecheck, lint, tests and a clean build.
- Without `files`, npm falls back to `.gitignore`, which excludes `dist/` and ships a broken package, so never remove it.
- `dependencies` only hold runtime needs: `mqtt` (library) and `dotenv` (CLI).
- Move the `CHANGELOG.md` "Unreleased" section to the new version and date.

## 2. Build clean and inspect

```bash
npm run build               # cleans dist/ first
npm pack --dry-run          # lists exactly what would ship
```

Only `dist/`, `package.json`, `README.md`, `LICENSE` and `CHANGELOG.md` should appear. No `src/`, `config/`, `.env`, `.claude/` or tests. CI runs the same check.

## 3. Smoke-test the tarball

```bash
npm pack                                   # creates sse-to-mqtt-node-<version>.tgz
cd "$SCRATCHPAD" && npm init -y && npm i /path/to/sse-to-mqtt-node-<version>.tgz
node -e "const m = require('sse-to-mqtt-node'); console.log(Object.keys(m))"
npx sse-to-mqtt-node --version && npx sse-to-mqtt-node --help
```

Also check the types resolve from a small `.ts` file importing `SseToMqttBridge`, and that deep imports like `sse-to-mqtt-node/dist/cli` are blocked by the `exports` map.

## 4. Release (after confirmation)

```bash
npm version <patch|minor|major>   # bumps, commits and tags
npm publish                        # add --access public for scoped names
git push && git push --tags
```

`npm whoami` must succeed first. If the user isn't logged in, ask them to run `! npm login` themselves.

The normal path is a GitHub release (see the "Releasing sse-to-mqtt-node" doc): it runs both `publish-npm.yml` and `publish-docker.yml`. Before releasing, also check the image locally: `docker build -t sse-to-mqtt-node:test .`, then `docker run --rm sse-to-mqtt-node:test --version` prints the new version and `docker run --rm --entrypoint id sse-to-mqtt-node:test -un` prints `node`. After the release, `docker pull ghcr.io/ridrupasinghe/sse-to-mqtt-node:<version>` should work.

## 5. Report

Give the published name@version, the `npm pack` file list, and anything skipped.
