importScripts("background-v163.js");

const EC164_AUTH_HASH = "edgeclose-settings-password-hash";
const EC164_AUTH_SALT = "edgeclose-settings-password-salt";
const EC164_AUTH_ITERATIONS = "edgeclose-settings-password-iterations";

async function ec164VerifyPassword(password) {
  try {
    const stored = await chrome.storage.local.get([EC164_AUTH_HASH, EC164_AUTH_SALT, EC164_AUTH_ITERATIONS]);
    if (!stored[EC164_AUTH_HASH] || !stored[EC164_AUTH_SALT]) return false;
    const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password || "")), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      salt: Uint8Array.from(atob(stored[EC164_AUTH_SALT]), (c) => c.charCodeAt(0)),
      iterations: Number(stored[EC164_AUTH_ITERATIONS]) || 310000,
      hash: "SHA-256"
    }, raw, 256);
    const expected = Uint8Array.from(atob(stored[EC164_AUTH_HASH]), (c) => c.charCodeAt(0));
    const actual = new Uint8Array(bits);
    if (expected.length !== actual.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected[i] ^ actual[i];
    return diff === 0;
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "edgeclose-verify-password") return;
  ec164VerifyPassword(message.password).then((ok) => sendResponse({ ok })).catch(() => sendResponse({ ok: false }));
  return true;
});
