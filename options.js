const DEFAULT_SETTINGS = { sites: [] };
const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_WARNING_SECONDS = 10;

const form = document.querySelector("#settings-form");
const siteList = document.querySelector("#site-list");
const emptySites = document.querySelector("#empty-sites");
const addSiteButton = document.querySelector("#add-site");
const resetButton = document.querySelector("#reset");
const status = document.querySelector("#status");
const checkUpdatesButton = document.querySelector("#check-updates");
const updateStatus = document.querySelector("#update-status");
const installedVersion = document.querySelector("#installed-version");
const availableVersion = document.querySelector("#available-version");
const availableVersions = document.querySelector("#available-versions");
const currentVersion = chrome.runtime.getManifest().version;
const repositoryUrl = "https://github.com/ajayraikvar/EdgeClose";

installedVersion.textContent = `v${currentVersion}`;

function showStatus(message) {
  status.textContent = message;
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    status.textContent = "";
  }, 3000);
}

function compareVersions(left, right) {
  const leftParts = left.replace(/^v/, "").split(".").map((part) => Number(part) || 0);
  const rightParts = right.replace(/^v/, "").split(".").map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    if ((leftParts[index] || 0) !== (rightParts[index] || 0)) {
      return (leftParts[index] || 0) - (rightParts[index] || 0);
    }
  }
  return 0;
}

function createSiteRow(site = { pattern: "", timeoutSeconds: DEFAULT_TIMEOUT_SECONDS, warningSeconds: DEFAULT_WARNING_SECONDS, fromTime: "", toTime: "", soundEnabled: true }) {
  const row = document.createElement("div");
  row.className = "site-row";
  row.innerHTML = `<input class="site-pattern" type="text" placeholder="example.com" aria-label="Website domain or URL"><input class="site-timeout" type="number" min="15" max="86400" value="${site.timeoutSeconds}" aria-label="Inactivity timeout in seconds"><input class="site-warning" type="number" min="1" value="${site.warningSeconds}" aria-label="Warning lead time in seconds"><label class="time-option">From <input class="site-from" type="time" value="${site.fromTime || ""}" aria-label="Schedule start time"></label><label class="time-option">To <input class="site-to" type="time" value="${site.toTime || ""}" aria-label="Schedule end time"></label><label class="sound-option"><input class="site-sound" type="checkbox" ${site.soundEnabled !== false ? "checked" : ""}> Sound</label><button type="button" class="remove-site text-button" aria-label="Remove website">Remove</button>`;
  row.querySelector(".site-pattern").value = site.pattern;
  row.querySelector(".remove-site").addEventListener("click", () => { row.remove(); emptySites.hidden = siteList.children.length > 0; });
  siteList.append(row);
}

async function loadSettings() {
  const settings = await chrome.storage.local.get({ sites: [], patterns: [] });
  const sites = Array.isArray(settings.sites) && settings.sites.length ? settings.sites : settings.patterns.map((pattern) => ({ pattern }));
  sites.forEach(createSiteRow);
  emptySites.hidden = sites.length > 0;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const sites = [...siteList.querySelectorAll(".site-row")].map((row) => {
    const timeoutSeconds = Math.max(15, Math.min(86400, Math.round(Number(row.querySelector(".site-timeout").value) || DEFAULT_TIMEOUT_SECONDS)));
    return { pattern: row.querySelector(".site-pattern").value.trim(), timeoutSeconds, warningSeconds: Math.max(1, Math.min(timeoutSeconds - 1, Math.round(Number(row.querySelector(".site-warning").value) || DEFAULT_WARNING_SECONDS))), fromTime: row.querySelector(".site-from").value, toTime: row.querySelector(".site-to").value, soundEnabled: row.querySelector(".site-sound").checked };
  }).filter((site) => site.pattern).slice(0, 100);
  await chrome.storage.local.set({ sites });
  showStatus("Settings saved");
});

resetButton.addEventListener("click", async () => {
  await chrome.storage.local.set(DEFAULT_SETTINGS);
  siteList.replaceChildren();
  emptySites.hidden = false;
  showStatus("Settings reset");
});

addSiteButton.addEventListener("click", () => { createSiteRow(); emptySites.hidden = true; });

async function checkForUpdates() {
  updateStatus.textContent = "Checking...";
  availableVersion.textContent = "Checking...";
  availableVersions.replaceChildren();
  try {
    const response = await fetch("https://api.github.com/repos/ajayraikvar/EdgeClose/releases?per_page=10", {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) throw new Error("Could not load releases");
    const releases = await response.json();
    const newerReleases = releases
      .filter((release) => release.tag_name && !release.draft && !release.prerelease)
      .filter((release) => compareVersions(release.tag_name, currentVersion) > 0)
      .sort((left, right) => compareVersions(right.tag_name, left.tag_name));
    if (newerReleases.length === 0) {
      availableVersion.textContent = currentVersion;
      updateStatus.textContent = "You have the latest release.";
      return;
    }

    availableVersion.textContent = `v${newerReleases[0].tag_name.replace(/^v/, "")}`;
    newerReleases.forEach((release) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = release.html_url || repositoryUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = release.tag_name;
      item.append(link);
      availableVersions.append(item);
    });

    updateStatus.textContent = "A newer release is available.";
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
