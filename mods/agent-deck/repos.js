// The Repos view: your repos, their worktrees, and the Herdr space for each.
// The repos come from `wt repo ls`, plus `repos.add` and minus `repos.hide` in the config file.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, theme, notify, checking } from "herdr";
import { repos, checkouts, spaceOf, makeWorktree } from "./lib.js";

export class Repos {
  init(cx) {
    this.repos = [];       // [{ name, path, wt, checkouts }]
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
        const made = await makeWorktree(repo, branch);
        repo.checkouts = await checkouts(repo);
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

    return v_flex().id("agent-deck-repos").size_full().bg(t.chrome).p(8).gap(10).text_size(12.5).overflow_y_scrollbar()
      .child(div().px(4).text_color(t.muted).child("Repos"))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .when(!this.error && this.repos.length === 0, (el) => el.child(div().text_color(t.dim).child("No repos yet. Register one with `wt repo add`, or list it in ~/.config/agent-deck/config.json.")))
      .children(this.repos.map(group));
  }
}
