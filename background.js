const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_WARNING_SECONDS = 10;
const MAX_AUDIT_ENTRIES = 200;

const CHECK_ALARM = "edgeclose-check";
const PAUSE_EXPIRY_ALARM = "edgeclose-pause-expiry";
const WARNING_ALARM_PREFIX = "edgeclose-warning-";
const CLOSE_ALARM_PREFIX = "edgeclose-close-";
const LAST_ACTIVITY_PREFIX = "edgeclose-last-activity-";
const INHERITED_SITE_PREFIX = "edgeclose-inherited-site-";
const STATUS_MESSAGE = "edgeclose-status";
const PAUSE_KEY = "edgeclose-pause-until";
const AUDIT_KEY = "edgeclose-audit-log";
const AUDIT_DOWNLOAD_PATH = "EdgeClose/audit-log.json";

async function getSettings() {
  const managed = await chrome.storage.managed.get({ sites: [] }).catch(() => ({ sites: [] }));
  const stored = await chrome.storage.local.get({ sites: [], patterns: [] });
  const hasManagedSites = Array.isArray(managed.sites);
  const sites = hasManagedSites ? managed.sites : stored.sites;
  return {
    sites: normalizeSites(sites, sites.length ? [] : stored.patterns),
    managed: hasManagedSites
  };
}

function normalizeSites(sites, legacyPatterns = []) {
  const source = Array.isArray(sites) && sites.length
    ? sites
    : normalizePatterns(legacyPatterns).map((pattern) => ({ pattern }));
  return source.map(normalizeSite).filter((site) => site.pattern);
}

function normalizeSite(site) {
  const timeoutSeconds = normalizeTimeout(site.timeoutSeconds);
  return {
    pattern: String(site.pattern || "").trim(),
    timeoutSeconds,
    warningSeconds: normalizeWarning(site.warningSeconds, timeoutSeconds),
    fromTime: normalizeTime(site.fromTime),
    toTime: normalizeTime(site.toTime),
    soundEnabled: site.soundEnabled !== false
  };
}

function normalizeTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? String(value) : "";
}

function isWithinSchedule(site, date = new Date()) {
  if (!site.fromTime || !site.toTime) return true;
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const [fromHours, fromMinutes] = site.fromTime.split(":").map(Number);
  const [toHours, toMinutes] = site.toTime.split(":").map(Number);
  const from = fromHours * 60 + fromMinutes;
  const to = toHours * 60 + toMinutes;
  if (from === to) return true;
  return from < to ? currentMinutes >= from && currentMinutes < to : currentMinutes >= from || currentMinutes < to;
}

function getScheduleStart(site, date = new Date()) {
  if (!site.fromTime || !site.toTime) return 0;
  const [fromHours, fromMinutes] = site.fromTime.split(":").map(Number);
  const start = new Date(date);
  start.setHours(fromHours, fromMinutes, 0, 0);
  if (start > date && site.fromTime > site.toTime) start.setDate(start.getDate() - 1);
  return start.getTime();
}

function normalizeWarning(value, timeoutValue) {
  const timeout = normalizeTimeout(timeoutValue);
  const warning = Number(value);
  if (!Number.isFinite(warning)) return Math.min(DEFAULT_WARNING_SECONDS, timeout - 1);
  return Math.max(1, Math.min(timeout - 1, Math.round(warning)));
}

function normalizeTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout)) return DEFAULT_TIMEOUT_SECONDS;
  return Math.max(15, Math.min(86400, Math.round(timeout)));
}

function normalizePatterns(patterns) {
  if (!Array.isArray(patterns)) return [];
  return patterns.map((pattern) => String(pattern).trim()).filter(Boolean).slice(0, 100);
}

