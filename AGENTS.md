# AGENTS.md

## What this repo is

agent-deck is a work queue and control panel for coding agents. It is a mod for the [Herdr desktop app](https://github.com/herdrdev/herdr-app), plus one Claude Code skill.

- A **controller** (a Claude Code session that runs the `deck-next` skill) proposes tickets.
- The **Queue** view shows the proposals. Nothing starts without **Approve**.
- **Approve** makes a worktree in each repo of the ticket, opens one Herdr space with a tab for each repo, and starts one Claude Code session there.

Read `README.md` for the user's view of the same thing.

## Layout

```
mods/agent-deck/
  main.js       picks a view from props: { view }
  lib.js        the config file, the repos, the worktrees, app commands
  repos.js      Repos view (in the layout)
  queue.js      Queue view (in the layout), and the approve / skip logic
  row.js        the settings row in the sidebar (in the layout)
  store.js      the queue file and the saved proposals; no view code
  link.js       the link handler: a click on a ticket address shows its proposal
  detail.js     one proposal, as a dialog
  settings.js   the config file, as a dialog
  mod.json
skills/deck-next/SKILL.md   the controller skill, and the queue file format
install.sh                  links the mod and the skill, adds the blocks to a layout
config.example.json         an example of ~/.config/agent-deck/config.json
```

Files outside the repo that the code reads or writes:

| File | Use |
| --- | --- |
| `~/.config/agent-deck/config.json` | The person's settings. The Settings view writes it. |
| `~/.config/herdr-app/data/agent-deck/queue.json` | The queue. The controller writes it; the Queue view sets `state`. |
| `~/.config/herdr-app/data/agent-deck/tickets/<key>.json` | The proposal of a started ticket. Approve writes it; the Detail view reads it when the queue has no entry. |
| `~/.config/herdr-app/layouts/deck.json` | The personal layout that holds the blocks. `install.sh` makes it. |

## Before you change the mod

Read the Herdr mod guide on this machine. It is the truth for this Herdr version:

- `~/.config/herdr-app/AGENTS.md`: the mod rules, the layouts, the commands.
- `~/.config/herdr-app/herdr.d.ts` and `gpui-kit.d.ts`: every function and element.
- `~/.config/herdr-app/mods/`: the shipped mods, as examples.

A mod is not a web page. There is no DOM, no HTML, no CSS, no Node API and no `setTimeout`. The script describes native elements. Use `cx.timer` and `cx.spawn`.

## Check a change

```sh
herdr-app check mods/agent-deck     # must pass before you call a change done
./install.sh                        # restarts the views; see "Things that go wrong"
herdr-app shot /tmp/deck.png        # a picture of the window, to look at
herdr-app status                    # "errors" must be empty
```

`herdr-app check` renders only the default view. To see another view, open it in a tab, take a picture, and close the tab:

```sh
herdr-app do tab.new '{"mod":"agent-deck","props":{"view":"settings"},"name":"test"}'
herdr-app shot /tmp/deck.png
herdr-app do tab.close '{"id":"<tab id from the first command>","confirmed":true}'
```

You cannot click from a script. Say which buttons you did not test.

## Things that go wrong

Each of these cost time once. Keep them in mind.

- **Herdr does not reload a linked mod.** `install.sh` links the mod folder into Herdr. Herdr does not see an edit made through the link. Run `./install.sh` after every change; it switches the layout away and back, which starts the views again.
- **A closed view loses its work.** Herdr cancels the tasks of a view that closes. A dialog must not do long work. It calls `request()` in `queue.js`, and the Queue view, which stays open, does the work.
- **Shared state outlives the app.** `setShared` values are saved to disk. The Queue view clears the busy labels when it starts, because no work survives a restart.
- **`run()` returns nothing.** To get the id of a new space or tab, use `make()` in `lib.js`. It runs `herdr-app do` and reads the answer.
- **A shipped layout cannot change structure.** New blocks go in a personal clone of `main`.
- **`claude --add-dir` takes every word after it as a folder.** The first message goes before the flag.
- **Claude Code asks about trust in a new git folder that carries its own pre-approvals.** A worktree with a copied `.claude/settings.local.json` is one. A session that waits there reports no status to Herdr. `agent.acceptTrust` answers the question, only for a worktree made in the same run.
- **`wt new` refuses a repo it does not know.** For such a repo, `gitWorktree()` makes the worktree in the same `<repo>.worktrees/<branch>` place.
- **A start skill makes its own worktree.** The first message of a ticket session says that the worktrees exist.
- **The controller obeys any message typed into it.** It starts in a folder above the repos, so it can reach all of them. `CONTROLLER_ROLE` in `queue.js` limits it to proposals. Keep that text and the rules in the skill in step.
- **A bundle is one proposal with a `tickets` list.** Its `key` and `branch` are those of the first ticket, so the space, the busy label and the queue state need no second case. Read the tickets with `ticketsOf()`.
- **Herdr loads `link.js` for a link click, with no view.** The name is fixed. It imports only `herdr` and `store.js`; keep view code out of both.
- **`wt rm` forces.** `finish()` checks each worktree for changes that are not committed before it closes or removes anything. Keep that check first.
- **`writeTextFile` needs the snapshot.** Pass the text you last read as `expected`. The write fails if the file changed, which protects the controller's writes.

## Rules for this repo

- **The repo is public.** Do not commit a company name, a tracker address, a ticket key, a real repo name, a token or a person's work email. Examples use made-up values (`ABC-123`, `example.atlassian.net`, `web-api`). Run a search for such details before each commit.
- **Settings stay outside the repo**, in `~/.config/agent-deck/config.json`. A new setting gets a row in the Settings view, a row in the README table and a value in `config.example.json`.
- **The controller proposes; the person approves.** No code path starts a session, makes a worktree or changes a ticket without an Approve.
- **Comments and docs use Simplified Technical English, main point first.** One idea in each sentence. Active voice, present tense. A comment says why, not what, and describes the code as it is now.
- **Work that is not built yet is marked `FUTURE:`.**
- **Commits use Conventional Commits** (`feat:`, `fix:`, `chore:`), one commit for each step. Commit with the GitHub noreply address that this clone is set to.
- **Do not add features, options or error handling that the task does not need.**
