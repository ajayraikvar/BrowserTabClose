const DEFAULT_SETTINGS = {
  sites: []
};
const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_WARNING_SECONDS = 10;

const CHECK_ALARM = "edgeclose-check";
const WARNING_ALARM_PREFIX = "edgeclose-warning-";
const CLOSE_ALARM_PREFIX = "edgeclose-close-";
const LAST_ACTIVITY_PREFIX = "edgeclose-last-activity-";
const INHERITED_SITE_PREFIX = "edgeclose-inherited-site-";
const STATUS_MESSAGE = "edgeclose-status";

async function getSettings() {
  const managed = await chrome.storage.managed.get({ sites: [] }).catch(() => ({ sites: [] }));
  const stored = await chrome.storage.local.get({ sites: [], patterns: [] });
  const sites = Array.isArray(managed.sites) && managed.sites.length > 0 ? managed.sites : stored.sites;
  return {
    sites: normalizeSites(sites, sites.length > 0 ? [] : stored.patterns)
  };
}

function normalizeSites(sites, legacyPatterns = []) {
  const source = Array.isArray(sites) && sites.length > 0
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
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? value : "";
}

function isWithinSchedule(site, date = new Date()) {
  if (!site.fromTime || !site.toTime) return true;
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const [fromHours, fromMinutes] = site.fromTime.split(":").map(Number);
  const [toHours, toMinutes] = site.toTime.split(":").map(Number);
  const from = fromHours * 60 + fromMinutes;
  const to = toHours * 60 + toMinutes;
  if (from === to) return true;
  return from < to
    ? currentMinutes >= from && currentMinutes < to
    : currentMinutes >= from || currentMinutes < to;
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
  if (!Number.isFinite(timeout)) {
    return DEFAULT_TIMEOUT_SECONDS;
  }
  return Math.max(15, Math.min(86400, Math.round(timeout)));
}

function normalizePatterns(patterns) {
  if (!Array.isArray(patterns)) return [];
  return patterns
    .map((pattern) => String(pattern).trim())
    .filter(Boolean)
    .slice(0, 100);
}

