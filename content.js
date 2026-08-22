const panel = document.createElement("aside");
panel.className = "edgeclose-panel";
panel.setAttribute("role", "status");
panel.hidden = true;
document.documentElement.append(panel);

let timeoutSeconds = 900;
let warningSeconds = 10;
let idleState = "active";
let remainingSeconds = timeoutSeconds;
let isActiveTab = false;
let activityTimer;

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

function render() {
  if (idleState === "active" && remainingSeconds > warningSeconds) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  panel.innerHTML = `<strong>EdgeClose warning</strong><span>You have been inactive. This tab will close soon.</span><b>Closing in ${formatTime(remainingSeconds)}</b>`;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "edgeclose-status") return;
  timeoutSeconds = message.timeoutSeconds;
  warningSeconds = message.warningSeconds;
  idleState = message.idleState;
  remainingSeconds = message.remainingSeconds;
  isActiveTab = message.isActiveTab;
  render();
});

function reportActivity() {
  chrome.runtime.sendMessage({ type: "edgeclose-activity" }).catch(() => {});
}

["pointerdown", "keydown", "wheel", "touchstart"].forEach((eventName) => {
  window.addEventListener(eventName, () => {
    window.clearTimeout(activityTimer);
    activityTimer = window.setTimeout(reportActivity, 150);
  }, { capture: true, passive: true });
});

reportActivity();

setInterval(() => {
  if (remainingSeconds > 0) {
    remainingSeconds -= 1;
    if (remainingSeconds <= warningSeconds) idleState = "warning";
    render();
  }
}, 1000);