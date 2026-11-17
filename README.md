# agent-deck

agent-deck is a work queue and control panel for coding agents. It runs as a mod inside the [Herdr](https://herdr.dev) desktop app.

It reads your issue tracker and proposes the next tickets to work on. When you approve a ticket, it starts a Claude Code session for that ticket in its own git worktree. The session then works on its own. agent-deck alerts you when a session needs your input.

**Status:** early. The Repos panel works. The ticket queue, the pins and the alerts are not built yet.

## What works now

The **Repos** panel lists each repo registered with [`wt`](#requirements) and its worktrees.

- Click a worktree to open it as a Herdr space, or to go to the space that already shows it.
- **+ worktree** asks for a branch, runs `wt new <branch> --no-code` in that repo, and opens the new worktree as a space.

## Install

```sh
./install.sh
```

The script links the mod into `~/.config/herdr-app/mods/` and adds the panel to a personal layout named `deck`. Herdr does not allow a structure change on a shipped layout, so the script clones `main`.

## Planned

1. **Propose.** The queue panel reads the tracker and lists candidate tickets. Nothing starts without your approval.
2. **Start.** On **Approve**, agent-deck creates a worktree and starts `claude` in a Herdr terminal in that worktree.
3. **Plan.** The session reads the ticket and the code, then presents a plan. Herdr shows the session as blocked until you approve the plan.
4. **Track.** Each agent card shows its status (working, blocked, done) and pins the tickets and pull requests it touches.
5. **Alert.** A blocked agent raises a notification, a sound and a Dock badge.

## Layout

```
mods/agent-deck/      the Herdr mod
install.sh            links the mod into Herdr and adds its panel to a layout
config.example.json   the settings agent-deck reads; copy to config.local.json
```

## Configuration

Copy `config.example.json` to `config.local.json` and fill it in. `config.local.json` is ignored by git.

Keep the tracker token out of files. agent-deck reads it from the macOS Keychain:

```sh
security add-generic-password -s agent-deck-jira -a "$USER" -w
```

## Requirements

- macOS on Apple Silicon
- [Herdr desktop app](https://github.com/herdrdev/herdr-app) and herdr-core (`hc`)
- [Claude Code](https://claude.com/claude-code)
- `gh`, authenticated
- `wt`, a git worktree tool that registers repos (`wt repo ls`) and creates worktrees (`wt new`)

## License

MIT
