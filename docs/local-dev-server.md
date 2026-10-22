# Local dev server (`npx vite`)

## 2026-10-22: "scanning dependencies..." never finished

Symptom: `npx vite --port 5299 --strictPort` printed `Re-optimizing dependencies
because lockfile has changed`, then `[optimizer] scanning dependencies...`, and
never answered a request. With `optimizeDeps.noDiscovery` the hang moved to
`bundling dependencies...`. `vite build` worked, so rolldown was fine.

Cause: it was not the lockfile, node 26, vite 8 or any dependency. Every
optimizer include list bundled in a minimal project that shared this
`node_modules`. The difference was the project root: git worktrees live inside
it (`.claude/worktrees/*`, 34 of them, one with its own `node_modules`, about
100K files in all, plus `.codex-worktrees/*`). The dev file watcher's initial
crawl over them keeps node's thread pool busy, and the optimizer's scan (which
runs on the same pool) never gets a turn. The worktrees were created
2026-10-19..21, which is why it looked tied to the 2026-10-20 lockfile change.

Fix: `vite.config.js` adds `**/.claude/**`, `**/.codex-worktrees/**` and
`erp-i18n-baseline/**` to `server.watch.ignored`. With that, the first
`/login` answers 200 in about 25s on this machine (the optimizer still
re-bundles once per lockfile change), later requests in well under a second.

If it ever comes back: count files under the root with
`find . -path ./node_modules -prune -o -path ./.git -prune -o -type f -print | wc -l`
and look for new large folders that the ignore list does not cover.
