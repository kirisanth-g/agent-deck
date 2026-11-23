// The Queue view: the tickets the controller proposes, and the ones in progress.
// The controller is a Claude session. It writes the queue file; this view never ranks work.
// Nothing starts until the person presses Approve.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, spaces, panes, theme, notify, checking, home, appHome, readTextFile, writeTextFile, watchFolder, openOverlay, shared, setShared, nextCommand } from "herdr";
import { config, repos, checkouts, makeWorktree, make, out } from "./lib.js";

const CONTROLLER = "Controller";
// The controller can reach every repo, so a message typed there by mistake must not start work.
const CONTROLLER_ROLE = "You are the agent-deck controller. You only propose tickets, with the deck-next skill, and answer questions about the queue. "
  + "Do not edit files, commit, push, rebase, change a ticket or change a pull request, except to write the agent-deck queue file. "
  + "When a message asks for work on a ticket, a branch or a pull request, do not do it. "
  + "Say that this is the controller, and name the Herdr space of that ticket if you know it.";
const DEFAULT_TASK = "/ticket-start {ticket}";
const DEFAULT_CAP = 3;

const BUSY = "agent-deck.busy"; // shared by every view: ticket key -> what runs for it now
// A dialog closes before its work can finish, and Herdr cancels the work of a closed view.
// So a dialog leaves a request here, and the Queue view, which stays open, does the work.
const REQUEST = "agent-deck.request"; // { key, action: "approve" | "skip" } or null

export function request(key, action) {
  setShared(REQUEST, { key, action });
  run("agent-deck.request");
}

export const dir = () => `${appHome()}/data/agent-deck`;
const file = () => `${dir()}/queue.json`;
export const message = (err) => (err instanceof Error ? err.message : String(err));

export const busy = (key) => (shared(BUSY) ?? {})[key];
function setBusy(key, what) {
  const next = { ...(shared(BUSY) ?? {}) };
  if (what) next[key] = what; else delete next[key];
  setShared(BUSY, next);
}

export const spaceFor = (key) => spaces().find((s) => s.named && s.name === key);

// Reads the queue file: { raw, queue }. `raw` is the snapshot a write must match.
export async function readQueue() {
  const raw = await readTextFile(file());
  const parsed = raw === null ? {} : JSON.parse(raw);
  return { raw, queue: { ...parsed, proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [] } };
}

// Sets one proposal's state in the file. The write fails if the controller changed the file meanwhile.
export async function mark(key, state) {
  const { raw, queue } = await readQueue();
  const proposals = queue.proposals.map((p) => (p.key === key ? { ...p, state } : p));
  await writeTextFile(file(), `${JSON.stringify({ ...queue, proposals }, null, 2)}\n`, raw);
}

const pause = (ms) => exec("sleep", [String(ms / 1000)]);

// Answers "Yes" on Claude Code's trust screen for a new worktree, when agent.acceptTrust is on.
// Claude Code asks once for each new folder that carries its own pre-approved permissions.
// Resolves with true when it answered. It presses nothing unless the screen shows the question.
async function acceptTrust(terminal) {
  const YES = "Yes, I trust this folder";
  const screen = async () => out(await exec("hc", ["read", terminal, "--lines", "60"]));
  for (let tries = 0; tries < 15; tries++) {
    await pause(1000);
    const text = await screen();
    if (!text.includes(YES)) {
      // The prompt box means Claude Code started with no question.
      if (text.includes("? for shortcuts") || /\n\s*❯ /.test(text)) return false;
      continue;
    }
    const chosen = () => new RegExp(`❯\\s*${YES}`);
    if (!chosen().test(text)) {
      await exec("hc", ["keys", terminal, "down"]);
      await pause(400);
      if (!chosen().test(await screen())) return false;
    }
    await exec("hc", ["keys", terminal, "enter"]);
    return true;
  }
  return false;
}

