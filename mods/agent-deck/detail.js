// The Detail view: one proposal in full, as a dialog. Props: { key }.

import { div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { exec, run, theme, props, closeOverlay, checking } from "herdr";
import { proposalFor, request, busy, spaceFor, ticketsOf, label, button, message } from "./queue.js";

export class Detail {
  init(cx) {
    this.key = props()?.key;
    this.proposal = null;
    this.error = "";
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (checking()) return;
    cx.spawn(async (cx) => {
      try {
        this.proposal = await proposalFor(this.key);
        if (!this.proposal) this.error = `agent-deck has no proposal for ${this.key}.`;
      } catch (err) {
        this.error = message(err);
      }
      cx.notify();
    });
  }

  close() { closeOverlay(props()?.overlay); }

  // The Queue panel does the work and shows the progress: this dialog closes at once.
  act(action) {
    request(this.key, action);
    this.close();
  }

  render(_cx) {
    const t = theme();
    const p = this.proposal;
    const name = (text) => div().w(72).text_color(t.dim).child(text);
    const fact = (title, value) => h_flex().gap(8).child(name(title)).child(div().flex_1().text_color(t.foreground).child(value));
    const root = v_flex().id("agent-deck-detail").track_focus(this.handle).size_full().bg(t.popover).p(18).gap(12).text_size(13);
    if (!p) return root.child(div().text_color(this.error ? t.blocked : t.dim).child(this.error || "Loading …"));

    const state = p.state ?? "proposed";
    const space = spaceFor(p.key);
    const tickets = ticketsOf(p);
    const bundle = tickets.length > 1;
    const ticket = (tk, i) => h_flex().id(`detail-ticket-${tk.key}`).gap(8)
      .when(Boolean(tk.url), (el) => el.on_click(() => { exec("open", [tk.url]); }))
      .child(div().w(16).text_color(t.dim).child(`${i + 1}.`))
      .child(div().text_color(t.accent).child(tk.key))
      .child(div().flex_1().text_color(t.foreground).child(tk.title ?? ""));
    return root
      .child(h_flex().gap(8).items_center()
        .child(div().font_semibold().text_color(t.accent).child(label(p)))
        .child(div().px(6).rounded(4).bg(t.raised).text_color(t.muted).text_size(11.5).child(state)))
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child(p.title ?? ""))
      .child(v_flex().id("agent-deck-detail-body").flex_1().gap(12).overflow_y_scrollbar()
        .child(v_flex().gap(4)
          .child(fact("Repos", (p.repos ?? []).join(", ") || "none named"))
          .child(fact("Branch", p.branch ?? "none named"))
          .when(Boolean(p.size), (el) => el.child(fact("Size", p.size))))
        .when(bundle, (el) => el.child(v_flex().gap(4)
          .child(div().text_color(t.dim).child("One space and one session do these in order. Each ticket gets its own pull request, stacked on the one before."))
          .children(tickets.map(ticket))))
        .when(Boolean(p.reason), (el) => el.child(v_flex().gap(4)
          .child(div().text_color(t.dim).child("Why it is next"))
          .child(div().text_color(t.foreground).child(p.reason))))
        .when(Boolean(p.details), (el) => el.child(v_flex().gap(4)
          .child(div().text_color(t.dim).child("Details"))
          .child(TextView.markdown(`detail-${p.key}`, String(p.details)).selectable(true))))
        .when(!p.details, (el) => el.child(div().text_color(t.dim).child("The controller wrote no details for this ticket. Press Find next work for a new list with details."))))
      .child(h_flex().gap(8).items_center()
        .when(state === "proposed" && !busy(p.key), (el) => el
          .child(button(t, "detail-ok", "Approve", true, () => this.act("approve")))
          .child(button(t, "detail-no", "Skip", false, () => this.act("skip")))
          .when(bundle, (el2) => el2.child(button(t, "detail-split", "Split", false, () => this.act("split")))))
        .when(Boolean(busy(p.key)), (el) => el.child(div().text_color(t.working).child(`${busy(p.key)} …`)))
        .when(state === "started" && Boolean(space), (el) => el
          .child(button(t, "detail-go", "Go to its space", true, () => { run("space.select", { id: space.id }); this.close(); })))
        .when(Boolean(p.url), (el) => el.child(button(t, "detail-url", "Open the ticket", false, () => { exec("open", [p.url]); })))
        .child(div().flex_1())
        .child(button(t, "detail-close", "Close", false, () => this.close())));
  }
}
