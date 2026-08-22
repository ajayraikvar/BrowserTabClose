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
const installedVersion = document.querySelector("#installed-version");
const availableVersion = document.querySelector("#available-version");
const availableVersions = document.querySelector("#available-versions");
const currentVersion = chrome.runtime.getManifest().version;
const repositoryUrl = "https://github.com/ajayraikvar/BrowserTabClose";

installedVersion.textContent = `v${currentVersion}`;

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
  availableVersion.textContent = "Checking...";
  availableVersions.replaceChildren();
  try {
    const response = await fetch("https://api.github.com/repos/ajayraikvar/BrowserTabClose/releases?per_page=10", {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) throw new Error("Could not load releases");
    const releases = await response.json();
    const publishedReleases = releases.filter((release) => release.tag_name);
    if (publishedReleases.length === 0) {
      availableVersion.textContent = "No published releases";
      updateStatus.textContent = "You have the latest release.";
      return;
    }

    availableVersion.textContent = `v${publishedReleases[0].tag_name.replace(/^v/, "")}`;
    publishedReleases.forEach((release) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = release.html_url || repositoryUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = release.tag_name;
      item.append(link);
      if (release.tag_name.replace(/^v/, "") === currentVersion) {
        const label = document.createElement("span");
        label.textContent = " Installed";
        item.append(label);
      }
      availableVersions.append(item);
    });

    if (publishedReleases[0].tag_name.replace(/^v/, "") !== currentVersion) {
      updateStatus.textContent = "A newer release is available.";
    } else {
      updateStatus.textContent = "You have the latest release.";
    }
  } catch {
    availableVersion.textContent = "Unavailable";
    const link = document.createElement("a");
    link.href = repositoryUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Open the GitHub repository";
    updateStatus.replaceChildren(link, document.createTextNode(" to check for updates."));
  }
}

checkUpdatesButton.addEventListener("click", checkForUpdates);

loadSettings();
checkForUpdates();
window.setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