// Makes a worktree in each repo of the proposal, then one space with a tab for each repo,
// and one Claude session that sees every worktree.
export async function approve(p) {
  if (busy(p.key)) return;
  setBusy(p.key, "starting");
  try {
    const cfg = await config();
    const cap = cfg.agent?.maxParallel ?? DEFAULT_CAP;
    const running = (await readQueue()).queue.proposals.filter((q) => q.state === "started" && spaceFor(q.key)).length;
    if (running >= cap) throw new Error(`${running} sessions run now and the cap is ${cap}. Finish one, or raise agent.maxParallel.`);
    if (!p.branch || !Array.isArray(p.repos) || p.repos.length === 0) throw new Error("The proposal names no branch or no repo.");

    const known = await repos();
    const places = [];
    for (const name of p.repos) {
      const repo = known.find((r) => r.name === name);
      if (!repo) throw new Error(`The repo ${name} is not in the Repos list.`);
      setBusy(p.key, `worktree in ${name}`);
      const have = (await checkouts(repo)).find((c) => c.branch === p.branch);
      places.push({ name, path: (have ?? (await makeWorktree(repo, p.branch))).path, isNew: !have });
    }

    const [first, ...rest] = places;
    // A start skill makes its own worktree unless it is told that one exists.
    const where = `The workspace exists: do not create a worktree or a branch. `
      + `This folder is the ${first.name} worktree on branch ${p.branch}.`
      + (rest.length ? ` The other worktrees of this ticket: ${rest.map((r) => `${r.name} at ${r.path}`).join(", ")}.` : "");
    const task = `${String(cfg.agent?.task ?? DEFAULT_TASK).replaceAll("{ticket}", p.key)}\n\n${where}`;
    // The first message goes before --add-dir: that flag takes every word after it as a folder.
    const argv = ["claude", task, ...(rest.length ? ["--add-dir", ...rest.map((r) => r.path)] : [])];
    const made = await make("space.new", { name: p.key, folder: first.path, tab: first.name, argv, focus: false });
    for (const other of rest) await make("tab.new", { space: made.space, name: other.name, folder: other.path, focus: false });
    // Only a worktree that this run made: an older folder may hold changes the person has not seen.
    if (cfg.agent?.acceptTrust === true && first.isNew && made.terminal) {
      setBusy(p.key, "trust screen");
      await acceptTrust(made.terminal);
    }
    await mark(p.key, "started");
    notify({ title: `${p.key} started`, body: places.map((x) => x.name).join(", "), level: "success", action: { name: "space.select", args: { id: made.space } } });
  } catch (err) {
    notify({ title: `${p.key} did not start`, body: message(err), level: "error" });
  }
  setBusy(p.key, null);
}

export async function skip(p) {
  try { await mark(p.key, "skipped"); } catch (err) { notify({ title: "Skip failed", body: message(err), level: "error" }); }
}

export function button(t, id, label, strong, press) {
  return div().id(id).px(8).h(22).rounded(5).items_center().flex()
    .bg(strong ? t.solid : t.raised).text_color(strong ? t.solid_foreground : t.foreground)
    .hover((s) => s.opacity(0.85))
    .on_click((_e, cx) => { cx.stop_propagation(); press(cx); })
    .child(label);
}

export class Queue {
  init(cx) {
    this.queue = { proposals: [] };
    this.error = "";
    if (checking()) return;
    // Shared state outlives the app. No work survives a restart, so no ticket is busy now.
    setShared(BUSY, {});
    this.load(cx);
    cx.timer.every(10000, (cx) => { this.load(cx); this.serve(cx); });
    cx.spawn(async (cx) => {
      for (;;) {
        await nextCommand();
        this.serve(cx);
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        await watchFolder(dir());
        await this.read();
        cx.notify();
      }
    });
  }

  load(cx) {
    cx.spawn(async (cx) => { await this.read(); cx.notify(); });
  }

  async read() {
    try {
      this.queue = (await readQueue()).queue;
      this.error = "";
    } catch (err) {
      this.error = `The queue file is not valid: ${message(err)}`;
    }
  }

