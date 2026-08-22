const DEFAULT_SETTINGS = {
  timeoutSeconds: 900,
  patterns: []
};

const form = document.querySelector("#settings-form");
const timeoutInput = document.querySelector("#timeout");
const patternsInput = document.querySelector("#patterns");
const resetButton = document.querySelector("#reset");
const status = document.querySelector("#status");
const checkUpdatesButton = document.querySelector("#check-updates");
const updateStatus = document.querySelector("#update-status");
const currentVersion = chrome.runtime.getManifest().version;
const repositoryUrl = "https://github.com/ajayraikvar/BrowserTabClose";

function showStatus(message) {
  status.textContent = message;
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    status.textContent = "";
  }, 3000);
}

function renderSettings(settings) {
  timeoutInput.value = settings.timeoutSeconds;
  patternsInput.value = settings.patterns.join("\n");
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  renderSettings({
    timeoutSeconds: Math.max(15, Math.min(86400, Number(settings.timeoutSeconds) || DEFAULT_SETTINGS.timeoutSeconds)),
    patterns: Array.isArray(settings.patterns) ? settings.patterns : DEFAULT_SETTINGS.patterns
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const timeoutSeconds = Math.max(15, Math.min(86400, Math.round(Number(timeoutInput.value))));
  const patterns = patternsInput.value
    .split("\n")
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .slice(0, 100);

  await chrome.storage.local.set({ timeoutSeconds, patterns });
  renderSettings({ timeoutSeconds, patterns });
  showStatus("Settings saved");
});

resetButton.addEventListener("click", async () => {
  await chrome.storage.local.set(DEFAULT_SETTINGS);
  renderSettings(DEFAULT_SETTINGS);
  showStatus("Settings reset");
});

async function checkForUpdates() {
  updateStatus.textContent = "Checking...";
  try {
    const response = await fetch("https://api.github.com/repos/ajayraikvar/BrowserTabClose/releases/latest", {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) throw new Error("No release found");
    const release = await response.json();
    if (release.tag_name && release.tag_name.replace(/^v/, "") !== currentVersion) {
      updateStatus.innerHTML = `<a href="${release.html_url || repositoryUrl}" target="_blank" rel="noreferrer">Update ${release.tag_name}</a> is available.`;
    } else {
      updateStatus.textContent = "You have the latest release.";
    }
  } catch {
    updateStatus.innerHTML = `<a href="${repositoryUrl}" target="_blank" rel="noreferrer">Open the GitHub repository</a> to check for updates.`;
  }
}

checkUpdatesButton.addEventListener("click", checkForUpdates);

loadSettings();
checkForUpdates();
window.setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
