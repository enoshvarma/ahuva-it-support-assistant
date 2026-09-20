// Optional team telemetry. Disabled unless Dashboard URL is configured.
// Privacy by design: only event type, engineer name, device label, brand/model
// and safety level are sent — NEVER commands, configs, credentials, or API keys.

const os = require("os");
const log = require("./logger").child("telemetry");

const DISABLED = !!process.env.AHUVA_NO_TELEMETRY;

function buildEvent(type, data, settings) {
  return {
    ts: new Date().toISOString(),
    type,
    engineer: (settings.engineerName || "").trim() || os.userInfo().username,
    app_version: String(data.appVersion || ""),
    brand: String(data.brand || ""),
    model: String(data.model || ""),
    level: String(data.level || ""),
    conn: String(data.conn || ""),
    platform: process.platform,
    arch: process.arch
  };
}

async function sendEvent(type, data, settings) {
  if (DISABLED) return;
  const url = String((settings && settings.dashboardUrl) || "").trim();
  if (!url) return;
  try {
    await fetch(url.replace(/\/+$/, "") + "/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(settings.teamToken ? { authorization: "Bearer " + String(settings.teamToken).trim() } : {})
      },
      body: JSON.stringify(buildEvent(type, data, settings)),
      signal: AbortSignal.timeout(4000)
    });
  } catch (e) {
    log.debug("Telemetry send failed (non-fatal)", { message: e.message });
  }
}

module.exports = { buildEvent, sendEvent };
