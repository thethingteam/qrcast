# Tasks

## 1. Package metadata and tarball check

- [x] 1.1 Add `repository`, `homepage`, `bugs`, `keywords` and `publishConfig` to `packages/qrcast/package.json`; verify `npm pack --dry-run` in `packages/qrcast` shows the metadata and `files` unchanged (the registry and the new name are set in group 6)
- [x] 1.2 Write `packages/qrcast/scripts/check-pack.mjs`: compare `npm pack --dry-run --json` with the `exports` map and the asset list in `copy-assets.mjs`, require the license files, reject files outside `dist/` (other than `package.json`, README, LICENSE) and `http(s)://` code or asset URLs in `dist/`; verify it passes after `pnpm build` and fails when an asset or license file is removed
- [x] 1.3 Add a `check:pack` script and wire it into the package's `test` flow; verify `pnpm test` runs it

## 2. Consumer smoke tests

- [x] 2.1 Add `smoke/plain` (static page, `<script type="module">`, served by a tiny static server) and a Playwright check that a codec starts without `codec-init-failed`; verify it passes against a packed tarball
- [x] 2.2 Add `smoke/vite` (pinned Vite) with build-time asset assertions and the same run-time check on `vite preview`; verify it passes, and fails if `optimizeDeps` or an asset is broken
- [x] 2.3 Add `smoke/webpack` (pinned webpack 5) with the same assertions; verify it passes
- [x] 2.4 Add a `smoke` script at the repo root that runs `pnpm pack`, installs the tarball into each project and runs the three checks; verify `pnpm smoke` passes locally and document it in the README's development section

## 3. CI

- [x] 3.1 Add `.github/workflows/ci.yml` (pnpm, Node 22): typecheck, `pnpm test`, `pnpm test:browser`, `pnpm build`, `pnpm smoke`, with pnpm and Playwright caches; verify it is green on a test branch pull request

## 4. Release automation

- [x] 4.1 Load the `release-please-setup` skill and add `release-please-config.json`, `.release-please-manifest.json` and `.github/workflows/release-please.yml` (single package `packages/qrcast`, `bump-minor-pre-major`); verify both JSON files parse and the workflow lints with `actionlint` if available
- [x] 4.2 Add the `publish` job gated on the release output: install, build, test, then publish to GitHub Packages (see 6.3); verify with a dry run in CI on a test branch, and that no secret other than `GITHUB_TOKEN` is referenced
- [x] 4.3 Add a "Releasing" maintainer section to `README.md`: the Actions pull-request setting, how a release happens, and rollback by deprecation; verify every command in it is copy-pasteable and correct for the repo layout (rewritten for GitHub Packages in 6.4)

## 5. Notes and handoff

- [x] 5.1 Update `docs/design-notes.md`: remove the packaging, repository and `publish` plan items now captured in specs and this change, keeping the still-open questions; verify the file still follows its "remove when captured" rule
- [x] 5.2 Run `openspec validate publish` and check the owner's remaining action (the Actions setting) is listed in the README; verify the first release PR title reads `chore(main): release 0.1.0` after merging to main

## 6. Switch to GitHub Packages

- [x] 6.1 Rename the package to `@thethingteam/qrcast` and set `publishConfig` to `{ "registry": "https://npm.pkg.github.com", "access": "public" }` in `packages/qrcast/package.json`; update the demo's dependency and imports, `pnpm-lock.yaml`, the smoke tests (tarball name, import map, imports in `smoke/shared/main.js`), `check-pack` if it names the package, and every `qrcast/…` import in the README; verify `pnpm install`, `pnpm build`, `pnpm test`, `pnpm test:browser` and `pnpm smoke` pass
- [x] 6.2 Update the specs that name the package (`openspec/specs/*`) only where they quote the package name or an import path; verify `openspec validate --specs` passes and `grep -rn "from 'qrcast" openspec/specs README.md` finds no stale import
- [x] 6.3 Rewrite the publish job in `.github/workflows/release.yml`: `permissions: contents: read, packages: write`, `setup-node` with the GitHub Packages registry and the `@thethingteam` scope, `pnpm publish --no-git-checks` with `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`; drop `id-token` and `--provenance`; change the CI dry-run step to `pnpm publish --dry-run --no-git-checks`; verify CI is green on the PR and `grep -rn "NPM_TOKEN\|id-token\|provenance" .github` finds nothing
- [x] 6.4 Rewrite the README "Releasing" section for GitHub Packages (no name claim, no trusted publisher) and add an install section: committed `.npmrc` with only the scope line, the auth line in the user's `~/.npmrc`, `read:packages`, access for another repo's Actions; verify the commands against `npm config` and a scratch install if a token is available
- [x] 6.5 Update `docs/design-notes.md` section 12: replace the "public npm, unscoped" decision with the GitHub Packages decision, its reason, and the later-npm plan; verify no other section still says `qrcast` is on public npm
