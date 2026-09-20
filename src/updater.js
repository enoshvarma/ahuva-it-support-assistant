// Checks GitHub releases for a newer version and returns update info.
// Uses only the built-in https module — no extra dependency.

const https = require("https");
const GITHUB_REPO = "enoshvarma/ahuva-it-support-assistant";

function compareVersions(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function checkForUpdate(currentVersion) {
  return new Promise((resolve) => {
    const req = https.get({
      hostname: "api.github.com",
      path: `/repos/${GITHUB_REPO}/releases/latest`,
      headers: { "User-Agent": "AhuvaITAssistant-updater/1.5" },
      timeout: 8000
    }, (res) => {
      let raw = "";
      res.on("data", d => raw += d);
      res.on("end", () => {
        try {
          const release = JSON.parse(raw);
          if (!release.tag_name) return resolve({ hasUpdate: false });
          const latest = release.tag_name.replace(/^v/, "");
          const hasUpdate = compareVersions(latest, currentVersion) > 0;
          resolve({
            hasUpdate,
            latestVersion: latest,
            downloadUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
            releaseNotes: (release.body || "").slice(0, 800)
          });
        } catch {
          resolve({ hasUpdate: false });
        }
      });
    });
    req.on("error", () => resolve({ hasUpdate: false }));
    req.on("timeout", () => { req.destroy(); resolve({ hasUpdate: false }); });
  });
}

module.exports = { checkForUpdate };
