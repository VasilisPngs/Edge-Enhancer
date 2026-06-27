import { readSites, writeSites, normalizeSites, removePermissions, syncRegistration, hostFromMatch, matchFromHost } from "./shared.js";

const hostEl = document.getElementById("host");
const toggleEl = document.getElementById("toggle");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");

let activeTab = null;
let currentHost = null;
let currentMatch = null;

const changed = (before, after) =>
  before.length !== after.length || after.some((match, index) => match !== before[index]);

const reconcile = async () => {
  const stored = await readSites();
  const next = normalizeSites(stored);
  const keep = new Set(next);
  const dropped = stored.filter((match) => !keep.has(match));
  if (dropped.length) await removePermissions(dropped);
  if (dropped.length || changed(stored, next)) await writeSites(next);
  return next;
};

const reloadActive = () => {
  if (activeTab && activeTab.id != null) chrome.tabs.reload(activeTab.id);
};

const isEnabled = (sites) => currentHost != null && sites.some((match) => hostFromMatch(match) === currentHost);

const enableCurrent = async () => {
  if (!currentMatch || !currentHost) return;
  const sites = await reconcile();
  if (isEnabled(sites)) {
    await syncRegistration(sites);
    await render();
    return;
  }
  const granted = await chrome.permissions.request({ origins: [currentMatch] });
  if (!granted) return;
  const next = normalizeSites([...sites, currentMatch]);
  await writeSites(next);
  await syncRegistration(next);
  reloadActive();
  await render();
};

const removeSite = async (match) => {
  const sites = await reconcile();
  const next = normalizeSites(sites.filter((entry) => entry !== match));
  await writeSites(next);
  await syncRegistration(next);
  await chrome.permissions.remove({ origins: [match] }).catch(() => false);
  if (currentHost && hostFromMatch(match) === currentHost) reloadActive();
  await render();
};

const removeCurrent = async () => {
  if (!currentHost) return;
  const sites = await reconcile();
  const target = sites.filter((match) => hostFromMatch(match) === currentHost);
  const next = normalizeSites(sites.filter((match) => hostFromMatch(match) !== currentHost));
  await writeSites(next);
  await syncRegistration(next);
  await removePermissions(target);
  reloadActive();
  await render();
};

const render = async () => {
  const sites = await reconcile();

  listEl.textContent = "";
  for (const match of sites) {
    const host = hostFromMatch(match);
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const actionCell = document.createElement("td");
    const remove = document.createElement("button");

    nameCell.textContent = host;
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${host}`);
    remove.addEventListener("click", () => removeSite(match));

    actionCell.append(remove);
    row.append(nameCell, actionCell);
    listEl.append(row);
  }

  emptyEl.hidden = sites.length > 0;

  if (currentHost) {
    hostEl.textContent = currentHost;
    toggleEl.hidden = false;
    const enabled = isEnabled(sites);
    toggleEl.textContent = enabled ? "Remove from this site" : "Enable on this site";
    toggleEl.onclick = enabled ? removeCurrent : enableCurrent;
  } else {
    hostEl.textContent = "Unsupported page";
    toggleEl.hidden = true;
  }
};

const init = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  try {
    const url = new URL(tab.url);
    if (url.protocol === "http:" || url.protocol === "https:") {
      currentHost = url.hostname.toLowerCase();
      currentMatch = matchFromHost(currentHost);
    }
  } catch (e) {
    currentHost = null;
    currentMatch = null;
  }
  await render();
};

init();
