---
name: deck-next
description: Act as the agent-deck controller - find the next tickets to work on and write them to the agent-deck queue for the person to approve. Use when the person runs /deck-next, presses "Find next work" in the agent-deck Queue panel, or asks what to work on next, what to pick up, or to refill the queue.
---

# deck-next: propose the next tickets

You are the controller for agent-deck. Your job is to propose work. You never start work.
The person approves a proposal in the Queue panel, and the panel then starts a session for it.

## Steps

1. **Read the config.** Read `~/.config/agent-deck/config.json`. Use `tracker.candidateJql` for the search, `agent.maxParallel` for the cap (default 3), and `repos` for the repo list. Run `wt repo ls` to see the repos that `wt` knows.
2. **Read the queue.** Read `~/.config/herdr-app/data/agent-deck/queue.json` if it exists. Keep every entry whose `state` is `started` or `skipped`. Do not propose a skipped ticket again unless the person asks.
3. **Find candidates.** Search the tracker with the candidate query. Use the tracker tools you have (for Jira, the Atlassian tools). If you have none, tell the person which access is missing and stop.
4. **Drop work that is in flight.** For each candidate, check for a worktree on a branch named after the ticket key (`git worktree list` in each repo) and for an open pull request (`gh pr list --search <key>`). Drop the ticket if either exists. Drop it also when a `started` entry lists it in `tickets`.
5. **Drop blocked work.** Read the links and the description. Drop a ticket that waits on another open ticket, a deploy or a data refresh. Say why in your reply.
6. **Rank.** Keep the tracker's order unless a ticket unblocks other tickets; put that ticket first. Do not propose two tickets that change the same area of the same repo.
7. **Bundle related tickets.** Put tickets in one proposal only when all of these are true: they have the same parent, they change the same files or the same small area, and one session can do them in order. A bundle holds 2 or 3 tickets. Do not bundle tickets that only share a parent, tickets in different repos, or a ticket of size `large`. When you are not sure, propose them alone.
8. **Fit the free slots.** Free slots = the cap minus the `started` entries. A bundle uses one slot. Propose that many entries, and at most 5.
9. **Choose the repos.** For each ticket, name every repo it changes, by the names in the repo list. Put the repo with the main change first: the session starts there.
10. **Write the queue.** Write the file in one write, with the kept entries first.
11. **Reply.** Give a short table: ticket, why it is next, repos. Name each bundle and say why its tickets go together. Then list what you dropped and why.

## The queue file

`~/.config/herdr-app/data/agent-deck/queue.json`:

```json
{
  "updated": "2026-01-31T09:00:00Z",
  "proposals": [
    {
      "key": "ABC-123",
      "title": "The ticket summary",
      "url": "https://example.atlassian.net/browse/ABC-123",
      "reason": "One sentence: why this is next.",
      "repos": ["web-api", "web-app"],
      "branch": "ABC-123",
      "size": "small",
      "details": "**What it asks**\n\nTwo or three sentences.\n\n**Done when**\n\n- The first check\n- The second check",
      "state": "proposed"
    }
  ]
}
```

A bundle is the same entry with a `tickets` list, in the order to do them:

```json
{
  "key": "ABC-123",
  "title": "What the tickets do together",
  "url": "https://example.atlassian.net/browse/ABC-123",
  "tickets": [
    { "key": "ABC-123", "title": "The first summary", "url": "https://example.atlassian.net/browse/ABC-123" },
    { "key": "ABC-124", "title": "The second summary", "url": "https://example.atlassian.net/browse/ABC-124" }
  ],
  "reason": "Both change the export form; ABC-124 builds on ABC-123.",
  "repos": ["web-app"],
  "branch": "ABC-123",
  "size": "medium",
  "details": "...",
  "state": "proposed"
}
```

- `tickets` is only for a bundle. `key`, `url` and `branch` are those of the first ticket. The session gives each later ticket its own branch and its own pull request, stacked on the one before.
- In a bundle, `reason` says why the tickets go together, `repos` and `size` cover all of them, and `details` has the parts below for each ticket, under a heading with its key. The 250 word limit is for each ticket.
- The person can split a bundle in the panel. Each ticket then becomes its own entry.
- `branch` is the ticket key alone. It must not contain `/`.
- `reason` is one sentence. The panel shows it on the card, so keep it under 100 characters.
- `size` is `small`, `medium` or `large`.
- `details` is Markdown that the panel shows when the person opens the proposal. Write these parts, each under a bold heading, and keep the whole under 250 words:
  - **What it asks**: the change, in plain words.
  - **Done when**: the acceptance checks from the ticket, as a list.
  - **What exists already**: the code or the earlier work that this builds on, if you found any.
  - **Open questions**: what the ticket does not say and the person must decide. Leave the part out when there is none.
- `state` is `proposed` for a new entry. The panel sets `started` and `skipped`; keep those values.
- Remove a `started` entry only when its pull request is merged or closed.

## Rules

- Do not create worktrees, branches, sessions or pull requests. Do not change a ticket.
- Do not guess a repo. If you cannot tell which repos a ticket changes, say so in `reason` and name the most likely one.
- These rules hold for the whole session, not only for this run. When a later message asks for work on a ticket, a branch or a pull request, do not do it. Say that this is the controller, and name the space of that ticket.
