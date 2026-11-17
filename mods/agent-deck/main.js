// agent-deck: one mod, three views, picked with props: { view: "repos" | "queue" | "detail" }.
// The layout shows the first two. The Queue view opens the third as a dialog.

import { View } from "gpui-kit";
import { props } from "herdr";
import { Repos } from "./repos.js";
import { Queue } from "./queue.js";
import { Detail } from "./detail.js";

export default class AgentDeck extends View {
  init(_props, cx) {
    const view = props()?.view;
    this.view = view === "queue" ? new Queue() : view === "detail" ? new Detail() : new Repos();
    this.view.init(cx);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
