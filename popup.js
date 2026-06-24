const SCRIPT_ID = "edge-enhancer";

const hostEl = document.getElementById("host");
const toggleEl = document.getElementById("toggle");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");

let activeTab = null;
let currentOrigin = null;
let currentHostname = null;

const toOrigin = (hostname) => `*://${hostname}/*`;

const toHostname = (origin) => {
  const match = /^\*:\/\/([^/]+)\/\*$/.exec(origin);
  return match ? match[1] : null;
};

const toLabel = (origin) => {
  const hostname = toHostname(origin);
  if (!hostname) return origin;
  const label = hostname.startsWith("*.") ? hostname.slice(2) : hostname;
  return label.startsWith("www.") ? label.slice(4) : label;
};

const matchesHostname = (origin, hostname) => {
  const pattern = toHostname(origin);
  if (!pattern) return false;
  if (pattern === hostname) return true;
  if (!pattern.startsWith("*.")) return false;
  const base = pattern.slice(2);
  return hostname === base || hostname.endsWith(`.${base}`);
};

const sortSites = (sites) => [...sites].sort((a, b) => toLabel(a).localeCompare(toLabel(b)));

const uniqueSorted = (sites) => sortSites([...new Set(sites)]);

const getSites = async () => {
  const { sites } = await chrome.storage.local.get({ sites: [] });
  return uniqueSorted(sites.filter((site) => toHostname(site)));
};

const setSites = (sites) => chrome.storage.local.set({ sites: uniqueSorted(sites) });

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

const cleanCurrentDuplicates = async (sites) => {
  if (!currentHostname) return sites;
  const matches = sites.filter((origin) => matchesHostname(origin, currentHostname));
  if (matches.length < 2) return sites;
  const wildcard = matches.find((origin) => toHostname(origin).startsWith("*."));
  const exact = matches.find((origin) => origin === currentOrigin);
  const keep = wildcard || exact || matches[0];
  const removed = matches.filter((origin) => origin !== keep);
  const next = uniqueSorted([...sites.filter((origin) => !matches.includes(origin)), keep]);
  await setSites(next);
  await syncRegistration(next);
  await Promise.all(removed.map((origin) => chrome.permissions.remove({ origins: [origin] }).catch(() => false)));
  return next;
};

const enableCurrent = async () => {
  if (!currentOrigin || !currentHostname) return;
  const sites = await getSites();
  if (sites.some((origin) => matchesHostname(origin, currentHostname))) {
    await render();
    return;
  }
  const granted = await chrome.permissions.request({ origins: [currentOrigin] });
  if (!granted) return;
  const next = uniqueSorted([...sites, currentOrigin]);
  await setSites(next);
  await syncRegistration(next);
  reloadActive();
  await render();
};

const removeSite = async (origin) => {
  const sites = (await getSites()).filter((site) => site !== origin);
  await setSites(sites);
  await syncRegistration(sites);
  await chrome.permissions.remove({ origins: [origin] });
  if (currentHostname && matchesHostname(origin, currentHostname)) reloadActive();
  await render();
};

const removeCurrent = async () => {
  if (!currentHostname) return;
  const sites = await getSites();
  const matches = sites.filter((origin) => matchesHostname(origin, currentHostname));
  const next = sites.filter((origin) => !matches.includes(origin));
  await setSites(next);
  await syncRegistration(next);
  await Promise.all(matches.map((origin) => chrome.permissions.remove({ origins: [origin] }).catch(() => false)));
  reloadActive();
  await render();
};

const render = async () => {
  const sites = await cleanCurrentDuplicates(await getSites());

  listEl.textContent = "";
  for (const origin of sites) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    const action = document.createElement("td");
    const remove = document.createElement("button");

    name.textContent = toLabel(origin);
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${toLabel(origin)}`);
    remove.addEventListener("click", () => removeSite(origin));

    action.append(remove);
    row.append(name, action);
    listEl.append(row);
  }
  emptyEl.hidden = sites.length > 0;

  if (currentOrigin && currentHostname) {
    const on = sites.some((origin) => matchesHostname(origin, currentHostname));
    hostEl.textContent = currentHostname;
    toggleEl.hidden = false;
    toggleEl.textContent = on ? "Remove from this site" : "Enable on this site";
    toggleEl.onclick = on ? removeCurrent : enableCurrent;
  } else {
    hostEl.textContent = "Unsupported page";
    toggleEl.hidden = true;
    toggleEl.onclick = null;
  }
};

const init = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  try {
    const url = new URL(tab.url);
    if (url.protocol === "http:" || url.protocol === "https:") {
      currentHostname = url.hostname;
      currentOrigin = toOrigin(currentHostname);
    }
  } catch (e) {
    currentOrigin = null;
    currentHostname = null;
  }
  await render();
};

init();
