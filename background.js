const DEFAULT_SETTINGS = {
  timeoutSeconds: 900,
  warningSeconds: 10,
  patterns: []
};

const CHECK_ALARM = "edgeclose-check";
const WARNING_ALARM_PREFIX = "edgeclose-warning-";
const CLOSE_ALARM_PREFIX = "edgeclose-close-";
const STATUS_MESSAGE = "edgeclose-status";

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    timeoutSeconds: normalizeTimeout(stored.timeoutSeconds),
    warningSeconds: normalizeWarning(stored.warningSeconds, stored.timeoutSeconds),
    patterns: normalizePatterns(stored.patterns)
  };
}

function normalizeWarning(value, timeoutValue) {
  const timeout = normalizeTimeout(timeoutValue);
  const warning = Number(value);
  if (!Number.isFinite(warning)) return Math.min(DEFAULT_SETTINGS.warningSeconds, timeout - 1);
  return Math.max(1, Math.min(timeout - 1, Math.round(warning)));
}

function normalizeTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout)) {
    return DEFAULT_SETTINGS.timeoutSeconds;
  }
  return Math.max(15, Math.min(86400, Math.round(timeout)));
}

function normalizePatterns(patterns) {
  if (!Array.isArray(patterns)) {
    return [];
  }
  return patterns
    .map((pattern) => String(pattern).trim())
    .filter(Boolean)
    .slice(0, 100);
}

function patternMatchesUrl(pattern, url) {
  if (!url || !pattern) {
    return false;
  }

  const trimmedPattern = pattern.trim();
  if (!trimmedPattern.includes("://")) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const domainPattern = trimmedPattern.replace(/^\*\.?/, "").replace(/^www\./i, "");
      const escapedDomain = domainPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`(^|\\.)${escapedDomain}$`, "i").test(hostname.replace(/^www\./i, ""));
    } catch {
      return false;
    }
  }

  const escaped = trimmedPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}\/?$`, "i").test(url);
}

async function isMatchingTab(tab) {
  const { patterns } = await getSettings();
  return patterns.some((pattern) => patternMatchesUrl(pattern, tab.url)) || await isInheritedTab(tab.id);
}

function closeAlarmName(tabId) {
  return `${CLOSE_ALARM_PREFIX}${tabId}`;
}

function warningAlarmName(tabId) {
  return `${WARNING_ALARM_PREFIX}${tabId}`;
}

async function getLastActivity(tabId) {
  const stored = await chrome.storage.session.get({ lastActivity: {} });
  const activity = Number(stored.lastActivity[tabId]);
  if (activity) return activity;

  const timestamp = Date.now();
  await chrome.storage.session.set({
    lastActivity: { ...stored.lastActivity, [tabId]: timestamp }
  });
  return timestamp;
}

  async function isInheritedTab(tabId) {
    const stored = await chrome.storage.session.get({ inheritedTabs: {} });
    return stored.inheritedTabs[tabId] === true;
  }

  async function setInheritedTab(tabId) {
    const stored = await chrome.storage.session.get({ inheritedTabs: {} });
    await chrome.storage.session.set({ inheritedTabs: { ...stored.inheritedTabs, [tabId]: true } });
  }

async function markTabActive(tabId) {
  const timestamp = Date.now();
  const stored = await chrome.storage.session.get({ lastActivity: {} });
  const lastActivity = { ...stored.lastActivity, [tabId]: timestamp };
  await chrome.storage.session.set({ lastActivity });
  const { timeoutSeconds, warningSeconds } = await getSettings();
  await scheduleTabAlarms(tabId, timestamp, timeoutSeconds, warningSeconds);
  broadcastStatus();
}

async function scheduleTabAlarms(tabId, lastActivity, timeoutSeconds, warningSeconds) {
  await chrome.alarms.clear(warningAlarmName(tabId));
  await chrome.alarms.clear(closeAlarmName(tabId));
  const elapsedSeconds = (Date.now() - lastActivity) / 1000;
  const warningDelay = timeoutSeconds - warningSeconds - elapsedSeconds;
  const closeDelay = timeoutSeconds - elapsedSeconds;
  if (warningDelay > 0) {
    chrome.alarms.create(warningAlarmName(tabId), { delayInMinutes: warningDelay / 60 });
  }
  if (closeDelay > 0) {
    chrome.alarms.create(closeAlarmName(tabId), { delayInMinutes: closeDelay / 60 });
  }
}

async function broadcastStatus() {
  const { timeoutSeconds, warningSeconds } = await getSettings();
  const tabs = await chrome.tabs.query({});
  const activeTabs = await chrome.tabs.query({ active: true });
  const activeTabIds = new Set(activeTabs.map((tab) => tab.id));

  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id) || !tab.url || !(await isMatchingTab(tab))) {
      return;
    }
    const lastActivity = await getLastActivity(tab.id);
    const alarm = await chrome.alarms.get(closeAlarmName(tab.id));
    if (!alarm) await scheduleTabAlarms(tab.id, lastActivity, timeoutSeconds, warningSeconds);
    const elapsedSeconds = Math.floor((Date.now() - lastActivity) / 1000);
    const isWarning = elapsedSeconds >= timeoutSeconds - warningSeconds;
    chrome.tabs.sendMessage(tab.id, {
      type: STATUS_MESSAGE,
      timeoutSeconds,
      warningSeconds,
      idleState: isWarning ? "warning" : "active",
      remainingSeconds: Math.max(0, timeoutSeconds - elapsedSeconds),
      isActiveTab: activeTabIds.has(tab.id),
      hasTabActivity: elapsedSeconds < timeoutSeconds
    }).catch(() => {});
  }));
}

async function closeTabIfStillInactive(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !(await isMatchingTab(tab))) return;
  const lastActivity = await getLastActivity(tabId);
  const { timeoutSeconds } = await getSettings();
  if (Date.now() - lastActivity >= timeoutSeconds * 1000) {
    await chrome.tabs.remove(tabId);
  }
}

async function configureIdleDetection() {
  await chrome.alarms.clear(CHECK_ALARM);
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(() => {
  configureIdleDetection();
  broadcastStatus();
});

chrome.runtime.onStartup.addListener(() => {
  configureIdleDetection();
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
  if (!opener || !(await isMatchingTab(opener))) return;
  await setInheritedTab(tab.id);
  await markTabActive(tab.id);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    markTabActive(tabId);
    broadcastStatus();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const stored = await chrome.storage.session.get({ lastActivity: {} });
  delete stored.lastActivity[tabId];
  const inheritedTabs = await chrome.storage.session.get({ inheritedTabs: {} });
  await chrome.storage.session.set({ lastActivity: stored.lastActivity });
  delete inheritedTabs.inheritedTabs[tabId];
  await chrome.storage.session.set({ inheritedTabs: inheritedTabs.inheritedTabs });
  await chrome.alarms.clear(warningAlarmName(tabId));
  await chrome.alarms.clear(closeAlarmName(tabId));
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "edgeclose-activity" && Number.isInteger(sender.tab?.id)) {
    markTabActive(sender.tab.id);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.timeoutSeconds || changes.warningSeconds || changes.patterns)) {
    configureIdleDetection();
    rescheduleTabAlarms();
    broadcastStatus();
  }
});

async function rescheduleTabAlarms() {
  const { timeoutSeconds, warningSeconds } = await getSettings();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id) || !tab.url || !(await isMatchingTab(tab))) return;
    await scheduleTabAlarms(tab.id, await getLastActivity(tab.id), timeoutSeconds, warningSeconds);
  }));
}

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
  await broadcastStatus();
});

configureIdleDetection();
broadcastStatus();