function patternMatchesUrl(pattern, url) {
  if (!url || !pattern) return false;
  const trimmed = pattern.trim();
  if (!trimmed.includes("://")) {
    try {
      const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./i, "");
      const domainPattern = trimmed.replace(/^\*\.?/, "").replace(/^www\./i, "");
      const escapedDomain = domainPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`(^|\\.)${escapedDomain}$`, "i").test(hostname);
    } catch {
      return false;
    }
  }
  const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}\/?$`, "i").test(url);
}

function rulePriority(pattern) {
  const value = pattern.trim();
  const hasProtocol = value.includes("://");
  const wildcardCount = (value.match(/\*/g) || []).length;
  const literalLength = value.replace(/\*/g, "").length;
  let score = hasProtocol ? 400000 : 200000;
  if (!wildcardCount) score += 50000;
  if (value.includes("/")) score += 3000;
  score += Math.min(literalLength, 1000) * 10;
  return score - wildcardCount * 500;
}

async function isProtectionPaused() {
  const stored = await chrome.storage.local.get(PAUSE_KEY);
  const until = Number(stored[PAUSE_KEY]) || 0;
  if (until > Date.now()) return true;
  if (until) await chrome.storage.local.remove(PAUSE_KEY);
  return false;
}

async function getPauseUntil() {
  const stored = await chrome.storage.local.get(PAUSE_KEY);
  const until = Number(stored[PAUSE_KEY]) || 0;
  if (until > Date.now()) return until;
  if (until) await chrome.storage.local.remove(PAUSE_KEY);
  return 0;
}

async function getSiteForTab(tab) {
  const { sites } = await getSettings();
  if (!sites.length || await isProtectionPaused()) return null;

  const matches = sites
    .map((site, index) => ({ site, index, score: rulePriority(site.pattern) }))
    .filter(({ site }) => patternMatchesUrl(site.pattern, tab.url) && isWithinSchedule(site))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (matches.length) return matches[0].site;

  if (Number.isInteger(tab.id)) {
    const key = inheritedSiteKey(tab.id);
    const stored = await chrome.storage.session.get(key);
    const inheritedSite = stored[key];
    if (inheritedSite && isWithinSchedule(inheritedSite)) return inheritedSite;
  }
  return null;
}

function closeAlarmName(tabId) { return `${CLOSE_ALARM_PREFIX}${tabId}`; }
function warningAlarmName(tabId) { return `${WARNING_ALARM_PREFIX}${tabId}`; }
function lastActivityKey(tabId) { return `${LAST_ACTIVITY_PREFIX}${tabId}`; }
function inheritedSiteKey(tabId) { return `${INHERITED_SITE_PREFIX}${tabId}`; }

async function getLastActivity(tabId) {
  const key = lastActivityKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const value = Number(stored[key]);
  if (Number.isFinite(value) && value > 0) return value;
  const timestamp = Date.now();
  await chrome.storage.session.set({ [key]: timestamp });
  return timestamp;
}

async function scheduleTabAlarms(tabId, lastActivity, site) {
  await chrome.alarms.clear(warningAlarmName(tabId));
  await chrome.alarms.clear(closeAlarmName(tabId));
  if (await isProtectionPaused() || !isWithinSchedule(site)) return;

  const effectiveLastActivity = Math.max(lastActivity, getScheduleStart(site));
  const elapsedSeconds = (Date.now() - effectiveLastActivity) / 1000;
  const warningDelay = site.timeoutSeconds - site.warningSeconds - elapsedSeconds;
  const closeDelay = site.timeoutSeconds - elapsedSeconds;

  if (warningDelay > 0) chrome.alarms.create(warningAlarmName(tabId), { delayInMinutes: warningDelay / 60 });
  if (closeDelay > 0) chrome.alarms.create(closeAlarmName(tabId), { delayInMinutes: closeDelay / 60 });
}

async function broadcastStatus() {
  const tabs = await chrome.tabs.query({});
  const activeTabs = await chrome.tabs.query({ active: true });
  const activeIds = new Set(activeTabs.map((tab) => tab.id));
  const paused = await isProtectionPaused();

  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id)) return;
    const site = !paused && tab.url && await getSiteForTab(tab);
    if (!site) {
      chrome.tabs.sendMessage(tab.id, { type: STATUS_MESSAGE, enabled: false, paused }).catch(() => {});
      return;
    }

    const lastActivity = await getLastActivity(tab.id);
    const deadlineAt = Math.max(lastActivity, getScheduleStart(site)) + site.timeoutSeconds * 1000;
    const remainingSeconds = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
    const isWarning = remainingSeconds <= site.warningSeconds && remainingSeconds > 0;
    const closeAlarm = await chrome.alarms.get(closeAlarmName(tab.id));
    if (!closeAlarm) await scheduleTabAlarms(tab.id, lastActivity, site);

    chrome.tabs.sendMessage(tab.id, {
      type: STATUS_MESSAGE,
      scheduleActive: true,
      timeoutSeconds: site.timeoutSeconds,
      warningSeconds: site.warningSeconds,
      soundEnabled: site.soundEnabled,
      idleState: isWarning ? "warning" : "active",
      remainingSeconds,
      deadlineAt,
      isActiveTab: activeIds.has(tab.id),
      hasTabActivity: remainingSeconds > 0,
      paused: false
    }).catch(() => {});
  }));
}

async function closeTabIfStillInactive(tabId) {
  if (await isProtectionPaused()) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const site = tab && await getSiteForTab(tab);
  if (!tab || !site || !isWithinSchedule(site)) return;
  const lastActivity = await getLastActivity(tabId);
  const deadlineAt = Math.max(lastActivity, getScheduleStart(site)) + site.timeoutSeconds * 1000;
  if (Date.now() >= deadlineAt) {
    await chrome.tabs.remove(tabId);
    await appendAudit("tab_closed", {});
  } else {
    await scheduleTabAlarms(tabId, lastActivity, site);
  }
}

async function setPause(minutes) {
  const safeMinutes = Math.max(1, Math.min(1440, Math.round(Number(minutes) || 15)));
  const pauseUntil = Date.now() + safeMinutes * 60 * 1000;
  await chrome.storage.local.set({ [PAUSE_KEY]: pauseUntil });
  await chrome.alarms.clear(PAUSE_EXPIRY_ALARM);
  chrome.alarms.create(PAUSE_EXPIRY_ALARM, { delayInMinutes: safeMinutes });
  await clearAllTabAlarmState();
  await broadcastStatus();
  await appendAudit("pause_set", { durationMinutes: safeMinutes });
  return pauseUntil;
}

async function resumeProtection() {
  await chrome.storage.local.remove(PAUSE_KEY);
  await chrome.alarms.clear(PAUSE_EXPIRY_ALARM);
  await rescheduleTabAlarms();
  await broadcastStatus();
  await appendAudit("pause_cleared", {});
}

async function appendAudit(event, metadata = {}) {
  const safeMetadata = {};
  const blocked = new Set(["password", "passwordHash", "salt", "token", "secret", "url", "pattern", "title"]);
  for (const [key, value] of Object.entries(metadata)) {
    if (blocked.has(key)) continue;
    if (["string", "number", "boolean"].includes(typeof value)) safeMetadata[key] = value;
  }

  const stored = await chrome.storage.local.get(AUDIT_KEY);
  const current = Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY] : [];
  const next = [{ timestamp: Date.now(), event: String(event).slice(0, 40), metadata: safeMetadata }, ...current].slice(0, MAX_AUDIT_ENTRIES);
  await chrome.storage.local.set({ [AUDIT_KEY]: next });

  try {
    const data = JSON.stringify(next, null, 2);
    const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(data)}`;
    await chrome.downloads.download({
      url: dataUrl,
      filename: AUDIT_DOWNLOAD_PATH,
      saveAs: false,
      conflictAction: "overwrite"
    });
  } catch {
    // Persistent extension-local audit remains available even when downloads are restricted.
  }
}

