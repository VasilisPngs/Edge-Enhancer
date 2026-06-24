const SCRIPT_ID = "edge-enhancer";

const getSites = async () => {
  const { sites } = await chrome.storage.local.get({ sites: [] });
  return Array.isArray(sites) ? sites : [];
};

const parseOrigin = (origin) => {
  const match = /^\*:\/\/(\*\.)?([^/*]+)\/\*$/.exec(origin);
  if (!match) return null;
  return {
    origin,
    host: match[2].toLowerCase(),
    wildcard: Boolean(match[1])
  };
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

const removePermissions = async (origins) => {
  await Promise.all(origins.map((origin) => chrome.permissions.remove({ origins: [origin] }).catch(() => false)));
};

const reconcile = async () => {
  const sites = await getSites();
  const checks = await Promise.all(
    sites.map((origin) => chrome.permissions.contains({ origins: [origin] }).catch(() => false))
  );
  const active = sites.filter((_, index) => checks[index]);
  const clean = cleanSites(active);
  const cleanSet = new Set(clean);
  const removed = sites.filter((origin) => !cleanSet.has(origin));

  if (removed.length) await removePermissions(removed);
  if (clean.length !== sites.length || clean.some((origin, index) => origin !== sites[index])) {
    await chrome.storage.local.set({ sites: clean });
  }

  await syncRegistration(clean);
};

chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);

chrome.permissions.onRemoved.addListener(async (permissions) => {
  const origins = permissions.origins || [];
  if (!origins.length) return;
  const sites = await getSites();
  const removed = new Set(origins);
  const next = cleanSites(sites.filter((origin) => !removed.has(origin)));
  if (next.length === sites.length && next.every((origin, index) => origin === sites[index])) return;
  await chrome.storage.local.set({ sites: next });
  await syncRegistration(next);
});
