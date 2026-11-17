// agent-deck: the repos registered with `wt`, their worktrees, and the Herdr space for each.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, spaces, panes, run, theme, notify, checking } from "herdr";

const out = (r) => (r.stdout ?? "").trim();

// `wt repo ls` prints a table: name, path, domain, ports. The first line is the header.
async function repos() {
  const r = await exec("wt", ["repo", "ls"]);
  if (r.code !== 0) throw new Error(out(r) || (r.stderr ?? "").trim() || "wt repo ls failed");
  return out(r).split("\n").slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2 && cols[1].startsWith("/"))
    .map(([name, path]) => ({ name, path }));
}

// Every checkout of a repo, the main one first: { path, branch, main }.
async function checkouts(repo) {
  const r = await exec("git", ["worktree", "list", "--porcelain"], { cwd: repo.path });
  if (r.code !== 0) return [];
  const list = [];
  for (const block of out(r).split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? "(detached)";
    list.push({ path, branch, main: list.length === 0 });
  }
  return list;
}

// The space whose terminals are in this checkout. The deepest checkout wins.
function spaceOf(path, all) {
  const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
  const paneList = panes();
  return spaces().find((s) => {
    if (s.machine) return false;
    const tabs = new Set((s.tabs ?? []).map((t) => t.id));
    const at = paneList.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
    if (!at || !inside(at, path)) return false;
    return !all.some((c) => c.path.length > path.length && inside(at, c.path));
  });
}

export default class AgentDeck extends View {
  init(_props, cx) {
    this.repos = [];       // [{ name, path, checkouts }]
    this.error = "";
    this.adding = null;    // the repo name that shows the branch input
    this.busy = "";        // what runs now, shown as one line
    this.branch = "";
    this.input = InputState.new({ value: "", placeholder: "branch or ticket key" });
    this.input.on("change", (_e, cx) => { this.branch = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.create(cx));
    if (checking()) return;
    cx.timer.every(15000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        const list = await repos();
        for (const repo of list) repo.checkouts = await checkouts(repo);
        this.repos = list;
        this.error = "";
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      }
      cx.notify();
    });
  }

  all() { return this.repos.flatMap((r) => r.checkouts); }

  open(repo, checkout) {
    const space = spaceOf(checkout.path, this.all());
    if (space) return run("space.select", { id: space.id });
    return run("space.new", { name: checkout.main ? repo.name : `${repo.name} · ${checkout.branch}`, folder: checkout.path });
  }

  create(cx) {
    const repo = this.repos.find((r) => r.name === this.adding);
    const branch = this.branch.trim();
    if (!repo || !branch || this.busy) return;
    this.busy = `wt new ${branch}`;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // wt new copies the env files and the Claude setup, and registers the dev host.
        const r = await exec("wt", ["new", branch, "--no-code"], { cwd: repo.path, timeout: 600000 });
        if (r.code !== 0) throw new Error((r.stderr ?? "").trim() || out(r) || "wt new failed");
        repo.checkouts = await checkouts(repo);
        const made = repo.checkouts.find((c) => c.branch === branch);
        if (!made) throw new Error(`wt new finished, but no worktree is on ${branch}.`);
        this.adding = null;
        this.open(repo, made);
      } catch (err) {
        notify({ title: "New worktree failed", body: err instanceof Error ? err.message : String(err), level: "error" });
      }
      this.busy = "";
      cx.notify();
    });
  }

  render(_cx) {
    const t = theme();
    const all = this.all();
    const row = (repo, c) => {
      const space = spaceOf(c.path, all);
      return h_flex().id(`co-${c.path}`).h(24).px(8).gap(6).items_center().rounded(5)
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.open(repo, c))
        .child(div().w(6).h(6).rounded(3).bg(space ? t.accent : t.border))
        .child(div().flex_1().truncate().text_color(space ? t.foreground : t.muted).child(c.main ? `${c.branch} (main checkout)` : c.branch));
    };
    const group = (repo) => v_flex().gap(1)
      .child(h_flex().h(26).px(4).items_center().justify_between()
        .child(div().font_semibold().text_color(t.foreground).child(repo.name))
        .child(div().id(`add-${repo.name}`).px(6).rounded(5).text_color(t.muted)
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            this.adding = this.adding === repo.name ? null : repo.name;
            this.branch = "";
            this.input.set_value("");
            if (this.adding) this.input.focus();
            cx.notify();
          })
          .child("+ worktree")))
      .when(this.adding === repo.name, (el) => el.child(
        this.busy
          ? div().px(8).text_color(t.muted).child(`${this.busy} …`)
          : Input.new(this.input).h(28).px(8).items_center().rounded(6).border(1).border_color(t.input).bg(t.background).text_color(t.foreground)))
      .children(repo.checkouts.map((c) => row(repo, c)));

    return v_flex().id("agent-deck").size_full().bg(t.chrome).p(8).gap(10).text_size(12.5).overflow_y_scrollbar()
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .when(!this.error && this.repos.length === 0, (el) => el.child(div().text_color(t.dim).child("No repos yet. Register one with `wt repo add`.")))
      .children(this.repos.map(group));
  }
}
