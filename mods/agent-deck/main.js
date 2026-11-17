// agent-deck: one mod, four views, picked with props: { view: "repos" | "queue" | "detail" | "settings" }.
// The layout shows the first two. The Queue view opens the other two as dialogs.

import { View } from "gpui-kit";
import { props } from "herdr";
import { Repos } from "./repos.js";
import { Queue } from "./queue.js";
import { Detail } from "./detail.js";
import { Settings } from "./settings.js";

export default class AgentDeck extends View {
  init(_props, cx) {
    const view = props()?.view;
    const views = { queue: Queue, detail: Detail, settings: Settings };
    this.view = new (views[view] ?? Repos)();
    this.view.init(cx);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
