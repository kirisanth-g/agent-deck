// Shared by the Repos view and the Queue view: the config file, the repos and their worktrees.

import { exec, spaces, panes, home, readTextFile, writeTextFile } from "herdr";

const CONFIG = ".config/agent-deck/config.json";

export const out = (r) => (r.stdout ?? "").trim();

// The config file is optional. A file that is not valid JSON is an error the panel shows.
// Resolves with { raw, cfg }. `raw` is the snapshot a write must match.
export async function readConfig() {
  const raw = await readTextFile(`${home()}/${CONFIG}`);
  if (raw === null) return { raw, cfg: {} };
  try { return { raw, cfg: JSON.parse(raw) }; } catch { throw new Error(`~/${CONFIG} is not valid JSON.`); }
}

export const config = async () => (await readConfig()).cfg;

// Replaces the config file. The write fails if the file changed after `raw` was read.
export async function writeConfig(cfg, raw) {
  await exec("mkdir", ["-p", `${home()}/${CONFIG}`.replace(/\/[^/]+$/, "")]);
  await writeTextFile(`${home()}/${CONFIG}`, `${JSON.stringify(cfg, null, 2)}\n`, raw);
}

// The repos that wt knows: [{ name, path, wt: true }].
export async function wtRepos() {
  const r = await exec("wt", ["repo", "ls"]);
  return r.code !== 0 ? [] : out(r).split("\n").slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2 && cols[1].startsWith("/"))
    .map(([name, path]) => ({ name, path, wt: true }));
}

export const expand = (path) => String(path).replace(/^~(?=\/|$)/, home()).replace(/\/+$/, "");

// `wt repo ls` prints a table: name, path, domain, ports. The first line is the header.
// A repo that wt does not know has `wt: false`: its worktrees are made with git alone.
export async function repos() {
  const { add = [], hide = [] } = (await config()).repos ?? {};
  const list = await wtRepos();
  for (const entry of add) {
    const path = expand(entry);
    if (!list.some((repo) => repo.path === path)) list.push({ name: path.split("/").pop(), path, wt: false });
  }
  return list.filter((repo) => !hide.includes(repo.name));
}

// Makes a worktree beside the repo, in `<repo>.worktrees/<branch>`, the place wt uses.
// A branch that exists is checked out. A new branch starts from the fetched default branch.
export async function gitWorktree(repo, branch) {
  const git = (args, timeout) => exec("git", args, { cwd: repo.path, ...(timeout ? { timeout } : {}) });
  await git(["fetch", "origin"], 120000);
  const path = `${repo.path}.worktrees/${branch}`;
  const known = (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0
    || (await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`])).code === 0;
  const head = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const base = head.code === 0 ? out(head) : "HEAD";
  return git(known ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, base], 120000);
}

// Every checkout of a repo, the main one first: { path, branch, main }.
export async function checkouts(repo) {
  const r = await exec("git", ["worktree", "list", "--porcelain"], { cwd: repo.path });
  if (r.code !== 0) return [];
  const list = [];
  for (const block of out(r).split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? "(detached)";
    list.push({ path, branch, main: list.length === 0 });
  }
  return list;
}

// The space whose terminals are in this checkout. The deepest checkout wins.
export function spaceOf(path, all) {
  const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
  const paneList = panes();
  return spaces().find((s) => {
    if (s.machine) return false;
    const tabs = new Set((s.tabs ?? []).map((t) => t.id));
    const at = paneList.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
    if (!at || !inside(at, path)) return false;
    return !all.some((c) => c.path.length > path.length && inside(at, c.path));
  });
}


// Makes the worktree for a branch, with wt when wt knows the repo and with git when it does not.
// Resolves with the checkout, or throws with the reason.
export async function makeWorktree(repo, branch) {
  // wt new copies the env files and the Claude setup, and registers the dev host.
  const r = repo.wt
    ? await exec("wt", ["new", branch, "--no-code"], { cwd: repo.path, timeout: 600000 })
    : await gitWorktree(repo, branch);
  if (r.code !== 0) throw new Error((r.stderr ?? "").trim() || out(r) || "The worktree was not made.");
  const made = (await checkouts(repo)).find((c) => c.branch === branch);
  if (!made) throw new Error(`The command finished, but no worktree is on ${branch}.`);
  return made;
}

// Runs an app command and resolves with what it made, for example { space, tab, terminal }.
export async function make(command, args) {
  const r = await exec("herdr-app", ["do", command, JSON.stringify(args)]);
  const made = JSON.parse(out(r) || "{}");
  if (r.code !== 0 || made.error) throw new Error(made.error || (r.stderr ?? "").trim() || `${command} failed`);
  return made;
}
