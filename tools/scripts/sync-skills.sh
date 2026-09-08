#!/usr/bin/env bash
# Vendor agent skills into .claude/skills/ from the sources declared in tools/skills.json.
#
# - project-level and versioned: every clone of this repository gets the same guidance;
# - pinned: the upstream commit of every source is written to .claude/skills/skills.lock.json;
# - curated: only the skills listed in the manifest are copied (sparse checkout, no full clones);
# - overlays: files under tools/skill-overlays/<skill>/ are copied over the upstream skill
#   (used to make a skill read a vendored file instead of fetching it at runtime);
# - assets: URLs declared per skill are downloaded into the skill folder.
#
# Usage:
#   tools/scripts/sync-skills.sh                 # sync every source
#   tools/scripts/sync-skills.sh --source hono   # sync one source id
#   tools/scripts/sync-skills.sh --list          # show what the manifest declares
# To add a skill: edit tools/skills.json, then run the script. To pin a source: set its "ref".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="$ROOT/tools/skills.json"
DEST="$ROOT/.claude/skills"
LOCK="$DEST/skills.lock.json"
OVERLAYS="$ROOT/tools/skill-overlays"
ONLY=""
case "${1:-}" in
  --source) ONLY="$2" ;;
  --list) python3 -c "import json;[print(f\"{s['id']:<12} {s['repo']}  ({', '.join(k['name'] for k in s['skills'])})\") for s in json.load(open('$MANIFEST'))['sources']]"; exit 0 ;;
  "") ;;
  *) echo "unknown argument: $1" >&2; exit 1 ;;
esac

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$DEST"
[[ -f "$LOCK" ]] || echo '{"sources":{}}' > "$LOCK"

python3 - "$MANIFEST" "$ONLY" <<'PY' > "$tmp/plan.tsv"
import json, sys
m, only = json.load(open(sys.argv[1])), sys.argv[2]
for s in m["sources"]:
    if only and s["id"] != only: continue
    for k in s["skills"]:
        assets = ";".join(f"{a['url']}|{a['file']}" for a in k.get("assets", []))
        print("\t".join([s["id"], s["repo"], s.get("ref", "main"), k["name"], k["path"], assets]))
PY

current_src=""; commit=""
while IFS=$'\t' read -r sid repo ref name path assets; do
  if [[ "$sid" != "$current_src" ]]; then
    current_src="$sid"; wd="$tmp/$sid"; rm -rf "$wd"
    paths="$(awk -F'\t' -v s="$sid" '$1==s{print $5}' "$tmp/plan.tsv" | tr '\n' ' ')"
    git clone --quiet --depth 1 --filter=blob:none --sparse --branch "$ref" "$repo" "$wd"
    # shellcheck disable=SC2086
    git -C "$wd" sparse-checkout set --no-cone $paths >/dev/null 2>&1 || git -C "$wd" sparse-checkout set $paths
    commit="$(git -C "$wd" rev-parse HEAD)"
    python3 - "$LOCK" "$sid" "$repo" "$ref" "$commit" <<'PY'
import json, sys, datetime
lock, sid, repo, ref, commit = sys.argv[1:]
d = json.load(open(lock)); d.setdefault("sources", {})
d["sources"][sid] = {"repo": repo, "ref": ref, "commit": commit,
  "synced_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "skills": d["sources"].get(sid, {}).get("skills", [])}
json.dump(d, open(lock, "w"), indent=2)
PY
  fi
  src="$wd/$path"
  [[ -f "$src/SKILL.md" ]] || { echo "no SKILL.md at $sid:$path" >&2; exit 1; }
  rm -rf "$DEST/$name"; cp -R "$src" "$DEST/$name"
  if [[ -n "$assets" ]]; then
    IFS=';' read -ra items <<< "$assets"
    for it in "${items[@]}"; do url="${it%%|*}"; file="${it##*|}"
      curl -sSfL --retry 3 -o "$DEST/$name/$file" "$url"; echo "  asset $name/$file"
    done
  fi
  if [[ -d "$OVERLAYS/$name" ]]; then cp -R "$OVERLAYS/$name/." "$DEST/$name/"; echo "  overlay applied to $name"; fi
  python3 - "$LOCK" "$sid" "$name" "$path" <<'PY'
import json, sys
lock, sid, name, path = sys.argv[1:]
d = json.load(open(lock)); sk = d["sources"][sid].setdefault("skills", [])
sk[:] = [x for x in sk if x["name"] != name]; sk.append({"name": name, "path": path})
json.dump(d, open(lock, "w"), indent=2)
PY
  echo "synced $sid/$name -> .claude/skills/$name"
done < "$tmp/plan.tsv"

python3 - "$LOCK" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
d["note"] = "Managed by tools/scripts/sync-skills.sh from tools/skills.json - do not edit synced skill folders by hand; put local changes in tools/skill-overlays/<skill>/."
json.dump(d, open(sys.argv[1], "w"), indent=2); print(f"wrote {sys.argv[1]}")
PY
