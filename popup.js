const $ = (selector) => document.querySelector(selector);
const statusDot = $("#status-dot");
const protectionStatus = $("#protection-status");
const protectionDetail = $("#protection-detail");
const pauseCard = $("#pause-card");
const pauseDetail = $("#pause-detail");
const resumeButton = $("#resume");
const tabCount = $("#tab-count");
const tabList = $("#tab-list");
const noTabs = $("#no-tabs");
const message = $("#message");

function formatRemaining(ms) {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function showMessage(text) {
  message.textContent = text;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => { message.textContent = ""; }, 2500);
}

function render(state) {
  const paused = state.pauseUntil > Date.now();
  statusDot.className = `status-dot ${paused ? "paused" : "on"}`;
  protectionStatus.textContent = paused ? "Protection paused" : "Protection ON";
  protectionDetail.textContent = paused ? "Timers are temporarily suspended." : `${state.monitoredTabs.length} monitored tab${state.monitoredTabs.length === 1 ? "" : "s"}.`;

  pauseCard.hidden = !paused;
  if (paused) pauseDetail.textContent = `Resumes in ${formatRemaining(state.pauseUntil - Date.now())}.`;

  tabCount.textContent = `${state.monitoredTabs.length}`;
  tabList.replaceChildren();
  noTabs.hidden = state.monitoredTabs.length > 0;

  state.monitoredTabs.forEach((tab) => {
    const item = document.createElement("li");
    item.className = "tab-item";
    const title = document.createElement("strong");
    title.textContent = tab.title || "Monitored tab";
    const remaining = document.createElement("span");
    remaining.textContent = formatRemaining(tab.deadlineAt - Date.now());
    item.append(title, remaining);
    tabList.append(item);
  });
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "edgeclose-popup-state" }).catch(() => null);
  if (state) render(state);
}

document.querySelectorAll("[data-minutes]").forEach((button) => {
  button.addEventListener("click", async () => {
    const minutes = Number(button.dataset.minutes);
    const result = await chrome.runtime.sendMessage({ type: "edgeclose-pause", minutes }).catch(() => null);
    if (result?.ok) {
      showMessage(`Paused for ${minutes < 60 ? `${minutes} minutes` : minutes === 60 ? "1 hour" : "24 hours"}.`);
      await refresh();
    }
  });
});

resumeButton.addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "edgeclose-resume" }).catch(() => null);
  if (result?.ok) {
    showMessage("Protection resumed.");
    await refresh();
  }
});

$("#open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
window.setInterval(refresh, 1000);
