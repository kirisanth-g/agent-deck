// The Link view: one row above Herdr's Settings row that opens the agent-deck settings.
// Herdr's Settings window has no place for a mod, so the row sits next to its entry.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, openOverlay } from "herdr";

export const openSettings = () => openOverlay({ mod: "agent-deck", props: { view: "settings" }, kind: "dialog", width: 640, height: 600 });

export class Link {
  init(_cx) {}

  render(_cx) {
    const t = theme();
    return div().size_full().bg(t.chrome).px(8).pt(4).text_size(13)
      .child(h_flex().id("agent-deck-settings-link").h(28).px(8).gap(9).items_center().rounded(8)
        .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(() => { openSettings(); })
        .child(div().w(14).text_color(t.dim).child("◆"))
        .child("agent-deck settings"));
  }
}
