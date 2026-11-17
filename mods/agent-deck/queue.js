// The Queue view: the tickets the controller proposes, and the ones in progress.
// The controller is a Claude session. It writes the queue file; this view never ranks work.
// Nothing starts until the person presses Approve.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, spaces, panes, theme, notify, checking, home, appHome, readTextFile, writeTextFile, watchFolder } from "herdr";
import { config, repos, checkouts, makeWorktree, make } from "./lib.js";

const CONTROLLER = "Controller";
const DEFAULT_TASK = "/ticket-start {ticket}";
const DEFAULT_CAP = 3;

const dir = () => `${appHome()}/data/agent-deck`;
const file = () => `${dir()}/queue.json`;
const message = (err) => (err instanceof Error ? err.message : String(err));

export class Queue {
  init(cx) {
    this.raw = null;        // the file text this view last read: the snapshot a write must match
    this.queue = { proposals: [] };
    this.error = "";
    this.busy = {};         // ticket key -> what runs for it now
    if (checking()) return;
    this.load(cx);
    cx.timer.every(10000, (cx) => this.load(cx));
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
      const raw = await readTextFile(file());
      this.raw = raw;
      const parsed = raw === null ? {} : JSON.parse(raw);
      this.queue = { ...parsed, proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [] };
      this.error = "";
    } catch (err) {
      this.error = `The queue file is not valid: ${message(err)}`;
    }
  }

  // Sets one proposal's state in the file. The write fails if the controller changed the file meanwhile.
  async mark(key, state) {
    await this.read();
    const proposals = this.queue.proposals.map((p) => (p.key === key ? { ...p, state } : p));
    const text = `${JSON.stringify({ ...this.queue, proposals }, null, 2)}\n`;
    await writeTextFile(file(), text, this.raw);
    await this.read();
  }

  spaceFor(key) { return spaces().find((s) => s.named && s.name === key); }

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
          run("space.new", { name: CONTROLLER, folder, argv: ["claude"], task: "/deck-next" });
        }
      } catch (err) {
        notify({ title: "Find next work failed", body: message(err), level: "error" });
      }
      cx.notify();
    });
  }

  // Makes a worktree in each repo of the proposal, then one space with a tab for each repo,
  // and one Claude session that sees every worktree.
  approve(p, cx) {
    if (this.busy[p.key]) return;
    this.busy[p.key] = "starting";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const cfg = await config();
        const cap = cfg.agent?.maxParallel ?? DEFAULT_CAP;
        const running = this.queue.proposals.filter((q) => q.state === "started" && this.spaceFor(q.key)).length;
        if (running >= cap) throw new Error(`${running} sessions run now and the cap is ${cap}. Finish one, or raise agent.maxParallel.`);
        if (!p.branch || !Array.isArray(p.repos) || p.repos.length === 0) throw new Error("The proposal names no branch or no repo.");

        const known = await repos();
        const places = [];
        for (const name of p.repos) {
          const repo = known.find((r) => r.name === name);
          if (!repo) throw new Error(`The repo ${name} is not in the Repos list.`);
          this.busy[p.key] = `worktree in ${name}`;
          cx.notify();
          const have = (await checkouts(repo)).find((c) => c.branch === p.branch);
          places.push({ name, path: (have ?? (await makeWorktree(repo, p.branch))).path });
        }

        const [first, ...rest] = places;
        const task = String(cfg.agent?.task ?? DEFAULT_TASK).replaceAll("{ticket}", p.key);
        const argv = ["claude", ...(rest.length ? ["--add-dir", ...rest.map((r) => r.path)] : [])];
        const made = await make("space.new", { name: p.key, folder: first.path, tab: first.name, argv, task, focus: false });
        for (const other of rest) await make("tab.new", { space: made.space, name: other.name, folder: other.path, focus: false });
        await this.mark(p.key, "started");
        notify({ title: `${p.key} started`, body: places.map((x) => x.name).join(", "), level: "success", action: { name: "space.select", args: { id: made.space } } });
      } catch (err) {
        notify({ title: `${p.key} did not start`, body: message(err), level: "error" });
      }
      delete this.busy[p.key];
      cx.notify();
    });
  }

  skip(p, cx) {
    cx.spawn(async (cx) => {
      try { await this.mark(p.key, "skipped"); } catch (err) { notify({ title: "Skip failed", body: message(err), level: "error" }); }
      cx.notify();
    });
  }

  render(_cx) {
    const t = theme();
    const button = (id, label, strong, press) => div().id(id).px(8).h(22).rounded(5).items_center().flex()
      .bg(strong ? t.solid : t.raised).text_color(strong ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => press(cx))
      .child(label);

    const head = (p) => h_flex().gap(6).items_center()
      .child(div().id(`key-${p.key}`).font_semibold().text_color(t.accent)
        .when(Boolean(p.url), (el) => el.on_click(() => { exec("open", [p.url]); }))
        .child(p.key))
      .child(div().flex_1().truncate().text_color(t.foreground).child(p.title ?? ""));

    const proposed = (p) => v_flex().gap(3).p(8).rounded(7).bg(t.surface)
      .child(head(p))
      .when(Boolean(p.reason), (el) => el.child(div().text_color(t.muted).child(p.reason)))
      .child(div().text_color(t.dim).child([...(p.repos ?? []), p.size].filter(Boolean).join(" · ")))
      .child(this.busy[p.key]
        ? div().text_color(t.working).child(`${this.busy[p.key]} …`)
        : h_flex().gap(6)
          .child(button(`ok-${p.key}`, "Approve", true, (cx) => this.approve(p, cx)))
          .child(button(`no-${p.key}`, "Skip", false, (cx) => this.skip(p, cx))));

    const started = (p) => {
      const space = this.spaceFor(p.key);
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
        .child(button("find-next", "Find next work", false, (cx) => this.findNext(cx))))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .when(!this.error && open.length === 0, (el) => el.child(div().px(4).text_color(t.dim).child("No proposals. Press Find next work.")))
      .children(open.map(proposed))
      .when(going.length > 0, (el) => el.child(div().px(4).pt(4).text_color(t.muted).child("In progress")).children(going.map(started)));
  }
}
