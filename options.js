const DEFAULT_SETTINGS = { sites: [] };
const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_WARNING_SECONDS = 10;
const AUTH_HASH_KEY = "edgeclose-settings-password-hash";
const AUTH_SALT_KEY = "edgeclose-settings-password-salt";
const AUTH_ITERATIONS_KEY = "edgeclose-settings-password-iterations";
const FAILED_ATTEMPTS_KEY = "edgeclose-auth-failed-attempts";
const LOCKOUT_UNTIL_KEY = "edgeclose-auth-lockout-until";
const PBKDF2_ITERATIONS = 310000;
const MAX_PASSWORD_LENGTH = 256;

const $ = (selector) => document.querySelector(selector);
const authGate = $("#auth-gate");
const authDescription = $("#auth-description");
const setupForm = $("#setup-form");
const setupPassword = $("#setup-password");
const setupConfirm = $("#setup-confirm");
const setupStrength = $("#setup-strength");
const setupError = $("#setup-error");
const unlockForm = $("#unlock-form");
const unlockPassword = $("#unlock-password");
const unlockError = $("#unlock-error");
const lockoutMessage = $("#lockout-message");
const protectedContent = $("#protected-content");
const form = $("#settings-form");
const siteList = $("#site-list");
const emptySites = $("#empty-sites");
const addSiteButton = $("#add-site");
const resetButton = $("#reset");
const status = $("#status");
const checkUpdatesButton = $("#check-updates");
const updateStatus = $("#update-status");
const installedVersion = $("#installed-version");
const availableVersion = $("#available-version");
const availableVersions = $("#available-versions");
const managedNotice = $("#managed-notice");
const policySource = $("#policy-source");
const policyPrecedence = $("#policy-precedence");
const ruleCount = $("#rule-count");
const monitoredCount = $("#monitored-count");
const protectionState = $("#protection-state");
const pauseState = $("#pause-state");
const auditList = $("#audit-list");
const auditEmpty = $("#audit-empty");
const changePasswordForm = $("#change-password-form");
const currentPassword = $("#current-password");
const newPassword = $("#new-password");
const newPasswordConfirm = $("#new-password-confirm");
const changeStrength = $("#change-strength");
const changePasswordStatus = $("#change-password-status");
const currentVersion = chrome.runtime.getManifest().version;
const repositoryUrl = "https://github.com/ajayraikvar/EdgeClose";

function bytesToBase64(bytes) { let binary = ""; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary); }
function base64ToBytes(value) { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }

async function derivePasswordHash(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const passwordBytes = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hasPassword() {
  const stored = await chrome.storage.local.get([AUTH_HASH_KEY, AUTH_SALT_KEY]);
  return Boolean(stored[AUTH_HASH_KEY] && stored[AUTH_SALT_KEY]);
}

async function setPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt);
  await chrome.storage.local.set({ [AUTH_HASH_KEY]: bytesToBase64(hash), [AUTH_SALT_KEY]: bytesToBase64(salt), [AUTH_ITERATIONS_KEY]: PBKDF2_ITERATIONS });
  await chrome.storage.session.remove([FAILED_ATTEMPTS_KEY, LOCKOUT_UNTIL_KEY]);
}

async function verifyPassword(password) {
  const stored = await chrome.storage.local.get([AUTH_HASH_KEY, AUTH_SALT_KEY, AUTH_ITERATIONS_KEY]);
  if (!stored[AUTH_HASH_KEY] || !stored[AUTH_SALT_KEY]) return false;
  const iterations = Number(stored[AUTH_ITERATIONS_KEY]) || PBKDF2_ITERATIONS;
  const actualHash = await derivePasswordHash(password, base64ToBytes(stored[AUTH_SALT_KEY]), iterations);
  return constantTimeEqual(actualHash, base64ToBytes(stored[AUTH_HASH_KEY]));
}

