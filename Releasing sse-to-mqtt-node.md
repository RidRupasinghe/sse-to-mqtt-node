# Releasing sse-to-mqtt-node

Sep 28, 2026 · @Rid

## At a glance

A release is a version tag on `master` plus a published GitHub release; GitHub Actions then publishes that version to npm. The current published version is **0.1.1**, released by hand on 2026-09-28 from commit `f4d05b6`.

|  |  |
| --- | --- |
| npm package | [sse-to-mqtt-node](https://www.npmjs.com/package/sse-to-mqtt-node) |
| GitHub repo | [RidRupasinghe/sse-to-mqtt-node](https://github.com/RidRupasinghe/sse-to-mqtt-node) |
| Publish workflow | `.github/workflows/publish-npm.yml` |
| Release branch | `master` (work happens on `develop`) |

The short version, once trusted publishing is set up:

1. Update `CHANGELOG.md` and merge `develop` into `master`.
2. On `master`: `npm version patch` (or `minor`), then `git push origin master --follow-tags`.
3. Publish a GitHub release from the new tag.
4. Watch the Actions tab, then check `npm view sse-to-mqtt-node version`.

## One-time setup: trusted publishing

Trusted publishing lets the GitHub workflow publish without an npm token or a 2FA prompt. Set it up once; until then, releases have to be published by hand (see Troubleshooting).

1. Open [npmjs.com/package/sse-to-mqtt-node/access](https://www.npmjs.com/package/sse-to-mqtt-node/access) and find **Trusted Publisher**.
2. Choose **GitHub Actions** and enter exactly:

| Field | Value |
| --- | --- |
| Organization or user | `RidRupasinghe` |
| Repository | `sse-to-mqtt-node` |
| Workflow filename | `publish-npm.yml` |
| Environment | leave empty |

3. Save.

npm only offers this for a package that already exists, which is why 0.1.1 was published by hand.

## Release steps

Each release takes six steps; only step 5 publishes anything to npm.

1. **Record the changes.** On `develop` (or a feature branch merged into it), add a section to `CHANGELOG.md` at the top: `## [0.1.2] - YYYY-MM-DD` with Added / Changed / Fixed lists.
2. **Merge into `master`.** Open a pull request from `develop` into `master`, wait for CI to pass on Node 22 and 24, then merge.
3. **Bump the version and tag it** on the merged `master`:

```bash
git checkout master && git pull
npm version patch   # or minor; see Choosing a version
git push origin master --follow-tags
```

`npm version` updates `package.json` and `package-lock.json`, commits, and creates the tag (for example `v0.1.2`). Always create tags this way so the tag and `package.json` agree.

4. **Bring the bump back to `develop`** so the branches don't drift: `git checkout develop && git merge master && git push origin develop`.
5. **Publish a GitHub release.** Go to [Releases → new release](https://github.com/RidRupasinghe/sse-to-mqtt-node/releases/new), choose the tag you just pushed, paste the CHANGELOG section as the description (or click **Generate release notes**), then click **Publish release**. "Save draft" does not start the workflow.
6. **Verify.** "Publish to npm" appears in the [Actions tab](https://github.com/RidRupasinghe/sse-to-mqtt-node/actions) within seconds. When it's green, `npm view sse-to-mqtt-node version` shows the new version and the npm page shows a provenance badge.

With the GitHub CLI installed (`brew install gh`), step 5 is one command: `gh release create v0.1.2 --generate-notes`.

## Choosing a version

While the version starts with 0, a minor bump signals changes users must pay attention to, and a patch bump is always safe to take.

| Change | Command | Example |
| --- | --- | --- |
| Bug fixes, docs, internal changes | `npm version patch` | 0.1.1 → 0.1.2 |
| New features, or anything that breaks existing users | `npm version minor` | 0.1.1 → 0.2.0 |
| First stable release, API committed to | `npm version major` | 0.x → 1.0.0 |

"Breaking" covers anything exported from `src/index.ts`, CLI flags, fields in the connections config, and environment variable names. A version number can never be reused on npm, even after unpublishing.

## What the publish workflow does

Publishing a GitHub release runs `publish-npm.yml`, which only publishes if the release tag matches `package.json` and every check passes.

&#91;embedded content: publish-npm.yml · 2 checks before publishing\]

- **Tag = version?** The tag without its `v` must equal the `version` in `package.json`, so `v0.1.2` only publishes 0.1.2.
- **Checks pass?** `npm ci`, then `prepublishOnly` runs typecheck, lint, the tests and a clean build.
- **Publish** runs `npm publish --provenance --access public`. npm gets a short-lived token from GitHub (OIDC), so no `NPM_TOKEN` secret is stored.

The workflow can also be started by hand from the Actions tab ("Run workflow"); that skips the tag check, so only use it for a version not yet on npm.

## Troubleshooting

Most failures stop before anything reaches npm, so the fix is usually to correct the problem and publish again.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Publish step fails with 401, 403 or `ENEEDAUTH` | Trusted publisher not set up, or a field doesn't match exactly | Check the settings in One-time setup (repo name and `publish-npm.yml`), then re-run the workflow |
| "Release tag (x) does not match package.json version (y)" | The tag was made by hand, or `npm version` wasn't run | Delete the release and tag, run `npm version` on `master`, push with `--follow-tags`, release again |
| Typecheck, lint or tests fail in the workflow | A broken change reached `master` | Fix on `develop`, merge, bump to the next version, release again |
| `EPUBLISHCONFLICT` / "cannot publish over the previously published version" | That version is already on npm | Bump to the next version; a version can never be reused |
| Nothing happens after creating the release | It was saved as a draft, or the tag's commit has no `publish-npm.yml` | Publish the draft, or tag a commit that contains the workflow |
| A bad version is already on npm | Released too early | Release a fixed patch version; if needed, mark the bad one with `npm deprecate sse-to-mqtt-node@0.1.2 "use 0.1.3"` |

**Publishing by hand** (fallback, or before trusted publishing is set up). Run this in a normal terminal, not through a tool that can't wait for input, because npm asks for a 2FA approval in the browser:

```bash
git checkout master && git pull
npm whoami                 # log in with `npm login` if this fails
npm publish --access public
```

`prepublishOnly` still runs every check first. Tag the published commit with `npm version` before publishing, as in Release steps, so GitHub and npm agree.
