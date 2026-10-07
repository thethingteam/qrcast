# Tasks

## 1. Package metadata and tarball check

- [x] 1.1 Add `repository`, `homepage`, `bugs`, `keywords` and `publishConfig` (`access: public`, `provenance: true`) to `packages/qrcast/package.json`; verify `npm pack --dry-run` in `packages/qrcast` shows the metadata and `files` unchanged
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
- [ ] 4.2 Add the `publish` job gated on the release output: install, build, test, `check:pack`, then `npm publish --provenance --access public` with `id-token: write`; verify with a dry run (`npm publish --dry-run`) in the job on a test branch, and that no `NPM_TOKEN` secret is referenced
- [x] 4.3 Add a "Releasing" maintainer section to `README.md`: the one-time manual first publish, adding the trusted publisher, the Actions pull-request setting, and rollback by deprecation; verify every command in it is copy-pasteable and correct for the repo layout

## 5. Notes and handoff

- [x] 5.1 Update `docs/design-notes.md`: remove the packaging, repository and `publish` plan items now captured in specs and this change, keeping the still-open questions; verify the file still follows its "remove when captured" rule
- [ ] 5.2 Run `openspec validate publish` and check the owner's remaining actions (name on npm, trusted publisher, Actions setting) are listed in the README; verify the first release PR title reads `chore(main): release 0.1.0` after merging to main
