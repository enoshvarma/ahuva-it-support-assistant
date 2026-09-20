// Provider-agnostic AI client.
// Supported providers: "anthropic" | "openai" | "openai-compatible" | "ollama"
// All provider config comes from settings — nothing is hard-coded.

const log = require("./logger").child("ai");

function buildRequest(settings, systemPrompt, messages, opts = {}) {
  const provider  = String(settings.provider || "anthropic");
  const model     = String(settings.model || "").trim();
  const apiKey    = String(settings.apiKey || "").trim();
  const timeoutMs = 120000;

  // Google Gemini via the OpenAI-compatible endpoint
  if (provider === "google") {
    const base = String(settings.baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, "");
    return {
      url: base + "/chat/completions",
      options: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: "Bearer " + apiKey } : {})
        },
        body: JSON.stringify({
          model: model || "gemini-2.0-flash",
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.map(m => ({ role: m.role, content: String(m.content || "") }))
          ]
        })
      },
      timeoutMs
    };
  }

  if (provider === "anthropic") {
    const base = String(settings.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
    return {
      url: base + "/v1/messages",
      options: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: model || "claude-sonnet-4-6",
          max_tokens: opts.webSearch ? 4000 : 3500,
          system: systemPrompt,
          messages: messages.map(m => ({ role: m.role, content: String(m.content || "") })),
          ...(opts.webSearch ? { tools: [{ type: "web_search_20250305", name: "web_search" }] } : {})
        })
      },
      timeoutMs
    };
  }

  if (provider === "ollama") {
    const base = String(settings.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
    return {
      url: base + "/api/chat",
      options: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: model || "llama3.1",
          stream: false,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.map(m => ({ role: m.role, content: String(m.content || "") }))
          ]
        })
      },
      timeoutMs
    };
  }

  // openai and openai-compatible share the Chat Completions shape
  const defaultBase = provider === "openai" ? "https://api.openai.com/v1" : "";
  const base = String(settings.baseUrl || defaultBase).replace(/\/+$/, "");
  if (!base) throw new Error("This provider requires a Base URL in Settings (e.g. https://openrouter.ai/api/v1).");
  return {
    url: base + "/chat/completions",
    options: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: "Bearer " + apiKey } : {})
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map(m => ({ role: m.role, content: String(m.content || "") }))
        ]
      })
    },
    timeoutMs
  };
}

function extractText(provider, data) {
  try {
    if (provider === "anthropic") {
      return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    }
    if (provider === "ollama") {
      return (data.message && data.message.content) || "";
    }
    return (data.choices?.[0]?.message?.content) || "";
  } catch {
    return "";
  }
}

// The copilot replies in a strict JSON protocol so the app can render command
// cards with Run buttons. This parser is deliberately forgiving of extra text.
function parseCopilotReply(text) {
  const fallback = { reply: String(text || "").trim(), commands: [], needs: [] };
  if (!text) return { reply: "(empty response from AI provider)", commands: [], needs: [] };
  let raw = String(text).trim();
  // Strip markdown fences if the model wrapped the JSON
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf("{");
  const end   = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return fallback;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const commands = Array.isArray(obj.commands)
      ? obj.commands
          .filter(c => c && typeof c.cmd === "string" && c.cmd.trim())
          .map(c => ({ cmd: c.cmd.trim(), why: String(c.why || "").trim() }))
      : [];
    const needs = Array.isArray(obj.needs) ? obj.needs.map(String) : [];
    return { reply: String(obj.reply || "").trim() || fallback.reply, commands, needs };
  } catch (e) {
    log.warn("JSON parse of AI reply failed, using fallback", { error: e.message });
    return fallback;
  }
}

/** True when this HTTP status is a transient provider error worth retrying. */
function isRetryableStatus(status) {
  return status === 429 || status === 503 || status === 529;
}

async function callAIOnce(settings, systemPrompt, messages, fetchImpl, opts = {}) {
  const f   = fetchImpl || fetch;
  const req = buildRequest(settings, systemPrompt, messages, opts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  log.info("AI request", { provider: settings.provider, model: settings.model });
  let res;
  try {
    res = await f(req.url, { ...req.options, signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error("AI request timed out (120s). Check network and base URL.");
    throw new Error("Could not reach AI provider: " + e.message);
  }
  clearTimeout(timer);
  const bodyText = await res.text();
  if (!res.ok) {
    let msg = bodyText.slice(0, 400);
    try {
      const j = JSON.parse(bodyText);
      msg = (j.error && (j.error.message || j.error.type)) || msg;
    } catch { /* keep raw */ }
    const err = new Error(`AI provider error (HTTP ${res.status}): ${msg}`);
    err.status = res.status;
    log.error("AI provider HTTP error", { status: res.status, message: msg.slice(0, 200) });
    throw err;
  }
  let data;
  try { data = JSON.parse(bodyText); }
  catch { throw new Error("AI provider returned a non-JSON response."); }
  const text = extractText(settings.provider || "anthropic", data);
  return parseCopilotReply(text);
}

async function callAI(settings, systemPrompt, messages, fetchImpl, opts = {}) {
  const MAX_RETRIES = 2;
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callAIOnce(settings, systemPrompt, messages, fetchImpl, opts);
    } catch (e) {
      lastErr = e;
      // Retry on rate-limit / overload; don't retry auth or bad-request errors
      if (attempt < MAX_RETRIES && e.status && isRetryableStatus(e.status)) {
        const delay = (attempt + 1) * 3000;
        log.warn(`Retrying AI request after ${delay}ms (attempt ${attempt + 1})`, { status: e.status });
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

module.exports = { buildRequest, extractText, parseCopilotReply, callAI };
