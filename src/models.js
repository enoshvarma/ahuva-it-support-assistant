// Curated model presets so the engineer picks by outcome (fast/cheap/accurate)
// instead of memorising model IDs. Prices are indicative USD per 1M tokens and
// change over time — treat as guidance, verify with the provider.

const PRESETS = {
  anthropic: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — balanced (recommended)", speed: "fast", cost: "$$", note: "Best accuracy/price balance for live site work." },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest, cheapest", speed: "fastest", cost: "$", note: "Great for routine VLAN/port work; less strong on complex firewall logic." },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8 — most capable", speed: "slower", cost: "$$$$", note: "Use for complex multi-device design or tricky faults." }
  ],
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini — fast & cheap", speed: "fastest", cost: "$", note: "Good routine assistant." },
    { id: "gpt-4o", label: "GPT-4o — balanced", speed: "fast", cost: "$$$", note: "Stronger reasoning." }
  ],
  // OpenRouter: one key, many models, often the cheapest route.
  "openai-compatible": [
    { id: "anthropic/claude-haiku-4.5", label: "OpenRouter · Claude Haiku 4.5 — fastest, cheapest", speed: "fastest", cost: "$", note: "Best cost-per-task for routine field work." },
    { id: "anthropic/claude-sonnet-4.6", label: "OpenRouter · Claude Sonnet 4.6 — balanced", speed: "fast", cost: "$$", note: "Recommended default via OpenRouter." },
    { id: "google/gemini-2.0-flash-001", label: "OpenRouter · Gemini Flash — very cheap & quick", speed: "fastest", cost: "$", note: "Cheap; verify vendor syntax carefully." },
    { id: "deepseek/deepseek-chat", label: "OpenRouter · DeepSeek — very low cost", speed: "fast", cost: "$", note: "Lowest cost tier; good for show/verify steps." },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "OpenRouter · Llama 3.3 70B — open model", speed: "fast", cost: "$", note: "Open-weights option." }
  ],
  ollama: [
    { id: "llama3.1", label: "Llama 3.1 (local, offline, free)", speed: "depends on laptop", cost: "free", note: "No data leaves the laptop — best for sensitive client sites." },
    { id: "qwen2.5", label: "Qwen 2.5 (local, offline, free)", speed: "depends on laptop", cost: "free", note: "Good local alternative." }
  ]
};

const BASE_URLS = {
  "openai-compatible": "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434"
};

function presetsFor(provider) { return PRESETS[provider] || []; }
function defaultBaseUrl(provider) { return BASE_URLS[provider] || ""; }
function defaultModel(provider) {
  const p = PRESETS[provider];
  if (!p || !p.length) return "";
  // pick the "recommended"/balanced entry when present, else first
  const rec = p.find(m => /recommended/i.test(m.label));
  return (rec || p[0]).id;
}

module.exports = { PRESETS, BASE_URLS, presetsFor, defaultBaseUrl, defaultModel };
