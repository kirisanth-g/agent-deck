// agent-deck: one mod, five views, picked with props: { view }.
// The layout shows "repos", "queue" and "link". "detail" and "settings" open as dialogs.

import { View } from "gpui-kit";
import { props } from "herdr";
import { Repos } from "./repos.js";
import { Queue } from "./queue.js";
import { Detail } from "./detail.js";
import { Settings } from "./settings.js";
import { Link } from "./row.js";

export default class AgentDeck extends View {
  init(_props, cx) {
    const view = props()?.view;
    const views = { queue: Queue, detail: Detail, settings: Settings, link: Link };
    this.view = new (views[view] ?? Repos)();
    this.view.init(cx);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
