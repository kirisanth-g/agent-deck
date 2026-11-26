# agent-deck

agent-deck is a work queue and control panel for coding agents. It runs as a mod inside the [Herdr](https://herdr.dev) desktop app.

It reads your issue tracker and proposes the next tickets to work on. When you approve a ticket, it starts a Claude Code session for that ticket in its own git worktree. The session then works on its own. agent-deck alerts you when a session needs your input.

**Status:** early. The Repos panel, the Queue panel and the controller skill exist. Herdr does not yet show the status of a Claude Code session, so there are no alerts yet.

## How it works

```
Controller (a Claude session)  ->  queue file  ->  Queue panel  ->  you approve  ->  ticket space
```

1. **Find next work.** The button on the Queue panel starts the controller, a Claude Code session that runs the `deck-next` skill. The controller reads the tracker, drops the tickets that are in flight or blocked, and writes its proposals to the queue file.
2. **Approve or skip.** Each proposal shows the ticket, the reason it is next, and the repos it changes. Nothing starts without **Approve**.

   The controller puts two or three closely related tickets of one epic in one proposal, a **bundle**. One space and one session do them in order, and each ticket gets its own pull request, stacked on the one before. **Split** turns a bundle back into one proposal for each ticket.
3. **Start.** On Approve, agent-deck makes a worktree in each repo of the ticket. It opens one space named after the ticket, with a tab for each repo, and starts one Claude Code session there. The session gets the other worktrees with `--add-dir`, so it sees every repo of the ticket.

## The panels

**Queue** lists the proposals and the tickets in progress. A click on a ticket in progress goes to its space.

**Repos** lists your repos and their worktrees. The repos are the ones registered with [`wt`](#requirements), plus `repos.add` and minus `repos.hide` from the config file.

- Click a worktree to open it as a Herdr space, or to go to the space that already shows it.
- **+ worktree** asks for a branch, makes the worktree, and opens it as a space.
  - In a repo that `wt` knows, it runs `wt new <branch> --no-code`.
  - In any other repo, it runs `git worktree add` into `<repo>.worktrees/<branch>`. A new branch starts from the fetched default branch.

## Install

```sh
./install.sh
```

The script links the mod into `~/.config/herdr-app/mods/`, adds the two panels and the settings row to a personal layout named `deck`, and links the `deck-next` skill into `~/.claude/skills/`. Herdr does not allow a structure change on a shipped layout, so the script clones `main`.

Run the script again after you change the mod. It restarts the panels.

## Not built yet

- **Status and alerts.** FUTURE: a Claude Code hook that reports working, blocked and done to Herdr.
- **Pins.** FUTURE: the tickets and pull requests of each session, on its row.
- **Automatic refill.** FUTURE: run the controller when a session finishes.

## Layout

```
mods/agent-deck/      the Herdr mod: the Queue view and the Repos view
skills/deck-next/     the controller skill for Claude Code
install.sh            links the mod and the skill, and adds the panels to a layout
config.example.json   an example of ~/.config/agent-deck/config.json
```

## Configuration

agent-deck reads `~/.config/agent-deck/config.json`. Start from `config.example.json`. The file is optional, and it stays outside this repository.

The **agent-deck settings** row in the sidebar, above Herdr's Settings row, opens a dialog that edits this file. Herdr's own Settings window has no place for a mod, so agent-deck has its own.

| Key | Use |
| --- | --- |
| `tracker.candidateJql` | The search the controller runs for candidate tickets. |
| `repos.add`, `repos.hide` | Repo folders to add to the Repos list, and repo names to hide. |
| `controller.folder` | The folder the controller session starts in. Default: your home folder. |
| `agent.task` | The first message of a ticket session. `{ticket}` is the ticket key. Default: `/ticket-start {ticket}`. agent-deck adds a note that the worktrees exist, so the session does not make them again. |
| `agent.maxParallel` | The cap on ticket sessions that run at once. Default: 3. |
| `agent.acceptTrust` | `true`: answer "Yes" on Claude Code's trust screen for a worktree that agent-deck just made. Default: off. |

Claude Code asks whether you trust a new git folder that carries its own pre-approved permissions, and a worktree with a copied `.claude/settings.local.json` is one. With `agent.acceptTrust` off, go to the ticket's space and answer the question. Turn it on only when every repo in the list is yours: you no longer see what the folder pre-approves.

The controller reaches the tracker through the tools of its Claude Code session, for example the Atlassian connector. agent-deck stores no tracker token.

The queue file is `~/.config/herdr-app/data/agent-deck/queue.json`. `skills/deck-next/SKILL.md` gives its format.

## Requirements

- macOS on Apple Silicon
- [Herdr desktop app](https://github.com/herdrdev/herdr-app) and herdr-core (`hc`)
- [Claude Code](https://claude.com/claude-code)
- `gh`, authenticated
- `wt`, a git worktree tool that registers repos (`wt repo ls`) and creates worktrees (`wt new`)

## License

MIT
