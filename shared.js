const SCRIPT_ID = "edge-enhancer";

export const matchFromHost = (host) => `*://${host.toLowerCase()}/*`;

export const hostFromMatch = (match) => {
  const result = /^\*:\/\/([^/*]+)\/\*$/.exec(match);
  return result ? result[1].toLowerCase() : null;
};

export const normalizeSites = (sites) => {
  const seen = new Set();
  for (const match of sites) {
    const host = hostFromMatch(match);
    if (host) seen.add(host);
  }
  return [...seen].sort().map(matchFromHost);
};

const changed = (before, after) =>
  before.length !== after.length || after.some((match, index) => match !== before[index]);

const readSites = async () => {
  const { sites } = await chrome.storage.local.get({ sites: [] });
  return Array.isArray(sites) ? sites : [];
};

export const writeSites = (sites) => chrome.storage.local.set({ sites });

export const removePermissions = (origins) =>
  Promise.all(origins.map((origin) => chrome.permissions.remove({ origins: [origin] }).catch(() => false)));

export const reconcileSites = async (verify = false) => {
  const stored = await readSites();
  let base = stored;
  if (verify) {
    const active = await Promise.all(
      stored.map((origin) => chrome.permissions.contains({ origins: [origin] }).catch(() => false))
    );
    base = stored.filter((_, index) => active[index]);
  }
  const next = normalizeSites(base);
  const keep = new Set(next);
  const dropped = stored.filter((match) => !keep.has(match));
  if (dropped.length) await removePermissions(dropped);
  if (dropped.length || changed(stored, next)) await writeSites(next);
  return next;
};

export const syncRegistration = async (matches) => {
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