async function getAuditLog() {
  const stored = await chrome.storage.local.get(AUDIT_KEY);
  return Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY].slice(0, MAX_AUDIT_ENTRIES) : [];
}

async function clearAllTabAlarmState() {
  const alarms = await chrome.alarms.getAll();
  await Promise.all(alarms
    .filter((alarm) => alarm.name.startsWith(WARNING_ALARM_PREFIX) || alarm.name.startsWith(CLOSE_ALARM_PREFIX))
    .map((alarm) => chrome.alarms.clear(alarm.name)));
}

async function clearInheritedSites() {
  const stored = await chrome.storage.session.get(null);
  const keys = Object.keys(stored).filter((key) => key.startsWith(INHERITED_SITE_PREFIX));
  if (keys.length) await chrome.storage.session.remove(keys);
}

async function rescheduleTabAlarms() {
  if (await isProtectionPaused()) {
    await clearAllTabAlarmState();
    return;
  }
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id)) return;
    const site = tab.url && await getSiteForTab(tab);
    if (!site) {
      await chrome.alarms.clear(warningAlarmName(tab.id));
      await chrome.alarms.clear(closeAlarmName(tab.id));
      return;
    }
    await scheduleTabAlarms(tab.id, await getLastActivity(tab.id), site);
  }));
}