  // Asks the controller for a new list. Starts the controller session when none is open.
  findNext(cx) {
    cx.spawn(async (cx) => {
      try {
        const space = spaces().find((s) => s.named && s.name === CONTROLLER);
        const tabs = new Set((space?.tabs ?? []).map((t) => t.id));
        const terminal = panes().find((p) => tabs.has(p.tab) && p.terminal)?.terminal;
        if (space && terminal) {
          await exec("hc", ["send", terminal, "/deck-next"]);
          run("space.select", { id: space.id });
        } else {
          const cfg = await config();
          const folder = String(cfg.controller?.folder ?? "~").replace(/^~(?=\/|$)/, home());
          run("space.new", { name: CONTROLLER, folder, argv: ["claude", "/deck-next", "--append-system-prompt", CONTROLLER_ROLE] });
        }
      } catch (err) {
        notify({ title: "Find next work failed", body: message(err), level: "error" });
      }
      cx.notify();
    });
  }

  // Does what a dialog asked for. The timer calls this too, in case the command did not arrive.
  serve(cx) {
    const asked = shared(REQUEST);
    if (!asked) return;
    setShared(REQUEST, null);
    const p = this.queue.proposals.find((q) => q.key === asked.key);
    if (p) this.act(asked.action === "skip" ? skip : approve, p, cx);
  }

  act(what, p, cx) {
    cx.spawn(async (cx) => { await what(p); await this.read(); cx.notify(); });
  }

  details(p) {
    openOverlay({ mod: "agent-deck", props: { view: "detail", key: p.key }, kind: "dialog", width: 620, height: 520 });
  }

  render(_cx) {
    const t = theme();
    const head = (p) => h_flex().gap(6).items_center()
      .child(div().id(`key-${p.key}`).font_semibold().text_color(t.accent)
        .when(Boolean(p.url), (el) => el.on_click((_e, cx) => { cx.stop_propagation(); exec("open", [p.url]); }))
        .child(p.key))
      .child(div().flex_1().truncate().text_color(t.foreground).child(p.title ?? ""));

    const proposed = (p) => v_flex().id(`card-${p.key}`).gap(3).p(8).rounded(7).bg(t.surface)
      .hover((s) => s.bg(t.raised))
      .on_click(() => this.details(p))
      .child(head(p))
      .when(Boolean(p.reason), (el) => el.child(div().text_color(t.muted).child(p.reason.length > 96 ? `${p.reason.slice(0, 96).trimEnd()}…` : p.reason)))
      .child(div().text_color(t.dim).child([...(p.repos ?? []), p.size].filter(Boolean).join(" · ")))
      .child(busy(p.key)
        ? div().text_color(t.working).child(`${busy(p.key)} …`)
        : h_flex().gap(6)
          .child(button(t, `ok-${p.key}`, "Approve", true, (cx) => this.act(approve, p, cx)))
          .child(button(t, `no-${p.key}`, "Skip", false, (cx) => this.act(skip, p, cx)))
          .child(button(t, `more-${p.key}`, "Details", false, () => this.details(p))));

    const started = (p) => {
      const space = spaceFor(p.key);
      return h_flex().id(`go-${p.key}`).h(24).px(8).gap(6).items_center().rounded(5)
        .hover((s) => s.bg(t.hover))
        .on_click(() => { if (space) run("space.select", { id: space.id }); })
        .child(div().w(6).h(6).rounded(3).bg(space ? t.accent : t.border))
        .child(div().text_color(space ? t.foreground : t.muted).child(p.key))
        .child(div().flex_1().truncate().text_color(t.dim).child(space ? (p.title ?? "") : "space closed"));
    };

    const list = this.queue.proposals;
    const open = list.filter((p) => (p.state ?? "proposed") === "proposed");
    const going = list.filter((p) => p.state === "started");

    return v_flex().id("agent-deck-queue").size_full().bg(t.chrome).p(8).gap(8).text_size(12.5).overflow_y_scrollbar()
      .child(h_flex().px(4).items_center().justify_between()
        .child(div().text_color(t.muted).child("Queue"))
        .child(button(t, "find-next", "Find next work", false, (cx) => this.findNext(cx))))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .when(!this.error && open.length === 0, (el) => el.child(div().px(4).text_color(t.dim).child("No proposals. Press Find next work.")))
      .children(open.map(proposed))
      .when(going.length > 0, (el) => el.child(div().px(4).pt(4).text_color(t.muted).child("In progress")).children(going.map(started)));
  }
}
