# BUGS

History of defects found in code **already shipped to production**. This file is the tracker (solo-dev project); there is no mirror tracker.

Format:

```
## BUG-NNN — short title
- Status: open | fixed
- Detected: date · where
- Affected spec: docs/<domain>/<feature>.spec.md
- Symptom / root cause / fix (commit)
- Regression test: <path or "pending">
```

---

## BUG-001 — WispHub API key committed to the public repo
- Status: mitigated, **pending key rotation by the owner**
- Detected: 2026-08-14 · commit `dc1915c` pushed to `feat/store-pwa-shell` (public repo; branch since deleted, commit unreachable from any branch but fetchable by SHA until GitHub GC)
- Root cause: `.gitignore` covered `.env*` but not `.dev.vars`; a `git add -A` swept the file in.
- Fix: file removed from history going forward (amended cherry-pick `340cf88`), `.dev.vars` added to `.gitignore`.
- Remedy: **rotate the WispHub API key** in the panel — the exposed one must be considered burned. The repo being the shipped artifact, this counts as a production defect.
- Regression test: none automatable; prevention rule — secrets only ever live in `.dev.vars`/worker secrets, and `.gitignore` is verified before the first commit of any new secret file.
