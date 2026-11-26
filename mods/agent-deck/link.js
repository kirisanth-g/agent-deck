// The link handler: a Ctrl/Cmd-click on a ticket address in a terminal shows the agent-deck proposal.
// A ticket that agent-deck does not know passes on, and opens in the browser as before.

import { openOverlay } from "herdr";
import { readQueue, proposalFor, ticketsOf } from "./store.js";

export async function handleLink({ link }) {
  const key = link.kind === "url" ? link.url.match(/\/browse\/([A-Z][A-Z0-9]*-\d+)/)?.[1] : null;
  if (!key) return "pass";
  try {
    // A later ticket of a bundle has no entry of its own: its bundle has the proposal.
    const owner = (await readQueue()).queue.proposals.find((p) => ticketsOf(p).some((tk) => tk.key === key));
    const p = owner ?? (await proposalFor(key));
    if (!p) return "pass";
    openOverlay({ mod: "agent-deck", props: { view: "detail", key: p.key }, kind: "dialog", width: 620, height: 520 });
    return "handled";
  } catch {
    return "pass";
  }
}
