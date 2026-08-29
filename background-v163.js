const VERSION = "1.6.3";
const DEFAULT_TIMEOUT = 900;
const DEFAULT_WARNING = 10;
const MAX_AUDIT = 200;
const CHECK_ALARM = "edgeclose-check";
const WARNING_PREFIX = "edgeclose-warning-";
const CLOSE_PREFIX = "edgeclose-close-";
const ACTIVITY_PREFIX = "edgeclose-last-activity-";
const INHERITED_PREFIX = "edgeclose-inherited-";
const PAUSE_KEY = "edgeclose-pause-until";
const AUDIT_KEY = "edgeclose-audit-log";

const normalizeTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? String(value) : "";
const normalizeTimeout = (value) => { const n = Number(value); return Number.isFinite(n) ? Math.max(15, Math.min(86400, Math.round(n))) : DEFAULT_TIMEOUT; };
const normalizeWarning = (value, timeout) => { const n = Number(value); return Number.isFinite(n) ? Math.max(1, Math.min(timeout - 1, Math.round(n))) : Math.min(DEFAULT_WARNING, timeout - 1); };
const normalizeSite = (site) => { const timeoutSeconds = normalizeTimeout(site?.timeoutSeconds); return { pattern: String(site?.pattern || "").trim(), timeoutSeconds, warningSeconds: normalizeWarning(site?.warningSeconds, timeoutSeconds), fromTime: normalizeTime(site?.fromTime), toTime: normalizeTime(site?.toTime), soundEnabled: site?.soundEnabled !== false }; };
const normalizeSites = (sites, legacy = []) => { const source = Array.isArray(sites) && sites.length ? sites : (Array.isArray(legacy) ? legacy.map((pattern) => ({ pattern })) : []); return source.map(normalizeSite).filter((site) => site.pattern).slice(0, 100); };

function isWithinSchedule(site, date = new Date()) {
  if (!site.fromTime || !site.toTime) return true;
  const now = date.getHours() * 60 + date.getMinutes();
  const [fh, fm] = site.fromTime.split(":").map(Number);
  const [th, tm] = site.toTime.split(":").map(Number);
  const from = fh * 60 + fm, to = th * 60 + tm;
  if (from === to) return true;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

function scheduleStart(site, date = new Date()) {
  if (!site.fromTime || !site.toTime) return 0;
  const [h, m] = site.fromTime.split(":").map(Number);
  const start = new Date(date);
  start.setHours(h, m, 0, 0);
  if (start > date && site.fromTime > site.toTime) start.setDate(start.getDate() - 1);
  return start.getTime();
}

function matches(pattern, url) {
  if (!pattern || !url) return false;
  if (!pattern.includes("://")) {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, "");
      const domain = pattern.trim().replace(/^\*\.?/, "").replace(/^www\./i, "");
      const escaped = domain.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`(^|\\.)${escaped}$`, "i").test(host);
    } catch { return false; }
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}\\/?$`, "i").test(url);
}

function priority(pattern) {
  const value = pattern.trim();
  const wildcards = (value.match(/\*/g) || []).length;
  let score = value.includes("://") ? 400000 : 200000;
  if (!wildcards) score += 50000;
  if (value.includes("/")) score += 3000;
  score += Math.min(1000, value.replace(/\*/g, "").length) * 10;
  return score - wildcards * 500;
}

async function getSettings() {
  const managed = await chrome.storage.managed.get({ sites: undefined }).catch(() => ({}));
  const local = await chrome.storage.local.get({ sites: [], patterns: [] });
  const managedPresent = Array.isArray(managed.sites);
  return { sites: normalizeSites(managedPresent ? managed.sites : local.sites, managedPresent ? [] : local.patterns), managed: managedPresent };
}

async function getPauseUntil() {
  const stored = await chrome.storage.local.get(PAUSE_KEY);
  const until = Number(stored[PAUSE_KEY]) || 0;
  if (until > Date.now()) return until;
  if (until) await chrome.storage.local.remove(PAUSE_KEY);
  return 0;
}

const isPaused = async () => (await getPauseUntil()) > Date.now();
const activityKey = (id) => `${ACTIVITY_PREFIX}${id}`;
const warningName = (id) => `${WARNING_PREFIX}${id}`;
const closeName = (id) => `${CLOSE_PREFIX}${id}`;

async function siteForTab(tab) {
  if (await isPaused()) return null;
  const config = await getSettings();
  const candidates = config.sites
    .map((site, index) => ({ site, index, score: priority(site.pattern) }))
    .filter((item) => matches(item.site.pattern, tab.url) && isWithinSchedule(item.site))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (candidates.length) return candidates[0].site;
  if (Number.isInteger(tab.id)) {
    const key = `${INHERITED_PREFIX}${tab.id}`;
    const stored = await chrome.storage.session.get(key);
    if (stored[key] && isWithinSchedule(stored[key])) return normalizeSite(stored[key]);
  }
  return null;
}

async function lastActivity(id) {
  const key = activityKey(id);
  const stored = await chrome.storage.session.get(key);
  const timestamp = Number(stored[key]);
  if (timestamp > 0) return timestamp;
  const now = Date.now();
  await chrome.storage.session.set({ [key]: now });
  return now;
}

async function clearAlarms(id) {
  await chrome.alarms.clear(warningName(id));
  await chrome.alarms.clear(closeName(id));
}

async function schedule(id, activity, site) {
  await clearAlarms(id);
  if (await isPaused() || !isWithinSchedule(site)) return;
  const effective = Math.max(activity, scheduleStart(site));
  const elapsed = (Date.now() - effective) / 1000;
  const warningDelay = site.timeoutSeconds - site.warningSeconds - elapsed;
  const closeDelay = site.timeoutSeconds - elapsed;
  if (warningDelay > 0) await chrome.alarms.create(warningName(id), { delayInMinutes: warningDelay / 60 });
  if (closeDelay > 0) await chrome.alarms.create(closeName(id), { delayInMinutes: closeDelay / 60 });
}

async function reschedule() {
  const alarms = await chrome.alarms.getAll();
  if (await isPaused()) {
    await Promise.all(alarms.filter((alarm) => alarm.name.startsWith(WARNING_PREFIX) || alarm.name.startsWith(CLOSE_PREFIX)).map((alarm) => chrome.alarms.clear(alarm.name)));
    return;
  }
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id)) return;
    const site = tab.url && await siteForTab(tab);
    if (!site) { await clearAlarms(tab.id); return; }
    await schedule(tab.id, await lastActivity(tab.id), site);
  }));
}

function safeMetadata(metadata) {
  const blocked = new Set(["password", "passwordHash", "salt", "token", "secret", "url", "pattern", "title"]);
  const result = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (!blocked.has(key) && ["string", "number", "boolean"].includes(typeof value)) result[key] = value;
  }
  return result;
}

function jsonDataUrl(value) {
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(value, null, 2))}`;
}

