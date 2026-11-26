// The queue file and the saved proposals. No view code: the link handler loads this file too.

import { appHome, readTextFile } from "herdr";

export const dir = () => `${appHome()}/data/agent-deck`;
export const file = () => `${dir()}/queue.json`;
// The controller removes a started entry when its work is merged. The saved copy keeps
// the proposal for as long as the person wants to read it.
export const saved = (key) => `${dir()}/tickets/${key}.json`;

// The tickets of a proposal. A bundle holds two or more: one space and one session do them in order.
export const ticketsOf = (p) => (Array.isArray(p.tickets) && p.tickets.length > 1 ? p.tickets : [{ key: p.key, title: p.title, url: p.url }]);
export const label = (p) => (ticketsOf(p).length > 1 ? `${p.key} +${ticketsOf(p).length - 1}` : p.key);

// Reads the queue file: { raw, queue }. `raw` is the snapshot a write must match.
export async function readQueue() {
  const raw = await readTextFile(file());
  const parsed = raw === null ? {} : JSON.parse(raw);
  return { raw, queue: { ...parsed, proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [] } };
}

// The proposal for a key: from the queue, or else the copy saved at Approve. Null when neither has it.
export async function proposalFor(key) {
  const live = (await readQueue()).queue.proposals.find((p) => p.key === key);
  if (live) return live;
  const raw = await readTextFile(saved(key));
  return raw === null ? null : JSON.parse(raw);
}
