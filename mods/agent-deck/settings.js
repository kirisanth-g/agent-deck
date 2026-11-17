// The Settings view: the config file as a dialog. Each change is saved at once.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, theme, props, closeOverlay, notify, pickFolder, home, checking } from "herdr";
import { readConfig, writeConfig, wtRepos, expand } from "./lib.js";
import { button, message } from "./queue.js";

// The text settings: where each lives in the config, and what the dialog says about it.
const FIELDS = [
  { id: "jql", at: ["tracker", "candidateJql"], title: "Ticket search", help: "The search the controller runs to find candidate tickets.", placeholder: "project = ABC AND assignee = currentUser() ORDER BY rank" },
  { id: "folder", at: ["controller", "folder"], title: "Controller folder", help: "The folder the controller session starts in. Empty: your home folder.", placeholder: "~" },
  { id: "task", at: ["agent", "task"], title: "First message of a ticket session", help: "{ticket} is the ticket key. Empty: /ticket-start {ticket}.", placeholder: "/ticket-start {ticket}" },
];

const DEFAULT_CAP = 3;
const tilde = (path) => (path.startsWith(home()) ? `~${path.slice(home().length)}` : path);

export class Settings {
  init(cx) {
    this.raw = null;
    this.cfg = {};
    this.wt = [];           // the repos wt knows
    this.error = "";
    this.inputs = {};
    this.handle = cx.focus_handle();
    this.handle.focus();
    for (const field of FIELDS) {
      const input = InputState.new({ value: "", placeholder: field.placeholder });
      input.on("blur", (_e, cx) => this.saveText(field, cx));
      input.on("submit", (_e, cx) => this.saveText(field, cx));
      this.inputs[field.id] = input;
    }
    if (checking()) return;
    cx.spawn(async (cx) => {
      await this.load();
      this.wt = await wtRepos();
      for (const field of FIELDS) this.inputs[field.id].set_value(String(this.get(field.at) ?? ""));
      cx.notify();
    });
  }

  async load() {
    try {
      const read = await readConfig();
      this.raw = read.raw;
      this.cfg = read.cfg;
      this.error = "";
    } catch (err) {
      this.error = message(err);
    }
  }

  get(at) { return at.reduce((node, key) => node?.[key], this.cfg); }

  // Reads the file again, applies one change, and writes it. Other keys in the file stay as they are.
  save(change, cx) {
    cx.spawn(async (cx) => {
      try {
        await this.load();
        if (this.error) throw new Error(this.error);
        const next = JSON.parse(JSON.stringify(this.cfg));
        change(next);
        await writeConfig(next, this.raw);
        await this.load();
        run("agent-deck.reload");
      } catch (err) {
        notify({ title: "The setting was not saved", body: message(err), level: "error" });
      }
      cx.notify();
    });
  }

  set(at, value, cx) {
    this.save((cfg) => {
      let node = cfg;
      for (const key of at.slice(0, -1)) node = node[key] ??= {};
      if (value === undefined) delete node[at.at(-1)]; else node[at.at(-1)] = value;
    }, cx);
  }

  saveText(field, cx) {
    const value = this.inputs[field.id].value().trim();
    if (value === String(this.get(field.at) ?? "")) return;
    this.set(field.at, value || undefined, cx);
  }

  repoList(update, cx) {
    this.save((cfg) => {
      cfg.repos ??= {};
      update(cfg.repos);
    }, cx);
  }

