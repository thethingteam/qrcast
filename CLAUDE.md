# qrcast

Headless library that sends a `Uint8Array` from screen to camera with animated
codes (cimbar by default, QR in black and white or color as fallbacks).

- Read `docs/design-notes.md` before planning or changing anything. It holds
  the decisions made so far; do not reopen the ones marked Decided.
- If `HANDOFF.local.md` exists, read it too. It is untracked and private:
  never copy its contents (local paths, private repo names) into tracked files.
- Everything in the repo is in English: code, docs, OpenSpec artifacts and
  commit messages. Conversation with the owner may be in Chinese.
- Commits follow Conventional Commits (release-please builds the changelog
  from them), so write `feat:` and `fix:` messages for library users.
- The library must never make network requests (no CDN) and must keep
  `new URL('./asset', import.meta.url)` references literal so consumer
  bundlers can emit the assets.