let auditWriteQueue = Promise.resolve();
async function writeAuditFile(entries) {
  auditWriteQueue = auditWriteQueue.then(async () => {
    try {
      await chrome.downloads.erase({ query: "EdgeClose/audit-log.json" }).catch(() => {});
      await chrome.downloads.download({
        url: jsonDataUrl({ schemaVersion: 1, version: VERSION, generatedAt: Date.now(), events: entries.slice(0, MAX_AUDIT) }),
        filename: "EdgeClose/audit-log.json",
        saveAs: false,
        conflictAction: "overwrite"
      });
    } catch {}
  }).catch(() => {});
  return auditWriteQueue;
}

async function audit(event, metadata = {}) {
  const stored = await chrome.storage.local.get(AUDIT_KEY);
  const current = Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY] : [];
  const next = [{ timestamp: Date.now(), event: String(event).slice(0, 40), metadata: safeMetadata(metadata) }, ...current].slice(0, MAX_AUDIT);
  await chrome.storage.local.set({ [AUDIT_KEY]: next });
  await writeAuditFile(next);
}

async function closeIfDue(id) {
  if (await isPaused()) return;
  const tab = await chrome.tabs.get(id).catch(() => null);
  const site = tab && await siteForTab(tab);
  if (!tab || !site || !isWithinSchedule(site)) return;
  const activity = await lastActivity(id);
  const deadline = Math.max(activity, scheduleStart(site)) + site.timeoutSeconds * 1000;
  if (Date.now() >= deadline) {
    await chrome.tabs.remove(id).catch(() => {});
    await audit("tab_closed", {});
  } else await schedule(id, activity, site);
}

async function broadcast() {
  const tabs = await chrome.tabs.query({});
  const pausedNow = await isPaused();
  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id)) return;
    const site = !pausedNow && tab.url && await siteForTab(tab);
    if (!site) {
      chrome.tabs.sendMessage(tab.id, { type: "edgeclose-status", enabled: false, paused: pausedNow }).catch(() => {});
      return;
    }
    const activity = await lastActivity(tab.id);
    const deadline = Math.max(activity, scheduleStart(site)) + site.timeoutSeconds * 1000;
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    chrome.tabs.sendMessage(tab.id, {
      type: "edgeclose-status",
      scheduleActive: true,
      timeoutSeconds: site.timeoutSeconds,
      warningSeconds: site.warningSeconds,
      soundEnabled: site.soundEnabled,
      idleState: remaining <= site.warningSeconds && remaining > 0 ? "warning" : "active",
      remainingSeconds: remaining,
      deadlineAt: deadline,
      paused: false
    }).catch(() => {});
  }));
}