async function getLockoutUntil() {
  const stored = await chrome.storage.session.get([FAILED_ATTEMPTS_KEY, LOCKOUT_UNTIL_KEY]);
  const until = Number(stored[LOCKOUT_UNTIL_KEY]) || 0;
  if (until > Date.now()) return until;
  if (until) await chrome.storage.session.remove(LOCKOUT_UNTIL_KEY);
  return 0;
}

async function recordFailedAttempt() {
  const stored = await chrome.storage.session.get(FAILED_ATTEMPTS_KEY);
  const attempts = (Number(stored[FAILED_ATTEMPTS_KEY]) || 0) + 1;
  if (attempts >= 5) {
    const lockoutUntil = Date.now() + 60000;
    await chrome.storage.session.set({ [FAILED_ATTEMPTS_KEY]: 0, [LOCKOUT_UNTIL_KEY]: lockoutUntil });
    return lockoutUntil;
  }
  await chrome.storage.session.set({ [FAILED_ATTEMPTS_KEY]: attempts });
  return 0;
}

function passwordStrength(password) {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return { score, label: score <= 2 ? "Weak" : score === 3 ? "Fair" : score === 4 ? "Good" : "Strong" };
}

function renderPasswordStrength(element, password) {
  const strength = passwordStrength(password);
  element.textContent = password ? `Password strength: ${strength.label}` : "";
  element.dataset.level = String(strength.score);
}

function showUnlockForm() {
  authDescription.textContent = "Enter your EdgeClose password to manage the extension settings.";
  setupForm.hidden = true;
  unlockForm.hidden = false;
  unlockPassword.value = "";
  checkLockout();
}

function showSetupForm() {
  authDescription.textContent = "This is the first time EdgeClose settings are opened. Create a password to protect them.";
  unlockForm.hidden = true;
  setupForm.hidden = false;
  setupPassword.focus();
}

async function checkLockout() {
  const until = await getLockoutUntil();
  const locked = until > Date.now();
  unlockPassword.disabled = locked;
  unlockForm.querySelector("button[type=submit]").disabled = locked;
  lockoutMessage.hidden = !locked;
  if (!locked) return;
  const update = () => {
    const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    if (seconds <= 0) { window.clearInterval(checkLockout.timer); checkLockout(); return; }
    lockoutMessage.textContent = `Too many incorrect attempts. Try again in ${seconds}s.`;
  };
  update();
  window.clearInterval(checkLockout.timer);
  checkLockout.timer = window.setInterval(update, 1000);
}

function unlockSettings() {
  if(!authGate||!protectedContent)return;
  authGate.hidden = true;
  protectedContent.hidden = false;
  installedVersion.textContent = `v${currentVersion}`;
  loadSettings();
  refreshDashboard();
  loadAuditLog();
  checkForUpdates();
}

setupPassword.addEventListener("input", () => renderPasswordStrength(setupStrength, setupPassword.value));
newPassword.addEventListener("input", () => renderPasswordStrength(changeStrength, newPassword.value));

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault(); setupError.textContent = "";
  const password = setupPassword.value;
  if (password.length < 8 || password.length > MAX_PASSWORD_LENGTH) { setupError.textContent = "Password must be 8–256 characters."; return; }
  if (password !== setupConfirm.value) { setupError.textContent = "Passwords do not match."; return; }
  const button = setupForm.querySelector("button[type=submit]"); button.disabled = true;
  try { await setPassword(password); await sendAudit("password_created", {}); unlockSettings(); }
  catch { setupError.textContent = "Could not set the password. Please try again."; }
  finally { button.disabled = false; }
});

unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault(); unlockError.textContent = "";
  if (await getLockoutUntil()) { await checkLockout(); return; }
  const button = unlockForm.querySelector("button[type=submit]"); button.disabled = true;
  try {
    if (await verifyPassword(unlockPassword.value)) {
      await chrome.storage.session.remove([FAILED_ATTEMPTS_KEY, LOCKOUT_UNTIL_KEY]);
      unlockSettings();
    } else {
      const lockoutUntil = await recordFailedAttempt();
      unlockError.textContent = lockoutUntil ? "Too many incorrect attempts. Settings are locked for 60 seconds." : "Incorrect password.";
      await checkLockout();
      unlockPassword.select();
    }
  } catch { unlockError.textContent = "Could not verify the password. Please try again."; }
  finally { button.disabled = false; await checkLockout(); }
});

changePasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault(); changePasswordStatus.textContent = "";
  const oldPassword = currentPassword.value;
  const password = newPassword.value;
  if (password.length < 8 || password.length > MAX_PASSWORD_LENGTH) { changePasswordStatus.textContent = "New password must be 8–256 characters."; return; }
  if (password !== newPasswordConfirm.value) { changePasswordStatus.textContent = "New passwords do not match."; return; }
  const button = changePasswordForm.querySelector("button[type=submit]"); button.disabled = true;
  try {
    if (!(await verifyPassword(oldPassword))) { changePasswordStatus.textContent = "Current password is incorrect."; return; }
    await setPassword(password);
    await sendAudit("password_changed", {});
    currentPassword.value = ""; newPassword.value = ""; newPasswordConfirm.value = "";
    renderPasswordStrength(changeStrength, "");
    changePasswordStatus.textContent = "Password changed successfully.";
  } catch { changePasswordStatus.textContent = "Could not change the password. Please try again."; }
  finally { button.disabled = false; }
});

async function initializeAuth() {
  try { if (await hasPassword()) showUnlockForm(); else showSetupForm(); }
  catch { authDescription.textContent = "EdgeClose could not access its local settings. Reload the page and try again."; setupForm.hidden = true; unlockForm.hidden = true; }
}

function showStatus(message) { status.textContent = message; window.clearTimeout(showStatus.timer); showStatus.timer = window.setTimeout(() => { status.textContent = ""; }, 3000); }
function compareVersions(left, right) { const leftParts = left.replace(/^v/, "").split(".").map((part) => Number(part) || 0); const rightParts = right.replace(/^v/, "").split(".").map((part) => Number(part) || 0); for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) { if ((leftParts[index] || 0) !== (rightParts[index] || 0)) return (leftParts[index] || 0) - (rightParts[index] || 0); } return 0; }

function createSiteRow(site = { pattern: "", timeoutSeconds: DEFAULT_TIMEOUT_SECONDS, warningSeconds: DEFAULT_WARNING_SECONDS, fromTime: "", toTime: "", soundEnabled: true }) {
  const row = document.createElement("div"); row.className = "site-row";
  row.innerHTML = `<input class="site-pattern" type="text" placeholder="example.com" aria-label="Website domain or URL"><input class="site-timeout" type="number" min="15" max="86400" value="${site.timeoutSeconds}" aria-label="Inactivity timeout in seconds"><input class="site-warning" type="number" min="1" value="${site.warningSeconds}" aria-label="Warning lead time in seconds"><label class="time-option">From <input class="site-from" type="time" value="${site.fromTime || ""}" aria-label="Schedule start time"></label><label class="time-option">To <input class="site-to" type="time" value="${site.toTime || ""}" aria-label="Schedule end time"></label><label class="sound-option"><input class="site-sound" type="checkbox" ${site.soundEnabled !== false ? "checked" : ""}> Sound</label><span class="rule-priority">Automatic priority</span><button type="button" class="remove-site text-button" aria-label="Remove website">Remove</button>`;
  row.querySelector(".site-pattern").value = site.pattern;
  row.querySelector(".remove-site").addEventListener("click", () => { row.remove(); emptySites.hidden = siteList.children.length > 0; });
  siteList.append(row);
}

