// agent-deck: your repos, their worktrees, and the Herdr space for each.
// The repos come from `wt repo ls`, plus `repos.add` and minus `repos.hide` in the config file.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, spaces, panes, run, theme, notify, checking, home, readTextFile } from "herdr";

const CONFIG = ".config/agent-deck/config.json";

const out = (r) => (r.stdout ?? "").trim();

// The config file is optional. A file that is not valid JSON is an error the panel shows.
async function config() {
  const raw = await readTextFile(`${home()}/${CONFIG}`);
  if (raw === null) return {};
  try { return JSON.parse(raw); } catch { throw new Error(`~/${CONFIG} is not valid JSON.`); }
}

// `wt repo ls` prints a table: name, path, domain, ports. The first line is the header.
// A repo that wt does not know has `wt: false`: its worktrees are made with git alone.
async function repos() {
  const { add = [], hide = [] } = (await config()).repos ?? {};
  const r = await exec("wt", ["repo", "ls"]);
  const list = r.code !== 0 ? [] : out(r).split("\n").slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2 && cols[1].startsWith("/"))
    .map(([name, path]) => ({ name, path, wt: true }));
  for (const entry of add) {
    const path = String(entry).replace(/^~(?=\/|$)/, home()).replace(/\/+$/, "");
    if (!list.some((repo) => repo.path === path)) list.push({ name: path.split("/").pop(), path, wt: false });
  }
  return list.filter((repo) => !hide.includes(repo.name));
}

// Makes a worktree beside the repo, in `<repo>.worktrees/<branch>`, the place wt uses.
// A branch that exists is checked out. A new branch starts from the fetched default branch.
async function gitWorktree(repo, branch) {
  const git = (args, timeout) => exec("git", args, { cwd: repo.path, ...(timeout ? { timeout } : {}) });
  await git(["fetch", "origin"], 120000);
  const path = `${repo.path}.worktrees/${branch}`;
  const known = (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0
    || (await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`])).code === 0;
  const head = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const base = head.code === 0 ? out(head) : "HEAD";
  return git(known ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, base], 120000);
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
    if (branch.includes("/")) return notify({ title: "New worktree", body: "Use '-' in the branch name, not '/'.", level: "error" });
    this.busy = repo.wt ? `wt new ${branch}` : `git worktree add ${branch}`;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // wt new copies the env files and the Claude setup, and registers the dev host.
        const r = repo.wt
          ? await exec("wt", ["new", branch, "--no-code"], { cwd: repo.path, timeout: 600000 })
          : await gitWorktree(repo, branch);
        if (r.code !== 0) throw new Error((r.stderr ?? "").trim() || out(r) || "The worktree was not made.");
        repo.checkouts = await checkouts(repo);
        const made = repo.checkouts.find((c) => c.branch === branch);
        if (!made) throw new Error(`The command finished, but no worktree is on ${branch}.`);
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
      .when(!this.error && this.repos.length === 0, (el) => el.child(div().text_color(t.dim).child("No repos yet. Register one with `wt repo add`, or list it in ~/.config/agent-deck/config.json.")))
      .children(this.repos.map(group));
  }
}
