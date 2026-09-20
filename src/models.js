// Full AI model catalogue — categorised by org.
// cost legend:  free  $ $$  $$$  $$$$

const PRESETS = {
  // ── Anthropic ────────────────────────────────────────────────────────────
  anthropic: [
    { id: "claude-opus-4-5",              label: "Claude Opus 4.5 — max capability",         speed: "slower",  cost: "$$$$", note: "Best for hard multi-device design.", free: false },
    { id: "claude-sonnet-4-6",            label: "Claude Sonnet 4.6 — balanced ★",           speed: "fast",    cost: "$$",   note: "Recommended: best accuracy/price for live work.", free: false },
    { id: "claude-haiku-4-5",             label: "Claude Haiku 4.5 — fastest",               speed: "fastest", cost: "$",    note: "Routine VLAN/port changes; less strong on complex firewall logic.", free: false },
    { id: "claude-3-7-sonnet-20250219",   label: "Claude 3.7 Sonnet — extended thinking",    speed: "fast",    cost: "$$",   note: "Extended thinking; strong step-by-step reasoning.", free: false },
    { id: "claude-3-5-sonnet-20241022",   label: "Claude 3.5 Sonnet (Oct 2024)",             speed: "fast",    cost: "$$",   note: "Balanced; very capable.", free: false },
    { id: "claude-3-5-haiku-20241022",    label: "Claude 3.5 Haiku — lightweight",           speed: "fastest", cost: "$",    note: "Low-cost, high-speed variant.", free: false },
    { id: "claude-3-opus-20240229",       label: "Claude 3 Opus — legacy top-tier",          speed: "slower",  cost: "$$$$", note: "Prior flagship Anthropic model.", free: false },
    { id: "claude-3-sonnet-20240229",     label: "Claude 3 Sonnet",                          speed: "fast",    cost: "$$",   note: "Balanced mid-tier.", free: false },
    { id: "claude-3-haiku-20240307",      label: "Claude 3 Haiku — fastest Claude 3",        speed: "fastest", cost: "$",    note: "Very fast, very cheap.", free: false },
  ],

  // ── OpenAI ────────────────────────────────────────────────────────────────
  openai: [
    { id: "gpt-4o",                       label: "GPT-4o — multimodal balanced",             speed: "fast",    cost: "$$$",  note: "Strong reasoning + vision.", free: false },
    { id: "gpt-4o-mini",                  label: "GPT-4o mini — fast & cheap",               speed: "fastest", cost: "$",    note: "Good for routine questions.", free: false },
    { id: "o1",                           label: "o1 — deep reasoning",                      speed: "slower",  cost: "$$$$", note: "Best for hard multi-step problems.", free: false },
    { id: "o1-mini",                      label: "o1-mini — compact reasoning",              speed: "slow",    cost: "$$",   note: "Smaller o1-class reasoning model.", free: false },
    { id: "o3-mini",                      label: "o3-mini — efficient reasoning",            speed: "fast",    cost: "$$",   note: "Latest efficient reasoning; strong code tasks.", free: false },
    { id: "gpt-4-turbo",                  label: "GPT-4 Turbo — 128k context",              speed: "fast",    cost: "$$$",  note: "Long-context tasks.", free: false },
    { id: "gpt-3.5-turbo",               label: "GPT-3.5 Turbo — legacy fast & cheap",     speed: "fastest", cost: "$",    note: "Legacy; cheapest OpenAI.", free: false },
  ],

  // ── Google ───────────────────────────────────────────────────────────────
  google: [
    { id: "gemini-2.0-flash",             label: "Gemini 2.0 Flash — ultra-fast ★",          speed: "fastest", cost: "$",    note: "Fastest Gemini; multimodal.", free: true  },
    { id: "gemini-2.0-flash-thinking-exp",label: "Gemini 2.0 Flash Thinking (exp)",          speed: "fast",    cost: "$",    note: "Reasoning-mode Flash.", free: false },
    { id: "gemini-1.5-pro",               label: "Gemini 1.5 Pro — 1M context",             speed: "fast",    cost: "$$",   note: "1M-token window; strong.", free: false },
    { id: "gemini-1.5-flash",             label: "Gemini 1.5 Flash — fast & cheap",         speed: "fastest", cost: "$",    note: "Affordable, multimodal.", free: true  },
    { id: "gemini-1.5-flash-8b",          label: "Gemini 1.5 Flash-8B — free tier",         speed: "fastest", cost: "free", note: "Google free quota; very lightweight.", free: true  },
  ],

  // ── OpenRouter / OpenAI-compatible base URL ───────────────────────────────
  "openai-compatible": [
    // Anthropic via OpenRouter
    { id: "anthropic/claude-sonnet-4-6",            label: "OpenRouter · Claude Sonnet 4.6 ★",             speed: "fast",    cost: "$$",   note: "Recommended default via OpenRouter.", free: false, via: "openrouter" },
    { id: "anthropic/claude-3-7-sonnet-20250219",   label: "OpenRouter · Claude 3.7 Sonnet",               speed: "fast",    cost: "$$",   note: "Extended thinking via OpenRouter.", free: false, via: "openrouter" },
    { id: "anthropic/claude-3-5-haiku",             label: "OpenRouter · Claude 3.5 Haiku",                speed: "fastest", cost: "$",    note: "Cheapest Claude via OpenRouter.", free: false, via: "openrouter" },
    // OpenAI via OpenRouter
    { id: "openai/gpt-4o",                          label: "OpenRouter · GPT-4o",                          speed: "fast",    cost: "$$$",  note: "OpenAI multimodal.", free: false, via: "openrouter" },
    { id: "openai/gpt-4o-mini",                     label: "OpenRouter · GPT-4o mini",                     speed: "fastest", cost: "$",    note: "OpenAI cheap.", free: false, via: "openrouter" },
    { id: "openai/o3-mini",                         label: "OpenRouter · o3-mini",                         speed: "fast",    cost: "$$",   note: "OpenAI reasoning.", free: false, via: "openrouter" },
    // Google via OpenRouter
    { id: "google/gemini-2.0-flash-001",            label: "OpenRouter · Gemini 2.0 Flash",                speed: "fastest", cost: "$",    note: "Very cheap; verify vendor syntax.", free: false, via: "openrouter" },
    { id: "google/gemini-flash-1.5-8b",             label: "OpenRouter · Gemini Flash 1.5 8B — FREE",      speed: "fastest", cost: "free", note: "Free tier via OpenRouter.", free: true,  via: "openrouter" },
    { id: "google/gemini-pro-1.5",                  label: "OpenRouter · Gemini 1.5 Pro",                  speed: "fast",    cost: "$$",   note: "Long context.", free: false, via: "openrouter" },
    // DeepSeek
    { id: "deepseek/deepseek-chat",                 label: "OpenRouter · DeepSeek V3",                     speed: "fast",    cost: "$",    note: "Very low cost.", free: false, via: "openrouter" },
    { id: "deepseek/deepseek-r1",                   label: "OpenRouter · DeepSeek R1 — reasoning",         speed: "slow",    cost: "$$",   note: "Chain-of-thought reasoning model.", free: false, via: "openrouter" },
    { id: "deepseek/deepseek-r1-distill-qwen-32b",  label: "OpenRouter · DeepSeek R1 Distill 32B",         speed: "fast",    cost: "$",    note: "Smaller, faster R1 distillation.", free: false, via: "openrouter" },
    // Meta Llama
    { id: "meta-llama/llama-3.3-70b-instruct",     label: "OpenRouter · Llama 3.3 70B",                   speed: "fast",    cost: "$",    note: "Strong open-weights model.", free: false, via: "openrouter" },
    { id: "meta-llama/llama-3.1-405b-instruct",    label: "OpenRouter · Llama 3.1 405B",                  speed: "slow",    cost: "$$",   note: "Largest open-weights.", free: false, via: "openrouter" },
    { id: "meta-llama/llama-3.1-8b-instruct:free", label: "OpenRouter · Llama 3.1 8B — FREE",             speed: "fastest", cost: "free", note: "Free tier; fast small model.", free: true,  via: "openrouter" },
    // Qwen
    { id: "qwen/qwen-2.5-72b-instruct",            label: "OpenRouter · Qwen 2.5 72B",                    speed: "fast",    cost: "$",    note: "Strong Chinese + English.", free: false, via: "openrouter" },
    { id: "qwen/qwen-2.5-coder-32b-instruct",      label: "OpenRouter · Qwen 2.5 Coder 32B",              speed: "fast",    cost: "$",    note: "Excellent for config generation.", free: false, via: "openrouter" },
    // Mistral
    { id: "mistralai/mistral-large",               label: "OpenRouter · Mistral Large",                   speed: "fast",    cost: "$$",   note: "Strong multilingual reasoning.", free: false, via: "openrouter" },
    { id: "mistralai/mistral-nemo",                label: "OpenRouter · Mistral Nemo — FREE",              speed: "fast",    cost: "free", note: "Free tier via OpenRouter.", free: true,  via: "openrouter" },
    { id: "mistralai/codestral-mamba",             label: "OpenRouter · Codestral — code-focused",        speed: "fast",    cost: "$",    note: "Best for CLI/config generation.", free: false, via: "openrouter" },
    // Groq (change base URL to https://api.groq.com/openai/v1)
    { id: "llama-3.3-70b-versatile",               label: "Groq · Llama 3.3 70B — ultra-fast ★",          speed: "fastest", cost: "free", note: "Free tier via Groq. Base URL: https://api.groq.com/openai/v1", free: true,  via: "groq" },
    { id: "llama-3.1-8b-instant",                  label: "Groq · Llama 3.1 8B — instant",                speed: "fastest", cost: "free", note: "Smallest, fastest. Base URL: https://api.groq.com/openai/v1", free: true,  via: "groq" },
    { id: "mixtral-8x7b-32768",                    label: "Groq · Mixtral 8x7B",                          speed: "fastest", cost: "free", note: "Groq free tier. Base URL: https://api.groq.com/openai/v1", free: true,  via: "groq" },
    { id: "gemma2-9b-it",                          label: "Groq · Gemma 2 9B",                             speed: "fastest", cost: "free", note: "Google Gemma on Groq. Base URL: https://api.groq.com/openai/v1", free: true, via: "groq" },
    // Together AI
    { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Together · Llama 3.3 70B Turbo",            speed: "fast",    cost: "$",    note: "Together AI. Base URL: https://api.together.xyz/v1", free: false, via: "together" },
    { id: "deepseek-ai/DeepSeek-R1",               label: "Together · DeepSeek R1",                       speed: "slow",    cost: "$$",   note: "Together AI. Base URL: https://api.together.xyz/v1", free: false, via: "together" },
  ],

  // ── Local: Ollama ─────────────────────────────────────────────────────────
  ollama: [
    { id: "llama3.3",      label: "Llama 3.3 (local, free)",           speed: "depends", cost: "free", note: "Best local general model. No data leaves the machine.", free: true },
    { id: "llama3.1",      label: "Llama 3.1 (local, free)",           speed: "depends", cost: "free", note: "Solid fallback.", free: true },
    { id: "qwen2.5",       label: "Qwen 2.5 (local, free)",            speed: "depends", cost: "free", note: "Strong code + reasoning.", free: true },
    { id: "qwen2.5-coder", label: "Qwen 2.5 Coder (local, free)",      speed: "depends", cost: "free", note: "Specialized for config generation.", free: true },
    { id: "deepseek-r1",   label: "DeepSeek R1 (local, free)",         speed: "depends", cost: "free", note: "Local reasoning model.", free: true },
    { id: "mistral",       label: "Mistral (local, free)",              speed: "depends", cost: "free", note: "Good general purpose.", free: true },
    { id: "codestral",     label: "Codestral (local, free)",            speed: "depends", cost: "free", note: "Specialized for config tasks.", free: true },
    { id: "phi4",          label: "Phi-4 (local, free)",                speed: "fast",    cost: "free", note: "Microsoft small model, fast on CPU.", free: true },
    { id: "gemma2",        label: "Gemma 2 (local, free)",              speed: "depends", cost: "free", note: "Google open model.", free: true },
    { id: "phi3.5",        label: "Phi-3.5 mini (local, free)",         speed: "fastest", cost: "free", note: "Tiny but capable.", free: true },
  ],
};

const BASE_URLS = {
  "openai-compatible": "https://openrouter.ai/api/v1",
  "google":            "https://generativelanguage.googleapis.com/v1beta/openai",
  "ollama":            "http://localhost:11434",
};

const PROVIDER_LABELS = {
  anthropic:          "Anthropic (Claude)",
  openai:             "OpenAI (GPT / o-series)",
  google:             "Google (Gemini)",
  "openai-compatible":"OpenAI-compatible — OpenRouter / Groq / Together",
  ollama:             "Ollama (local, offline)",
};

const FREE_NOTE  = "🆓 Free-tier models are highlighted. Actual limits depend on the provider.";
const GROQ_NOTE  = "⚡ Groq models need Base URL: https://api.groq.com/openai/v1";
const OMNI_NOTE  = "OmniRouter: use Base URL https://api.omnirouter.ai/v1 with your OmniRouter key.";

function presetsFor(provider, freeOnly = false) {
  const list = PRESETS[provider] || [];
  return freeOnly ? list.filter(m => m.free) : list;
}

function defaultBaseUrl(provider) { return BASE_URLS[provider] || ""; }

function defaultModel(provider) {
  const p = PRESETS[provider];
  if (!p || !p.length) return "";
  const rec = p.find(m => /★/.test(m.label) || /recommended/i.test(m.note));
  return (rec || p[0]).id;
}

function allProviders() { return Object.keys(PRESETS); }

module.exports = { PRESETS, BASE_URLS, PROVIDER_LABELS, FREE_NOTE, GROQ_NOTE, OMNI_NOTE,
                   presetsFor, defaultBaseUrl, defaultModel, allProviders };