async function loadSettings() {
  siteList.replaceChildren();
  const managed = await chrome.storage.managed.get({ sites: [] }).catch(() => ({ sites: [] }));
  const settings = await chrome.storage.local.get({ sites: [], patterns: [] });
  const managedMode = Array.isArray(managed.sites) && managed.sites.length > 0;
  const configuredSites = managedMode ? managed.sites : (Array.isArray(settings.sites) && settings.sites.length ? settings.sites : settings.patterns.map((pattern) => ({ pattern })));
  configuredSites.forEach((site) => { createSiteRow(site); if (managedMode) siteList.lastElementChild.querySelectorAll("input, button").forEach((control) => { control.disabled = true; }); });
  emptySites.hidden = configuredSites.length > 0;
  addSiteButton.disabled = managedMode; resetButton.disabled = managedMode; form.querySelector("[type=submit]").disabled = managedMode; managedNotice.hidden = !managedMode;
}

async function saveSettings(sites) { await chrome.storage.local.set({ sites }); await sendAudit("settings_saved", { ruleCount: sites.length }); await refreshDashboard(); }
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const sites = [...siteList.querySelectorAll(".site-row")].map((row) => {
    const timeoutSeconds = Math.max(15, Math.min(86400, Math.round(Number(row.querySelector(".site-timeout").value) || DEFAULT_TIMEOUT_SECONDS)));
    return { pattern: row.querySelector(".site-pattern").value.trim(), timeoutSeconds, warningSeconds: Math.max(1, Math.min(timeoutSeconds - 1, Math.round(Number(row.querySelector(".site-warning").value) || DEFAULT_WARNING_SECONDS))), fromTime: row.querySelector(".site-from").value, toTime: row.querySelector(".site-to").value, soundEnabled: row.querySelector(".site-sound").checked };
  }).filter((site) => site.pattern).slice(0, 100);
  await saveSettings(sites); showStatus("Settings saved");
});
resetButton.addEventListener("click", async () => { await chrome.storage.local.set(DEFAULT_SETTINGS); siteList.replaceChildren(); emptySites.hidden = false; await sendAudit("settings_reset", {}); showStatus("Settings reset"); await refreshDashboard(); });
addSiteButton.addEventListener("click", () => { createSiteRow(); emptySites.hidden = true; });

async function refreshDashboard() {
  if(!policySource||!policyPrecedence||!ruleCount||!monitoredCount||!protectionState||!pauseState)return;
  const state = await chrome.runtime.sendMessage({ type: "edgeclose-admin-state" }).catch(() => null);
  if (!state) return;
  policySource.textContent = state.source;
  policyPrecedence.textContent = state.precedence;
  ruleCount.textContent = String(state.ruleCount);
  monitoredCount.textContent = `Monitored tabs: ${state.monitoredCount}`;
  protectionState.textContent = state.paused ? "Paused" : "ON";
  pauseState.textContent = state.paused ? "Temporarily paused from the toolbar." : "No temporary pause.";
}

function formatAuditEvent(event) {
  return String(event || "event").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
async function loadAuditLog() {
  if(!auditList||!auditEmpty)return;
  const entries = await chrome.runtime.sendMessage({ type: "edgeclose-audit-log" }).catch(() => []);
  auditList.replaceChildren(); auditEmpty.hidden = entries.length > 0;
  entries.slice(0, 50).forEach((entry) => {
    const item = document.createElement("div"); item.className = "audit-item";
    const when = document.createElement("time"); when.dateTime = new Date(entry.timestamp).toISOString(); when.textContent = new Date(entry.timestamp).toLocaleString();
    const text = document.createElement("strong"); text.textContent = formatAuditEvent(entry.event);
    const meta = document.createElement("span");
    const values = Object.entries(entry.metadata || {}).map(([key, value]) => `${key}: ${value}`);
    meta.textContent = values.join(" · ");
    item.append(text, when, meta); auditList.append(item);
  });
}
async function sendAudit(event, metadata) { return chrome.runtime.sendMessage({ type: "edgeclose-audit", event, metadata }).catch(() => null); }

async function checkForUpdates(){if(updateStatus)updateStatus.textContent='Microsoft Edge manages updates for Store-installed extensions.';if(availableVersion)availableVersion.textContent=currentVersion;if(availableVersions)availableVersions.replaceChildren();}

checkUpdatesButton?.addEventListener?.("click", checkForUpdates);
initializeAuth();
