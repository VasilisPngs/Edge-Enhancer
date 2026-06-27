import { readSites, writeSites, normalizeSites, removePermissions, syncRegistration } from "./shared.js";

const changed = (before, after) =>
  before.length !== after.length || after.some((match, index) => match !== before[index]);

const reconcile = async (active) => {
  const stored = await readSites();
  const base = active ? stored.filter((_, index) => active[index]) : stored;
  const next = normalizeSites(base);
  const keep = new Set(next);
  const dropped = stored.filter((match) => !keep.has(match));

  if (dropped.length) await removePermissions(dropped);
  if (dropped.length || changed(stored, next)) await writeSites(next);

  await syncRegistration(next);
};

const bootstrap = async () => {
  const stored = await readSites();
  const active = await Promise.all(
    stored.map((origin) => chrome.permissions.contains({ origins: [origin] }).catch(() => false))
  );
  await reconcile(active);
};

chrome.runtime.onInstalled.addListener(bootstrap);
chrome.runtime.onStartup.addListener(bootstrap);

chrome.permissions.onRemoved.addListener(async (permissions) => {
  const origins = permissions.origins || [];
  if (!origins.length) return;
  const stored = await readSites();
  const removed = new Set(origins);
  const next = normalizeSites(stored.filter((match) => !removed.has(match)));
  if (!changed(stored, next)) return;
  await writeSites(next);
  await syncRegistration(next);
});
