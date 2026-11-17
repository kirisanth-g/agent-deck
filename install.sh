#!/bin/sh
# Link the agent-deck mod into the Herdr app and add its panel to a personal layout.
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

if find(doc, "agent-deck"):
    sys.exit(0)
lists = find(doc, "sidebar-lists")
if lists is None:
    sys.exit("The layout has no sidebar-lists column. Add the agent-deck block by hand.")
block = {"id": "agent-deck", "type": "block", "content": {"mod": "agent-deck"}, "size": {"weight": 2}}
lists["children"].insert(1, block)
with open(path, "w") as f:
    json.dump(doc, f, indent=2, ensure_ascii=False)
print("Added the Repos panel to the layout.")
EOF

# Herdr does not see an edit made through the link. A layout switch starts the mod again.
herdr-app do layout.switch "{\"name\":\"main\"}" >/dev/null
herdr-app do layout.switch "{\"name\":\"$layout\"}" >/dev/null
echo "Done. Herdr shows the $layout layout. Switch back with: herdr-app do layout.switch '{\"name\":\"main\"}'"
