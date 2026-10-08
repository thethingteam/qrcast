# Design

## Context

The package already builds with plain `tsc` plus `scripts/copy-assets.mjs`,
which copies the vendored cimbar and zxing files and the worker scripts next to
the emitted JavaScript (see `design-notes.md` sections 10 and 11).
`files: ["dist"]` is set and the version is `0.0.0`. The repo has no
`.github/`, no release config and no tags. `origin` is a GitHub repo. The
`release-please-setup` skill covers the release-please files and the
first-release pitfalls; apply loads it.
See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- A first release, on GitHub Packages, that installs and builds in Vite,
  webpack and with no bundler, proven in CI against the packed tarball.
- Releases that need no stored secret: only the workflow's built-in token.
- A package name that survives a later move to the public npm registry.

**Non-Goals:**
- Publishing the demo (GitHub Pages) or any change to library behavior.
- Publishing to the public npm registry (a later step; see Open Questions).
- Segmentation, raw cimbar output, worker-count options (later changes).
- Safari and Firefox test coverage.

## Decisions

**Assets are emitted by the consumer's bundler, from plain `tsc` output.**
The package is not bundled: one output file per source file, plus
`copy-assets.mjs` placing the wasm, glue and worker scripts next to the
JavaScript, referenced with a literal `new URL('./file', import.meta.url)`.
ESM only; cimbar loads through a dynamic import, so QR-only users never fetch
its 1.94 MB wasm. This was decided before the first code and is what the
distribution spec now checks. Rejected: a CDN (zxing-wasm's default is
jsDelivr) because it breaks offline use and strict CSP and adds third-party
requests; base64 inlining because it adds about 2.6 MB to every user's
JavaScript, prevents streaming compilation and needs `blob:` workers that CSP
blocks; Vite library mode (inlines assets) and tsup/esbuild bundling (does not
copy the assets, so they 404 at run time); Vite-only `?url` imports.
Without a bundler, `import.meta.url` points at the package, so the relative
URLs still resolve; from an ESM CDN on another origin workers cannot start.

**Smoke tests consume a packed tarball.** CI runs `pnpm pack` once, and each
smoke project installs that `.tgz`. A workspace link would resolve to sources
and hide a missing file in `files`. *Alternative:* `pnpm link`; rejected for
that reason.

**Smoke projects live in `smoke/{vite,webpack,plain}`, outside the pnpm
workspace.** They install from the tarball with their own lockfile-less
`npm install`, so they do not disturb the workspace's dependency graph and
behave like a real consumer. *Alternative:* workspace members; rejected, they
would resolve `qrcast` to the workspace.

**Smoke tests serve the built output with a small static server, and fail on
any request that leaves the page's origin.** This replaces `vite preview` so
all three projects run the same way, and it proves the network-free promise at
run time: `dist/` still holds the vendored zxing-wasm's jsDelivr fallback URL,
which `locateFile` overrides, so a text scan alone cannot (the pack check
allowlists that one string). The Vite smoke builds for production; Vite's
`optimizeDeps` setting only matters for the dev server, so the README still
documents it but no test covers it.

**Smoke assertions are two-level.** Build-time: a script checks that the
output holds the `.wasm` and worker files. Run-time: headless Chromium
(Playwright, already a dev dependency) opens the built or served page, which
creates a codec and calls a cheap init, and asserts no `codec-init-failed`.
Build-time alone would miss a wrong URL; run-time alone gives poor errors.

**A tarball-content check runs before any publish.** A script reads
`npm pack --dry-run --json` and compares the file list with `exports` and the
asset list in `copy-assets.mjs`. It is cheap and fails earlier than the
smoke tests. It also rejects remote URLs in `dist/`.

**release-please manifest mode, one package.** Config at the repo root with
`packages/qrcast` as the only path, `release-type: node`,
`bump-minor-pre-major: true`, and a first release of `0.1.0` (the skill
describes how to avoid a first release PR that says 1.0.0). The workflow uses the default `GITHUB_TOKEN`, so the
repo setting "Allow GitHub Actions to create and approve pull requests" must
be on. *Note:* PRs opened with `GITHUB_TOKEN` do not trigger other workflows,
so the CI checks on the release PR need a re-run trigger or a PAT; start
without one and revisit if it blocks.

**Publish to GitHub Packages with `pnpm publish --no-git-checks`, in a job
gated on `release_created`.** The job has `contents: read` and
`packages: write`, and `setup-node` points at `https://npm.pkg.github.com` with
the `@thethingteam` scope; `NODE_AUTH_TOKEN` is the built-in `GITHUB_TOKEN`.
`--no-git-checks` because the job checks out a tag. This follows the owner's
existing GitHub Packages setup (the `release-please-setup` skill's node
variant). *Alternative:* public npm with trusted publishing (OIDC, provenance);
it was the first plan, and is deferred, not rejected: it needs the name claimed
by a manual first publish and a trusted publisher attached afterwards, and
nothing needs it yet.

**The name is scoped, `@thethingteam/qrcast`, from the start.** GitHub Packages
rejects other names. Keeping the same scoped name for npm later means no
consumer changes an import; only the registry setting changes. The scope must
then be owned on npmjs (`thethingteam`), which is checked when that step is
taken. `publishConfig.registry` points at GitHub Packages so that a stray
publish cannot reach the public registry.

**Consumers configure the registry once.** The README documents a committed
project `.npmrc` with only the scope line, and the auth line in the user's own
`~/.npmrc`, never in the same file (when the token variable is unset, pnpm
ignores the whole file, and the scope would fall back to the public registry).

## Risks / Trade-offs

- [GitHub Packages needs a token even to install, and a package's visibility
  follows its repository's] → document the `.npmrc` setup and the
  `read:packages` scope; give other repos' Actions access in the package
  settings.
- [Moving to public npm later repeats work: registry in `publishConfig`, a
  manual first publish, a trusted publisher] → the name does not change, so
  only the maintainers' side changes; recorded under Open Questions.
- [Release PRs created by `GITHUB_TOKEN` skip CI] → run the same checks in the
  publish job before publishing, so an unchecked release cannot ship.
- [Smoke tests are slow and flaky if they download browsers or deps] → cache
  pnpm and Playwright, and run smoke tests on pull requests only for the
  `packages/qrcast` and `smoke/` paths plus on release.
- [A webpack or Vite major version changes asset handling] → pin the smoke
  projects' tool versions and update them deliberately.
- [A vendored-file license is missed in the tarball] → the tarball-content
  check lists the license files per codec.

## Migration Plan

1. Merge the CI, smoke-test and release-please files; the first release PR
   appears after the next `feat:` or `fix:` commit.
2. Owner enables the Actions pull-request setting.
3. Releases: merge the release PR; the publish job does the rest. Rollback of
   a bad release is `npm deprecate` against the GitHub Packages registry plus a
   fixed patch release; deleting a version is not part of the plan.

## Open Questions

- Whether to also deploy `apps/demo` to GitHub Pages in this change or a
  later one (the proposal leaves it out).
- When to also publish to public npm, and whether the `thethingteam` scope
  exists there. Nothing in this change depends on the answer.