async function configureIdleDetection() {
  await chrome.alarms.clear(CHECK_ALARM);
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 0.5 });
}

async function getPopupState() {
  const pauseUntil = await getPauseUntil();
  const tabs = await chrome.tabs.query({});
  const monitoredTabs = [];
  if (!pauseUntil) {
    for (const tab of tabs) {
      if (!Number.isInteger(tab.id)) continue;
      const site = tab.url && await getSiteForTab(tab);
      if (!site) continue;
      const lastActivity = await getLastActivity(tab.id);
      monitoredTabs.push({
        tabId: tab.id,
        title: String(tab.title || "Monitored tab").slice(0, 120),
        deadlineAt: Math.max(lastActivity, getScheduleStart(site)) + site.timeoutSeconds * 1000
      });
    }
  }
  return { paused: pauseUntil > Date.now(), pauseUntil, monitoredTabs };
}

async function getAdminState() {
  const { sites, managed } = await getSettings();
  return {
    managed,
    source: managed ? "Managed policy" : "Local settings",
    precedence: "Managed policy > local settings",
    ruleCount: sites.length,
    monitoredCount: (await getPopupState()).monitoredTabs.length,
    paused: await isProtectionPaused(),
    auditCount: (await getAuditLog()).length,
    auditDownloadPath: AUDIT_DOWNLOAD_PATH
  };
}

chrome.runtime.onInstalled.addListener((details) => {
  configureIdleDetection();
  rescheduleTabAlarms();
  broadcastStatus();
  if (details.reason === "install") {
    appendAudit("extension_installed", {});
    chrome.runtime.openOptionsPage();
  } else if (details.reason === "update") {
    appendAudit("extension_updated", {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  configureIdleDetection();
  rescheduleTabAlarms();
  broadcastStatus();
});

chrome.tabs.onActivated.addListener(() => broadcastStatus());

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!Number.isInteger(tab.id) || !Number.isInteger(tab.openerTabId) || await isProtectionPaused()) return;
  const opener = await chrome.tabs.get(tab.openerTabId).catch(() => null);
  const site = opener && await getSiteForTab(opener);
  if (!site) return;
  await chrome.storage.session.set({ [inheritedSiteKey(tab.id)]: site });
  await markTabActive(tab.id);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    markTabActive(tabId);
    broadcastStatus();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.storage.session.remove([lastActivityKey(tabId), inheritedSiteKey(tabId)]);
  await chrome.alarms.clear(warningAlarmName(tabId));
  await chrome.alarms.clear(closeAlarmName(tabId));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "edgeclose-activity" && Number.isInteger(sender.tab?.id)) {
    markTabActive(sender.tab.id);
    return;
  }
  if (message.type === "edgeclose-deadline" && Number.isInteger(sender.tab?.id)) {
    closeTabIfStillInactive(sender.tab.id);
    return;
  }
  if (message.type === "edgeclose-pause") {
    setPause(message.minutes).then((pauseUntil) => sendResponse({ ok: true, pauseUntil })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "edgeclose-resume") {
    resumeProtection().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "edgeclose-popup-state") {
    getPopupState().then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (message.type === "edgeclose-admin-state") {
    getAdminState().then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (message.type === "edgeclose-audit-log") {
    getAuditLog().then(sendResponse).catch(() => sendResponse([]));
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName === "local" || areaName === "managed") && (changes.sites || changes.patterns)) {
    clearInheritedSites();
    clearAllTabAlarmState();
    configureIdleDetection();
    rescheduleTabAlarms();
    broadcastStatus();
  }
  if (areaName === "local" && changes[PAUSE_KEY]) {
    rescheduleTabAlarms();
    broadcastStatus();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === PAUSE_EXPIRY_ALARM) {
    await resumeProtection();
    return;
  }
  if (alarm.name.startsWith(WARNING_ALARM_PREFIX)) {
    await broadcastStatus();
    return;
  }
  if (alarm.name.startsWith(CLOSE_ALARM_PREFIX)) {
    const tabId = Number(alarm.name.slice(CLOSE_ALARM_PREFIX.length));
    if (Number.isInteger(tabId)) await closeTabIfStillInactive(tabId);
    return;
  }
  if (alarm.name === CHECK_ALARM) {
    await rescheduleTabAlarms();
    await broadcastStatus();
  }
});

configureIdleDetection();
rescheduleTabAlarms();
broadcastStatus();
