const assert = require("node:assert/strict");

function patternMatchesUrl(pattern, url) {
  if (!url || !pattern) return false;

  const trimmedPattern = pattern.trim();
  if (!trimmedPattern.includes("://")) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const domainPattern = trimmedPattern.replace(/^\*\.?/, "").replace(/^www\./i, "");
      const escapedDomain = domainPattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      return new RegExp(`(^|\\.)${escapedDomain}$`, "i").test(hostname.replace(/^www\./i, ""));
    } catch {
      return false;
    }
  }

  const escaped = trimmedPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}\/?$`, "i").test(url);
}

assert.equal(patternMatchesUrl("example.com", "https://example.com/"), true);
assert.equal(patternMatchesUrl("example.com", "https://www.example.com/a"), true);
assert.equal(patternMatchesUrl("example.com", "https://sub.example.com/a"), true);
assert.equal(patternMatchesUrl("example.com", "https://evil-example.com/"), false);
assert.equal(patternMatchesUrl("example.com", "https://example.com.evil.test/"), false);
assert.equal(patternMatchesUrl("192.168.1.10", "http://192.168.1.10/app"), true);
assert.equal(patternMatchesUrl("https://www.example.com/*", "https://www.example.com/a/b"), true);
assert.equal(patternMatchesUrl("https://www.example.com/*", "https://www.example.net/a"), false);

console.log("URL matching tests passed");
