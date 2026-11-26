// The Queue view: the tickets the controller proposes, and the ones in progress.
// The controller is a Claude session. It writes the queue file; this view never ranks work.
// Nothing starts until the person presses Approve.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, spaces, panes, theme, notify, checking, home, appHome, readTextFile, writeTextFile, watchFolder, openOverlay, shared, setShared, nextCommand } from "herdr";
import { config, repos, checkouts, makeWorktree, make, out } from "./lib.js";
import { openSettings } from "./link.js";

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
const REQUEST = "agent-deck.request"; // { key, action: "approve" | "skip" | "split" } or null

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

// The tickets of a proposal. A bundle holds two or more: one space and one session do them in order.
export const ticketsOf = (p) => (Array.isArray(p.tickets) && p.tickets.length > 1 ? p.tickets : [{ key: p.key, title: p.title, url: p.url }]);
export const label = (p) => (ticketsOf(p).length > 1 ? `${p.key} +${ticketsOf(p).length - 1}` : p.key);

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

// Turns a bundle back into one proposal for each ticket.
export async function split(p) {
  try {
    const { raw, queue } = await readQueue();
    const single = (q, tk) => ({
      key: tk.key, title: tk.title, url: tk.url, reason: tk.reason ?? q.reason, repos: tk.repos ?? q.repos,
      branch: tk.key, size: tk.size ?? q.size, details: tk.details ?? q.details, state: "proposed",
    });
    const proposals = queue.proposals.flatMap((q) => (q.key === p.key ? ticketsOf(q).map((tk) => single(q, tk)) : [q]));
    await writeTextFile(file(), `${JSON.stringify({ ...queue, proposals }, null, 2)}\n`, raw);
  } catch (err) {
    notify({ title: "Split failed", body: message(err), level: "error" });
  }
}

// The controller removes a started entry when its work is merged. The saved copy keeps
// the proposal for as long as the person wants to read it.
const saved = (key) => `${dir()}/tickets/${key}.json`;
async function save(p) {
  await exec("mkdir", ["-p", `${dir()}/tickets`]);
  await writeTextFile(saved(p.key), `${JSON.stringify({ ...p, state: "started" }, null, 2)}\n`, await readTextFile(saved(p.key)));
}

// The proposal for a key: from the queue, or else the copy saved at Approve. Null when neither has it.
export async function proposalFor(key) {
  const live = (await readQueue()).queue.proposals.find((p) => p.key === key);
  if (live) return live;
  const raw = await readTextFile(saved(key));
  return raw === null ? null : JSON.parse(raw);
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
    const keys = ticketsOf(p).map((tk) => tk.key);
    const bundle = keys.length > 1;
    // A start skill makes its own worktree unless it is told that one exists.
    const where = `The workspace exists: do not create a worktree${bundle ? "" : " or a branch"}. `
      + `This folder is the ${first.name} worktree on branch ${p.branch}.`
      + (rest.length ? ` The other worktrees: ${rest.map((r) => `${r.name} at ${r.path}`).join(", ")}.` : "");
    // Each ticket of a bundle keeps its own pull request, so the branches form a stack.
    const order = bundle
      ? `\n\nThis space holds ${keys.length} related tickets. Do them in this order: ${keys.join(", ")}. `
        + `Give each ticket its own branch and its own pull request. Branch ${p.branch} is for ${keys[0]}. `
        + `Make the branch of each later ticket in these same worktrees, from the branch of the ticket before it, `
        + `and set the base of its pull request to that branch, so the pull requests form a stack. `
        + `Open the pull request of a ticket before you start the next ticket.`
      : "";
    const task = `${String(cfg.agent?.task ?? DEFAULT_TASK).replaceAll("{ticket}", keys.join(" "))}\n\n${where}${order}`;
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
    await save(p);
    notify({ title: `${label(p)} started`, body: places.map((x) => x.name).join(", "), level: "success", action: { name: "space.select", args: { id: made.space } } });
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
        const command = String(await nextCommand());
        if (command.endsWith("find-next")) this.findNext(cx);
        if (command.endsWith("ticket")) this.ticket();
        if (command.endsWith("settings")) openSettings();
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
    if (p) this.act({ skip, split }[asked.action] ?? approve, p, cx);
  }

  act(what, p, cx) {
    cx.spawn(async (cx) => { await what(p); await this.read(); cx.notify(); });
  }

  details(p) {
    openOverlay({ mod: "agent-deck", props: { view: "detail", key: p.key }, kind: "dialog", width: 620, height: 520 });
  }

  // Shows the proposal of the space that the person is in. A ticket space has the name of its first ticket.
  ticket() {
    const space = spaces().find((s) => s.active);
    if (space?.named) this.details({ key: space.name });
    else notify({ title: "This space is not a ticket space", level: "warning" });
  }

  render(_cx) {
    const t = theme();
    const head = (p) => h_flex().gap(6).items_center()
      .child(div().id(`key-${p.key}`).font_semibold().text_color(t.accent)
        .when(Boolean(p.url), (el) => el.on_click((_e, cx) => { cx.stop_propagation(); exec("open", [p.url]); }))
        .child(label(p)))
      .child(div().flex_1().truncate().text_color(t.foreground).child(p.title ?? ""));
    const bundled = (p) => ticketsOf(p).length > 1;

    const proposed = (p) => v_flex().id(`card-${p.key}`).gap(3).p(8).rounded(7).bg(t.surface)
      .hover((s) => s.bg(t.raised))
      .on_click(() => this.details(p))
      .child(head(p))
      .when(bundled(p), (el) => el.child(div().text_color(t.foreground).child(`One space, in order: ${ticketsOf(p).map((tk) => tk.key).join(", ")}`)))
      .when(Boolean(p.reason), (el) => el.child(div().text_color(t.muted).child(p.reason.length > 96 ? `${p.reason.slice(0, 96).trimEnd()}…` : p.reason)))
      .child(div().text_color(t.dim).child([...(p.repos ?? []), p.size].filter(Boolean).join(" · ")))
      .child(busy(p.key)
        ? div().text_color(t.working).child(`${busy(p.key)} …`)
        : h_flex().gap(6)
          .child(button(t, `ok-${p.key}`, "Approve", true, (cx) => this.act(approve, p, cx)))
          .child(button(t, `no-${p.key}`, "Skip", false, (cx) => this.act(skip, p, cx)))
          .when(bundled(p), (el) => el.child(button(t, `split-${p.key}`, "Split", false, (cx) => this.act(split, p, cx))))
          .child(button(t, `more-${p.key}`, "Details", false, () => this.details(p))));

    const started = (p) => {
      const space = spaceFor(p.key);
      return h_flex().id(`go-${p.key}`).h(24).px(8).gap(6).items_center().rounded(5)
        .hover((s) => s.bg(t.hover))
        .on_click(() => { if (space) run("space.select", { id: space.id }); })
        .child(div().w(6).h(6).rounded(3).bg(space ? t.accent : t.border))
        .child(div().text_color(space ? t.foreground : t.muted).child(label(p)))
        .child(div().flex_1().truncate().text_color(t.dim).child(space ? (p.title ?? "") : "space closed"))
        .child(button(t, `info-${p.key}`, "Details", false, () => this.details(p)));
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