  addRepo(cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Add repo" });
      if (!folder) return;
      const path = tilde(folder.replace(/\/+$/, ""));
      this.repoList((repos) => { repos.add = [...new Set([...(repos.add ?? []), path])]; }, cx);
    });
  }

  render(_cx) {
    const t = theme();
    const section = (title) => div().pt(6).font_semibold().text_color(t.foreground).child(title);
    const help = (text) => div().text_color(t.dim).text_size(12).child(text);
    const toggle = (id, on, press) => div().id(id).w(44).h(22).rounded(11).px(3).flex().items_center()
      .bg(on ? t.accent : t.border)
      .on_click((_e, cx) => press(cx))
      .child(div().w(16).h(16).rounded(8).bg(t.background).when(on, (el) => el.ml(22)));
    const text = (field) => v_flex().gap(3)
      .child(div().text_color(t.foreground).child(field.title))
      .child(Input.new(this.inputs[field.id]).h(30).px(8).items_center().rounded(6).border(1).border_color(t.input).bg(t.background).text_color(t.foreground))
      .child(help(field.help));

    const cap = this.get(["agent", "maxParallel"]) ?? DEFAULT_CAP;
    const trust = this.get(["agent", "acceptTrust"]) === true;
    const added = (this.cfg.repos?.add ?? []).map((entry) => ({ entry, path: expand(entry) }));
    const hidden = this.cfg.repos?.hide ?? [];
    const all = [
      ...this.wt.map((r) => ({ name: r.name, path: r.path, from: "wt" })),
      ...added.filter((a) => !this.wt.some((r) => r.path === a.path)).map((a) => ({ name: a.path.split("/").pop(), path: a.path, entry: a.entry, from: "added" })),
    ];

    const repo = (r) => {
      const shown = !hidden.includes(r.name);
      return h_flex().h(28).gap(8).items_center()
        .child(toggle(`show-${r.path}`, shown, (cx) => this.repoList((repos) => {
          repos.hide = shown ? [...new Set([...(repos.hide ?? []), r.name])] : (repos.hide ?? []).filter((n) => n !== r.name);
        }, cx)))
        .child(div().w(150).truncate().text_color(shown ? t.foreground : t.muted).child(r.name))
        .child(div().flex_1().truncate().text_color(t.dim).text_size(12).child(tilde(r.path)))
        .child(r.from === "wt"
          ? div().text_color(t.dim).text_size(12).child("from wt")
          : button(t, `drop-${r.path}`, "Remove", false, (cx) => this.repoList((repos) => {
            repos.add = (repos.add ?? []).filter((e) => e !== r.entry);
          }, cx)));
    };

    return v_flex().id("agent-deck-settings").track_focus(this.handle).size_full().bg(t.popover).p(18).gap(10).text_size(13)
      .child(h_flex().items_center().justify_between()
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("agent-deck settings"))
        .child(button(t, "settings-close", "Close", false, () => closeOverlay(props()?.overlay))))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(v_flex().id("agent-deck-settings-body").flex_1().gap(10).overflow_y_scrollbar()
        .child(section("Finding work"))
        .child(text(FIELDS[0]))
        .child(text(FIELDS[1]))
        .child(section("Ticket sessions"))
        .child(text(FIELDS[2]))
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().text_color(t.foreground).child("Sessions at once"))
          .child(button(t, "cap-less", "−", false, (cx) => { if (cap > 1) this.set(["agent", "maxParallel"], cap - 1, cx); }))
          .child(div().w(24).text_color(t.foreground).child(String(cap)))
          .child(button(t, "cap-more", "+", false, (cx) => this.set(["agent", "maxParallel"], cap + 1, cx))))
        .child(h_flex().gap(8).items_center()
          .child(v_flex().flex_1().gap(2)
            .child(div().text_color(t.foreground).child("Answer the trust screen"))
            .child(help("Answer Yes on Claude Code's trust screen for a worktree that agent-deck just made. You no longer see what the folder pre-approves.")))
          .child(toggle("trust", trust, (cx) => this.set(["agent", "acceptTrust"], !trust, cx))))
        .child(h_flex().pt(6).items_center().justify_between()
          .child(div().font_semibold().text_color(t.foreground).child("Repos"))
          .child(button(t, "repo-add", "Add a repo folder", false, (cx) => this.addRepo(cx))))
        .child(help("A repo that is switched off stays out of the Repos panel and out of the controller's list."))
        .children(all.map(repo)));
  }
}
