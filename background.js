const SCRIPT_ID = "edge-enhancer";

const getSites = async () => {
  const { sites } = await chrome.storage.local.get({ sites: [] });
  return sites;
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

const reconcile = async () => {
  const sites = await getSites();
  const checks = await Promise.all(
    sites.map((origin) => chrome.permissions.contains({ origins: [origin] }).catch(() => false))
  );
  const active = sites.filter((_, i) => checks[i]);
  if (active.length !== sites.length) await chrome.storage.local.set({ sites: active });
  await syncRegistration(active);
};

chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);

chrome.permissions.onRemoved.addListener(async (permissions) => {
  const origins = permissions.origins || [];
  if (!origins.length) return;
  const sites = await getSites();
  const removed = new Set(origins);
  const next = sites.filter((origin) => !removed.has(origin));
  if (next.length === sites.length) return;
  await chrome.storage.local.set({ sites: next });
  await syncRegistration(next);
});
