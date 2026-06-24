const SCRIPT_ID = "edge-enhancer";

const hostEl = document.getElementById("host");
const toggleEl = document.getElementById("toggle");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");

let activeTab = null;
let currentHost = null;
let currentOrigin = null;

const toOrigin = (hostname) => `*://${hostname.toLowerCase()}/*`;

const parseOrigin = (origin) => {
  const match = /^\*:\/\/(\*\.)?([^/*]+)\/\*$/.exec(origin);
  if (!match) return null;
  return {
    origin,
    host: match[2].toLowerCase(),
    wildcard: Boolean(match[1])
  };
};

const toLabel = (origin) => {
  const site = parseOrigin(origin);
  return site ? site.host : origin;
};

const coversHost = (site, host) => {
  if (!site) return false;
  const value = host.toLowerCase();
  if (!site.wildcard) return value === site.host;
  return value === site.host || value.endsWith(`.${site.host}`);
};

const coversSite = (source, target) => {
  if (!source || !target) return false;
  if (source.origin === target.origin) return true;
  if (!source.wildcard) return false;
  return coversHost(source, target.host);
};

const cleanSites = (sites) => {
  const parsed = [];
  const seen = new Set();

  for (const origin of sites) {
    const site = parseOrigin(origin);
    if (!site || seen.has(site.origin)) continue;
    seen.add(site.origin);
    parsed.push(site);
  }

  return parsed
    .filter((site, index) => !parsed.some((other, otherIndex) => otherIndex !== index && other.wildcard && coversSite(other, site)))
    .map((site) => site.origin)
    .sort();
};

const getStoredSites = async () => {
  const { sites } = await chrome.storage.local.get({ sites: [] });
  return Array.isArray(sites) ? sites : [];
};

const setSites = (sites) => chrome.storage.local.set({ sites });

const removePermissions = async (origins) => {
  await Promise.all(origins.map((origin) => chrome.permissions.remove({ origins: [origin] }).catch(() => false)));
};

const getSites = async () => {
  const sites = await getStoredSites();
  const clean = cleanSites(sites);
  const cleanSet = new Set(clean);
  const removed = sites.filter((origin) => !cleanSet.has(origin));

  if (removed.length) await removePermissions(removed);
  if (clean.length !== sites.length || clean.some((origin, index) => origin !== sites[index])) {
    await setSites(clean);
  }

  return clean;
};

const syncRegistration = async (matches) => {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (!matches.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }
  if (existing.length) {
    await chrome.scripting.updateContentScripts([{ id: SCRIPT_ID, matches }]);
  } else {
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID,
      matches,
      js: ["content.js"],
      css: ["style.css"],
      runAt: "document_start",
      allFrames: true,
      persistAcrossSessions: true
    }]);
  }
};

const reloadActive = () => {
  if (activeTab && activeTab.id != null) chrome.tabs.reload(activeTab.id);
};

const isCurrentEnabled = (sites) => {
  if (!currentHost) return false;
  return sites.some((origin) => coversHost(parseOrigin(origin), currentHost));
};

const enableCurrent = async () => {
  if (!currentOrigin || !currentHost) return;
  const sites = await getSites();
  if (isCurrentEnabled(sites)) {
    await syncRegistration(sites);
    await render();
    return;
  }
  const granted = await chrome.permissions.request({ origins: [currentOrigin] });
  if (!granted) return;
  const next = cleanSites([...sites, currentOrigin]);
  await setSites(next);
  await syncRegistration(next);
  reloadActive();
  await render();
};

const removeSite = async (origin) => {
  const sites = await getSites();
  const next = cleanSites(sites.filter((site) => site !== origin));
  await setSites(next);
  await syncRegistration(next);
  await chrome.permissions.remove({ origins: [origin] }).catch(() => false);
  if (currentHost && coversHost(parseOrigin(origin), currentHost)) reloadActive();
  await render();
};

const removeCurrent = async () => {
  if (!currentHost) return;
  const sites = await getSites();
  const removed = sites.filter((origin) => coversHost(parseOrigin(origin), currentHost));
  const next = cleanSites(sites.filter((origin) => !coversHost(parseOrigin(origin), currentHost)));
  await setSites(next);
  await syncRegistration(next);
  await removePermissions(removed);
  reloadActive();
  await render();
};

const render = async () => {
  const sites = await getSites();

  listEl.textContent = "";
  for (const origin of sites) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const actionCell = document.createElement("td");
    const remove = document.createElement("button");

    nameCell.textContent = toLabel(origin);
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${toLabel(origin)}`);
    remove.addEventListener("click", () => removeSite(origin));

    actionCell.append(remove);
    row.append(nameCell, actionCell);
    listEl.append(row);
  }

  emptyEl.hidden = sites.length > 0;

  if (currentHost) {
    hostEl.textContent = currentHost;
    toggleEl.hidden = false;
    const enabled = isCurrentEnabled(sites);
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
      currentOrigin = toOrigin(currentHost);
    }
  } catch (e) {
    currentHost = null;
    currentOrigin = null;
  }
  await render();
};

init();
