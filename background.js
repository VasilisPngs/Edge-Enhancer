import { reconcileSites, syncRegistration } from "./shared.js";

const reconcile = async () => {
  const sites = await reconcileSites(true);
  await syncRegistration(sites);
};

chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);

chrome.permissions.onRemoved.addListener((permissions) => {
  const origins = permissions.origins || [];
  if (origins.length) reconcile();
});