function patternMatchesUrl(pattern, url) {
  if (!url || !pattern) return false;

  const trimmedPattern = pattern.trim();
  if (!trimmedPattern.includes("://")) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const domainPattern = trimmedPattern.replace(/^\*\.?/, "").replace(/^www\./i, "");
      const escapedDomain = domainPattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      return new RegExp(`(^|\\.)${escapedDomain}$`, "i").test(hostname.replace(/^www\./i, ""));
    } catch {
      return false;
    }
  }

  const escaped = trimmedPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}\/?$`, "i").test(url);
}

async function getSiteForTab(tab) {
  const { sites } = await getSettings();
  if (sites.length === 0) return null;

  const matchingSites = sites.filter((site) => patternMatchesUrl(site.pattern, tab.url));
  const activeSite = matchingSites.find((site) => isWithinSchedule(site));
  if (activeSite) return activeSite;

  const inheritedKey = inheritedSiteKey(tab.id);
  if (Number.isInteger(tab.id)) {
    const stored = await chrome.storage.session.get(inheritedKey);
    const inheritedSite = stored[inheritedKey];
    if (inheritedSite && isWithinSchedule(inheritedSite)) return inheritedSite;
  }

  return null;
}

function closeAlarmName(tabId) {
  return `${CLOSE_ALARM_PREFIX}${tabId}`;
}

function warningAlarmName(tabId) {
  return `${WARNING_ALARM_PREFIX}${tabId}`;
}

function lastActivityKey(tabId) {
  return `${LAST_ACTIVITY_PREFIX}${tabId}`;
}

function inheritedSiteKey(tabId) {
  return `${INHERITED_SITE_PREFIX}${tabId}`;
}

async function getLastActivity(tabId) {
  const key = lastActivityKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const activity = Number(stored[key]);
  if (Number.isFinite(activity) && activity > 0) return activity;

  const timestamp = Date.now();
  await chrome.storage.session.set({ [key]: timestamp });
  return timestamp;
}

async function markTabActive(tabId) {
  const timestamp = Date.now();
  await chrome.storage.session.set({ [lastActivityKey(tabId)]: timestamp });
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const site = tab && await getSiteForTab(tab);
  if (!site) return;
  await scheduleTabAlarms(tabId, timestamp, site);
  broadcastStatus();
}

async function scheduleTabAlarms(tabId, lastActivity, site) {
  await chrome.alarms.clear(warningAlarmName(tabId));
  await chrome.alarms.clear(closeAlarmName(tabId));

  if (!isWithinSchedule(site)) return;

  const effectiveLastActivity = Math.max(lastActivity, getScheduleStart(site));
  const elapsedSeconds = (Date.now() - effectiveLastActivity) / 1000;
  const warningDelay = site.timeoutSeconds - site.warningSeconds - elapsedSeconds;
  const closeDelay = site.timeoutSeconds - elapsedSeconds;

  if (warningDelay > 0) {
    chrome.alarms.create(warningAlarmName(tabId), {
      delayInMinutes: warningDelay / 60
    });
  }
  if (closeDelay > 0) {
    chrome.alarms.create(closeAlarmName(tabId), {
      delayInMinutes: closeDelay / 60
    });
  }
}

async function broadcastStatus() {
  const tabs = await chrome.tabs.query({});
  const activeTabs = await chrome.tabs.query({ active: true });
  const activeTabIds = new Set(activeTabs.map((tab) => tab.id));

  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id)) return;

    const site = tab.url && await getSiteForTab(tab);
    if (!site) {
      chrome.tabs.sendMessage(tab.id, {
        type: STATUS_MESSAGE,
        enabled: false
      }).catch(() => {});
      return;
    }

    const lastActivity = await getLastActivity(tab.id);
    const effectiveLastActivity = Math.max(lastActivity, getScheduleStart(site));
    const deadlineAt = effectiveLastActivity + site.timeoutSeconds * 1000;
    const remainingSeconds = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
    const isWarning = remainingSeconds <= site.warningSeconds && remainingSeconds > 0;

    const closeAlarm = await chrome.alarms.get(closeAlarmName(tab.id));
    if (!closeAlarm) {
      await scheduleTabAlarms(tab.id, lastActivity, site);
    }

    chrome.tabs.sendMessage(tab.id, {
      type: STATUS_MESSAGE,
      scheduleActive: true,
      timeoutSeconds: site.timeoutSeconds,
      warningSeconds: site.warningSeconds,
      soundEnabled: site.soundEnabled,
      idleState: isWarning ? "warning" : "active",
      remainingSeconds,
      deadlineAt,
      isActiveTab: activeTabIds.has(tab.id),
      hasTabActivity: remainingSeconds > 0
    }).catch(() => {});
  }));
}

async function closeTabIfStillInactive(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const site = tab && await getSiteForTab(tab);
  if (!tab || !site || !isWithinSchedule(site)) return;

  const lastActivity = await getLastActivity(tabId);
  const deadlineAt = Math.max(lastActivity, getScheduleStart(site)) + site.timeoutSeconds * 1000;
  if (Date.now() >= deadlineAt) {
    await chrome.tabs.remove(tabId);
  } else {
    await scheduleTabAlarms(tabId, lastActivity, site);
  }
}

async function handleDeadlineSignal(tabId) {
  if (!Number.isInteger(tabId)) return;
  await closeTabIfStillInactive(tabId);
}

async function configureIdleDetection() {
  await chrome.alarms.clear(CHECK_ALARM);
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 0.5 });
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
  if (keys.length > 0) await chrome.storage.session.remove(keys);
}

async function rescheduleTabAlarms() {
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

chrome.runtime.onInstalled.addListener(() => {
  configureIdleDetection();
  rescheduleTabAlarms();
  broadcastStatus();
});

chrome.runtime.onStartup.addListener(() => {
  configureIdleDetection();
  rescheduleTabAlarms();
  broadcastStatus();
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.tabs.onActivated.addListener(() => {
  broadcastStatus();
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!Number.isInteger(tab.id) || !Number.isInteger(tab.openerTabId)) return;

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

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "edgeclose-activity" && Number.isInteger(sender.tab?.id)) {
    markTabActive(sender.tab.id);
    return;
  }

  if (message.type === "edgeclose-deadline" && Number.isInteger(sender.tab?.id)) {
    handleDeadlineSignal(sender.tab.id);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName === "local" || areaName === "managed") &&
      (changes.sites || changes.patterns || changes.timeoutSeconds || changes.warningSeconds)) {
    clearInheritedSites();
    clearAllTabAlarmState();
    configureIdleDetection();
    rescheduleTabAlarms();
    broadcastStatus();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith(WARNING_ALARM_PREFIX)) {
    await broadcastStatus();
    return;
  }

  if (alarm.name.startsWith(CLOSE_ALARM_PREFIX)) {
    const tabId = Number(alarm.name.slice(CLOSE_ALARM_PREFIX.length));
    if (Number.isInteger(tabId)) await closeTabIfStillInactive(tabId);
    return;
  }

  if (alarm.name !== CHECK_ALARM) return;
  await rescheduleTabAlarms();
  await broadcastStatus();
});

configureIdleDetection();
rescheduleTabAlarms();
broadcastStatus();