async function setPause(minutes) {
  const duration = Math.max(1, Math.min(1440, Math.round(Number(minutes) || 15)));
  const until = Date.now() + duration * 60000;
  await chrome.storage.local.set({ [PAUSE_KEY]: until });
  await reschedule();
  await audit("pause_set", { durationMinutes: duration });
  await broadcast();
  return until;
}

async function resume() {
  await chrome.storage.local.remove(PAUSE_KEY);
  await reschedule();
  await audit("pause_cleared", {});
  await broadcast();
}

async function adminState() {
  const config = await getSettings();
  const tabs = await chrome.tabs.query({});
  const pausedNow = await isPaused();
  let monitored = 0;
  if (!pausedNow) for (const tab of tabs) if (Number.isInteger(tab.id) && await siteForTab(tab)) monitored += 1;
  const auditStored = await chrome.storage.local.get(AUDIT_KEY);
  return {
    managed: config.managed,
    source: config.managed ? "Managed policy" : "Local settings",
    precedence: "Managed policy > local settings",
    ruleCount: config.sites.length,
    monitoredCount: monitored,
    paused: pausedNow,
    auditCount: Array.isArray(auditStored[AUDIT_KEY]) ? auditStored[AUDIT_KEY].length : 0
  };
}

function configure() {
  chrome.alarms.clear(CHECK_ALARM).catch(() => {});
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 0.5 }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await audit("extension_installed", {});
    await chrome.runtime.openOptionsPage();
  } else if (details.reason === "update") {
    await audit("extension_updated", {});
  }
  configure();
  await reschedule();
  await broadcast();
});

chrome.runtime.onStartup.addListener(async () => { configure(); await reschedule(); await broadcast(); });
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.tabs.onActivated.addListener(() => broadcast());
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!Number.isInteger(tab.id) || !Number.isInteger(tab.openerTabId) || await isPaused()) return;
  const opener = await chrome.tabs.get(tab.openerTabId).catch(() => null);
  const site = opener && await siteForTab(opener);
  if (site) {
    await chrome.storage.session.set({ [INHERITED_PREFIX + tab.id]: site });
    await lastActivity(tab.id);
    await schedule(tab.id, await lastActivity(tab.id), site);
  }
});
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === "complete") { lastActivity(id); reschedule(); broadcast(); } });
chrome.tabs.onRemoved.addListener(async (id) => { await chrome.storage.session.remove([activityKey(id), INHERITED_PREFIX + id]); await clearAlarms(id); });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === CHECK_ALARM) { await reschedule(); await broadcast(); return; }
  if (alarm.name.startsWith(CLOSE_PREFIX)) await closeIfDue(Number(alarm.name.slice(CLOSE_PREFIX.length)));
  else if (alarm.name.startsWith(WARNING_PREFIX)) await broadcast();
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "edgeclose-activity" && Number.isInteger(sender.tab?.id)) { markActive(sender.tab.id); return; }
  if (message.type === "edgeclose-deadline" && Number.isInteger(sender.tab?.id)) { closeIfDue(sender.tab.id); return; }
  if (message.type === "edgeclose-pause") { setPause(message.minutes).then((pauseUntil) => sendResponse({ ok: true, pauseUntil })).catch(() => sendResponse({ ok: false })); return true; }
  if (message.type === "edgeclose-resume") { resume().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false })); return true; }
  if (message.type === "edgeclose-admin-state") { adminState().then(sendResponse).catch(() => sendResponse(null)); return true; }
  if (message.type === "edgeclose-audit-log") { chrome.storage.local.get(AUDIT_KEY).then((s) => sendResponse(Array.isArray(s[AUDIT_KEY]) ? s[AUDIT_KEY].slice(0, MAX_AUDIT) : [])).catch(() => sendResponse([])); return true; }
  if (message.type === "edgeclose-audit") { audit(message.event, message.metadata || {}).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false })); return true; }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && (changes.sites || changes.patterns || changes[PAUSE_KEY])) { reschedule(); broadcast(); } });

async function markActive(id) {
  if (await isPaused()) return;
  const now = Date.now();
  await chrome.storage.session.set({ [activityKey(id)]: now });
  const tab = await chrome.tabs.get(id).catch(() => null);
  const site = tab && await siteForTab(tab);
  if (site) await schedule(id, now, site);
}
