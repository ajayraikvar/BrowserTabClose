const DEFAULT_SETTINGS = {
  timeoutSeconds: 900,
  patterns: []
};

const CHECK_ALARM = "edgeclose-check";
const CLOSE_ALARM = "edgeclose-close";
const STATUS_MESSAGE = "edgeclose-status";
const WARNING_SECONDS = 10;

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    timeoutSeconds: normalizeTimeout(stored.timeoutSeconds),
    patterns: normalizePatterns(stored.patterns)
  };
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

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i").test(url);
}

async function isMatchingTab(tab) {
  const { patterns } = await getSettings();
  return patterns.some((pattern) => patternMatchesUrl(pattern, tab.url));
}

async function broadcastStatus() {
  const { timeoutSeconds } = await getSettings();
  const warningThreshold = Math.max(1, timeoutSeconds - WARNING_SECONDS);
  const idleState = await chrome.idle.queryState(warningThreshold);
  const tabs = await chrome.tabs.query({});
  const activeTabs = await chrome.tabs.query({ active: true });
  const activeTabIds = new Set(activeTabs.map((tab) => tab.id));

  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id) || !tab.url || !(await isMatchingTab(tab))) {
      return;
    }
    chrome.tabs.sendMessage(tab.id, {
      type: STATUS_MESSAGE,
      timeoutSeconds,
      idleState,
      remainingSeconds: idleState === "active" ? timeoutSeconds : WARNING_SECONDS,
      isActiveTab: activeTabIds.has(tab.id)
    }).catch(() => {});
  }));
}

async function closeMatchingTabs() {
  const { patterns } = await getSettings();
  if (patterns.length === 0) {
    return;
  }

  const tabs = await chrome.tabs.query({});
  const matchingTabIds = tabs
    .filter((tab) => patterns.some((pattern) => patternMatchesUrl(pattern, tab.url)))
    .map((tab) => tab.id)
    .filter((tabId) => Number.isInteger(tabId));

  if (matchingTabIds.length > 0) {
    await chrome.tabs.remove(matchingTabIds);
  }
}

async function configureIdleDetection() {
  const { timeoutSeconds } = await getSettings();
  chrome.idle.setDetectionInterval(Math.max(1, timeoutSeconds - WARNING_SECONDS));
  await chrome.alarms.clear(CHECK_ALARM);
  await chrome.alarms.clear(CLOSE_ALARM);
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(() => {
  configureIdleDetection();
});

chrome.runtime.onStartup.addListener(() => {
  configureIdleDetection();
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.tabs.onActivated.addListener(() => {
  broadcastStatus();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") broadcastStatus();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.timeoutSeconds || changes.patterns)) {
    configureIdleDetection();
    broadcastStatus();
  }
});

chrome.idle.onStateChanged.addListener((newState) => {
  broadcastStatus();
  if (newState === "idle" || newState === "locked") {
    chrome.alarms.create(CLOSE_ALARM, { delayInMinutes: WARNING_SECONDS / 60 });
  } else {
    chrome.alarms.clear(CLOSE_ALARM);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const { timeoutSeconds } = await getSettings();
  if (alarm.name === CLOSE_ALARM) {
    const finalState = await chrome.idle.queryState(1);
    if (finalState === "idle" || finalState === "locked") await closeMatchingTabs();
    return;
  }

  if (alarm.name !== CHECK_ALARM) return;

  const state = await chrome.idle.queryState(Math.max(1, timeoutSeconds - WARNING_SECONDS));
  await broadcastStatus();
  if (state === "active") {
    await chrome.alarms.clear(CLOSE_ALARM);
  }
});

configureIdleDetection();
