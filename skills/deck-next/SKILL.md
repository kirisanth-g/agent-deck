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
4. **Drop work that is in flight.** For each candidate, check for a worktree on a branch named after the ticket key (`git worktree list` in each repo) and for an open pull request (`gh pr list --search <key>`). Drop the ticket if either exists.
5. **Drop blocked work.** Read the links and the description. Drop a ticket that waits on another open ticket, a deploy or a data refresh. Say why in your reply.
6. **Rank.** Keep the tracker's order unless a ticket unblocks other tickets; put that ticket first. Do not propose two tickets that change the same area of the same repo.
7. **Fit the free slots.** Free slots = the cap minus the `started` entries. Propose that many tickets, and at most 5.
8. **Choose the repos.** For each ticket, name every repo it changes, by the names in the repo list. Put the repo with the main change first: the session starts there.
9. **Write the queue.** Write the file in one write, with the kept entries first.
10. **Reply.** Give a short table: ticket, why it is next, repos. Then list what you dropped and why.

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
      "state": "proposed"
    }
  ]
}
```

- `branch` is the ticket key alone. It must not contain `/`.
- `size` is `small`, `medium` or `large`.
- `state` is `proposed` for a new entry. The panel sets `started` and `skipped`; keep those values.
- Remove a `started` entry only when its pull request is merged or closed.

## Rules

- Do not create worktrees, branches, sessions or pull requests. Do not change a ticket.
- Do not guess a repo. If you cannot tell which repos a ticket changes, say so in `reason` and name the most likely one.
