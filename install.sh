#!/bin/sh
# Link the agent-deck mod into the Herdr app, add its panels to a personal layout,
# and link the controller skill into Claude Code.
# Run it again after a change to the mod: it skips each finished step and restarts the panel.
set -eu

app_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
repo="$(cd "$(dirname "$0")" && pwd)"
layout="deck"

[ -d "$app_home/mods" ] || { echo "Herdr app home not found at $app_home. Open Herdr once first." >&2; exit 1; }

if [ ! -e "$app_home/mods/agent-deck" ]; then
  ln -s "$repo/mods/agent-deck" "$app_home/mods/agent-deck"
  echo "Linked the mod."
fi

# Herdr does not let a shipped layout change structure, so the panel goes in a personal copy.
if [ ! -f "$app_home/layouts/$layout.json" ]; then
  herdr-app do layout.clone "{\"name\":\"main\",\"as\":\"$layout\"}" >/dev/null
  echo "Cloned the main layout as $layout."
fi

python3 - "$app_home/layouts/$layout.json" <<'EOF'
import json, sys

path = sys.argv[1]
with open(path) as f:
    doc = json.load(f)

def find(node, node_id):
    if node.get("id") == node_id:
        return node
    for child in node.get("children", []):
        hit = find(child, node_id)
        if hit:
            return hit
    return None

lists = find(doc, "sidebar-lists")
if lists is None:
    sys.exit("The layout has no sidebar-lists column. Add the agent-deck blocks by hand.")
added = []
for node_id, view in (("agent-deck-queue", "queue"), ("agent-deck", "repos")):
    if find(doc, node_id):
        continue
    block = {"id": node_id, "type": "block", "content": {"mod": "agent-deck", "props": {"view": view}}, "size": {"weight": 2}}
    lists["children"].insert(1, block)
    added.append(view)
if added:
    with open(path, "w") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
    print("Added to the layout: " + ", ".join(added) + ".")
EOF

mkdir -p "$app_home/data/agent-deck"

skills="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
if [ -d "$skills" ] && [ ! -e "$skills/deck-next" ]; then
  ln -s "$repo/skills/deck-next" "$skills/deck-next"
  echo "Linked the deck-next skill."
fi

# Herdr does not see an edit made through the link. A layout switch starts the mod again.
herdr-app do layout.switch "{\"name\":\"main\"}" >/dev/null
herdr-app do layout.switch "{\"name\":\"$layout\"}" >/dev/null
echo "Done. Herdr shows the $layout layout. Switch back with: herdr-app do layout.switch '{\"name\":\"main\"}'"
