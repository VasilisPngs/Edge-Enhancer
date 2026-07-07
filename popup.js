import { writeSites, normalizeSites, removePermissions, syncRegistration, hostFromMatch, matchFromHost, reconcileSites } from "./shared.js";

const hostEl = document.getElementById("host");
const toggleEl = document.getElementById("toggle");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");

let activeTab = null;
let currentHost = null;
let currentMatch = null;

const reloadActive = () => {
  if (activeTab && activeTab.id != null) chrome.tabs.reload(activeTab.id);
};

const isEnabled = (sites) => currentHost != null && sites.some((match) => hostFromMatch(match) === currentHost);

const enableCurrent = async () => {
  if (!currentMatch || !currentHost) return;
  const sites = await reconcileSites();
  if (isEnabled(sites)) {
    await syncRegistration(sites);
    await render(sites);
    return;
  }
  const granted = await chrome.permissions.request({ origins: [currentMatch] });
  if (!granted) return;
  const next = normalizeSites([...sites, currentMatch]);
  await writeSites(next);
  await syncRegistration(next);
  reloadActive();
  await render(next);
};

const removeSite = async (match) => {
  const sites = await reconcileSites();
  const next = normalizeSites(sites.filter((entry) => entry !== match));
  await writeSites(next);
  await syncRegistration(next);
  await chrome.permissions.remove({ origins: [match] }).catch(() => false);
  if (currentHost && hostFromMatch(match) === currentHost) reloadActive();
  await render(next);
};

const removeCurrent = async () => {
  if (!currentHost) return;
  const sites = await reconcileSites();
  const target = sites.filter((match) => hostFromMatch(match) === currentHost);
  const next = normalizeSites(sites.filter((match) => hostFromMatch(match) !== currentHost));
  await writeSites(next);
  await syncRegistration(next);
  await removePermissions(target);
  reloadActive();
  await render(next);
};

const render = async (sites) => {
  const list = sites ?? await reconcileSites();

  listEl.textContent = "";
  for (const match of list) {
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

  emptyEl.hidden = list.length > 0;

  if (currentHost) {
    hostEl.textContent = currentHost;
    toggleEl.hidden = false;
    const enabled = isEnabled(list);
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
  } catch {
    currentHost = null;
    currentMatch = null;
  }
  await render();
};

init();
