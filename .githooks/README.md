# Git hooks

## Install

Once per clone. Linked worktrees of that clone inherit it.

```bash
git config core.hooksPath .githooks
```

Check it took:

```bash
git config --get core.hooksPath   # -> .githooks
```

## `pre-push`

Refuses a push that Vercel would fail to build.

Two gates, cheapest first:

1. **An empty source file** in the push (`.js .jsx .ts .tsx .mjs .cjs .css
   .json`). Instant. A module committed empty takes the build down wherever it
   is imported, and it is invisible in a diff review.
2. **`vite build`** — the same command Vercel runs, into a throwaway output
   directory so nobody's `dist/` is clobbered. About 40 seconds, and it only
   runs when the push touches something the build reads: `src/`, `public/`,
   `index.html`, `vite.config*`, `package.json`, `package-lock.json`,
   `tailwind.config*`, `postcss.config*`. A server-only or test-only push costs
   nothing.

Tests are deliberately **not** run. Some have assertions that are already stale
on `main`, so they would block every push for reasons that have nothing to do
with it.

### Why

Several people push to `main` from this repository at once. Twice in one day a
broken frontend reached production: a source file was committed empty, and an
import pointed at a module that had been renamed. Vercel names whichever commit
happened to be on top of the branch when it built, so the failure email usually
does not name the person who caused it — and the next few pushes each generate
another failure email for a problem that is already fixed.

### Bypassing

```bash
git push --no-verify
```

Fine when you know the build is broken for a reason you are about to fix in the
next push. Not fine as a habit: the point of the gate is that nobody has to
read a failure email to find out.
