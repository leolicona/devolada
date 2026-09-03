# Hooks

One hook, `skill-activation-prompt`, registered in `.claude/settings.json` on
`UserPromptSubmit`. Before Claude sees a prompt it reads
`.claude/skills/skill-rules.json`, matches the prompt against each skill's
triggers and injects the matches as context. Nothing here blocks anything.

## Setup on a fresh clone

```sh
pnpm setup:claude        # = npm ci --prefix .claude/hooks  (tsx + typescript)
```

The wrapper runs `npx tsx`, so without `node_modules/` the hook fails and
Claude Code continues with no suggestions. `jq` is not required by this hook.

Test it by hand:

```sh
echo '{"session_id":"t","cwd":"'$PWD'","prompt":"genera una migración de drizzle"}' \
  | (cd .claude/hooks && npx tsx skill-activation-prompt.ts) | jq .
```

## How matching works (read before editing skill-rules.json)

- `keywords` are wrapped in `\b…\b` and tested case-insensitively. A keyword
  that starts or ends with a non-word character (`@tanstack/…`, `require(`)
  can never match.
- `intentPatterns` are JS regexes tested against the lowercased prompt. Spanish
  verbs are written as stems (`proteg\w*`, not `proteger`) so conjugated
  prompts match.
- `fileTriggers.pathPatterns` are matched against **`cwd`**, not the edited
  file, and `contentPatterns` are never read. Prefer prompt triggers.
- Priority decides the wording: only the **first** `critical`/`high` match is
  named as "critical best practices"; the rest go to "Also reference";
  `medium`/`low` go to "may be helpful". Keep `high` small.
- Skills are iterated in file order: the original entries come first, then the
  rest alphabetically, so an earlier `high` wins the prominent slot.

## Adding a skill

1. Put it in `.claude/skills/<name>/SKILL.md` (frontmatter `name` +
   `description`, under 500 lines, details in reference files).
2. Add an entry to `skill-rules.json` with distinctive keywords (multi-word or
   namespaced; never bare `design`, `review`, `api`) and a priority that
   reflects this repo's stack — `high` only for skills that carry project law.
3. Run the manual test above with two prompts that should match and two that
   should not.

`skills-lock.json` at the repo root records where the GitHub-sourced skills
came from; the store the installer writes (`.agents/`) is gitignored, so
`.claude/skills/` is the source of truth.
