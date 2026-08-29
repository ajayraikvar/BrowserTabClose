const panel = document.createElement("aside");
panel.className = "edgeclose-panel";
panel.setAttribute("role", "status");
panel.hidden = true;
document.documentElement.append(panel);

let timeoutSeconds = 900;
let warningSeconds = 10;
let idleState = "active";
let remainingSeconds = timeoutSeconds;
let deadlineAt = 0;
let isActiveTab = false;
let scheduleActive = true;
let activityTimer;
let soundEnabled = true;
let warningSoundPlayed = false;
let audioContext;

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

function render() {
  if (!scheduleActive) {
    panel.hidden = true;
    return;
  }

  if (idleState === "active" && remainingSeconds > warningSeconds) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  panel.innerHTML = `<strong>EdgeClose warning</strong><span>You have been inactive. This tab will close soon.</span><b>Closing in ${formatTime(remainingSeconds)}</b>`;

  if (soundEnabled && !warningSoundPlayed) {
    warningSoundPlayed = true;
    playWarningSound();
  }
}

function playWarningSound() {
  try {
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 880;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.12, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.35);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.35);
  } catch {
    // Warning UI remains useful even when browser audio is unavailable.
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "edgeclose-status") return;

  if (message.enabled === false) {
    panel.hidden = true;
    scheduleActive = false;
    idleState = "active";
    warningSoundPlayed = false;
    return;
  }

  timeoutSeconds = Number(message.timeoutSeconds) || timeoutSeconds;
  warningSeconds = Number(message.warningSeconds) || warningSeconds;
  idleState = message.idleState || "active";
  remainingSeconds = Math.max(0, Number(message.remainingSeconds) || 0);
  deadlineAt = Number(message.deadlineAt) || (Date.now() + remainingSeconds * 1000);
  isActiveTab = message.isActiveTab === true;
  scheduleActive = message.scheduleActive !== false;
  soundEnabled = message.soundEnabled !== false;

  if (idleState === "active") warningSoundPlayed = false;
  render();
});

function reportActivity() {
  chrome.runtime.sendMessage({ type: "edgeclose-activity" }).catch(() => {});
}

["pointerdown", "keydown", "wheel", "touchstart", "input"].forEach((eventName) => {
  window.addEventListener(eventName, () => {
    if (soundEnabled && !audioContext) {
      try {
        audioContext = new AudioContext();
      } catch {
        audioContext = null;
      }
    }
    if (soundEnabled && audioContext?.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    window.clearTimeout(activityTimer);
    activityTimer = window.setTimeout(reportActivity, 150);
  }, { capture: true, passive: true });
});

reportActivity();

setInterval(() => {
  if (!scheduleActive || !deadlineAt) return;
  remainingSeconds = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
  if (remainingSeconds <= warningSeconds && remainingSeconds > 0) {
    idleState = "warning";
  }
  render();
}, 1000);
