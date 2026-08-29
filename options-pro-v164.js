(() => {
  const $ = (selector) => document.querySelector(selector);

  function inject() {
    const root = $("#protected-content");
    if (!root || $("#ec164-controls")) return;

    const section = document.createElement("section");
    section.id = "ec164-controls";
    section.className = "ec160-card";
    section.innerHTML = `<div class="ec160-head"><div><p class="ec160-kicker">Protection control</p><h2>Temporary pause</h2><p class="ec160-copy">Pause and resume are available only from this password-protected Options page.</p></div><span id="ec164-pill" class="ec160-pill">Protection ON</span></div><div class="ec160-actions"><button type="button" data-ec164-pause="15">15 minutes</button><button type="button" data-ec164-pause="60">1 hour</button><button type="button" data-ec164-pause="1440">24 hours</button><button id="ec164-resume" type="button" class="wide">Resume protection</button></div>`;
    root.insertBefore(section, root.firstChild);

    const modal = document.createElement("div");
    modal.className = "ec160-modal";
    modal.hidden = true;
    modal.innerHTML = `<div class="ec160-dialog" role="dialog" aria-modal="true" aria-labelledby="ec164-title"><h2 id="ec164-title">Password required</h2><p id="ec164-copy">Enter your settings password to continue.</p><form id="ec164-form"><input id="ec164-password" type="password" autocomplete="current-password" required><div class="ec160-dialog-actions"><button type="button" id="ec164-cancel" class="text-button">Cancel</button><button type="submit" class="primary-button">Confirm</button></div><p id="ec164-error" class="ec160-status"></p></form></div>`;
    document.body.append(modal);

    const ask = (copy, action) => new Promise((resolve) => {
      $("#ec164-copy").textContent = copy;
      $("#ec164-password").value = "";
      $("#ec164-error").textContent = "";
      modal.hidden = false;

      const cleanup = () => {
        $("#ec164-cancel").removeEventListener("click", cancel);
        $("#ec164-form").removeEventListener("submit", submit);
      };
      const cancel = () => { modal.hidden = true; cleanup(); resolve(false); };
      const submit = async (event) => {
        event.preventDefault();
        const result = await chrome.runtime.sendMessage({ type: "edgeclose-verify-password", password: $("#ec164-password").value }).catch(() => ({ ok: false }));
        if (!result?.ok) {
          $("#ec164-error").textContent = "Incorrect password.";
          $("#ec164-password").select();
          return;
        }
        try {
          await action();
          modal.hidden = true;
          cleanup();
          resolve(true);
        } catch {
          $("#ec164-error").textContent = "Action could not be completed.";
        }
      };

      $("#ec164-cancel").addEventListener("click", cancel);
      $("#ec164-form").addEventListener("submit", submit);
      $("#ec164-password").focus();
    });

    const refresh = async () => {
      const state = await chrome.runtime.sendMessage({ type: "edgeclose-admin-state" }).catch(() => null);
      const pill = $("#ec164-pill");
      if (pill && state) {
        pill.textContent = state.paused ? "Protection paused" : "Protection ON";
        pill.classList.toggle("paused", Boolean(state.paused));
      }
    };

    section.querySelectorAll("[data-ec164-pause]").forEach((button) => button.addEventListener("click", () => ask("Enter your settings password to pause protection.", async () => {
      await chrome.runtime.sendMessage({ type: "edgeclose-pause", minutes: Number(button.dataset.ec164Pause) });
      await refresh();
    })));

    $("#ec164-resume").addEventListener("click", () => ask("Enter your settings password to resume protection.", async () => {
      await chrome.runtime.sendMessage({ type: "edgeclose-resume" });
      await refresh();
    }));

    refresh();
  }

  inject();
})();
