// agent-deck: one mod, two views. The layout picks one with props: { view: "repos" | "queue" }.

import { View } from "gpui-kit";
import { props } from "herdr";
import { Repos } from "./repos.js";
import { Queue } from "./queue.js";

export default class AgentDeck extends View {
  init(_props, cx) {
    this.view = props()?.view === "queue" ? new Queue() : new Repos();
    this.view.init(cx);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
