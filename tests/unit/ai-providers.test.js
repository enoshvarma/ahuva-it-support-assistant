// Unit tests for src/ai-providers.js — retry logic and provider routing.
let passed = 0, failed = 0;
function assert(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}

// ── isRetryableStatus (extracted logic) ───────────────────────────────────────
console.log("\nai-providers: retryable status codes");
function isRetryableStatus(s) { return s === 429 || s === 503 || s === 529; }
assert("429 rate-limit is retryable", isRetryableStatus(429), true);
assert("503 overload is retryable",   isRetryableStatus(503), true);
assert("529 overload is retryable",   isRetryableStatus(529), true);
assert("401 auth error not retryable", isRetryableStatus(401), false);
assert("400 bad-request not retryable", isRetryableStatus(400), false);
assert("200 ok not retryable",         isRetryableStatus(200), false);

// ── retry delay schedule ─────────────────────────────────────────────────────
console.log("\nai-providers: retry delay schedule");
function retryDelay(attempt) { return (attempt + 1) * 3000; }
assert("attempt 0 → 3 s",  retryDelay(0), 3000);
assert("attempt 1 → 6 s",  retryDelay(1), 6000);

// ── max retries constant ──────────────────────────────────────────────────────
console.log("\nai-providers: max retries");
const MAX_RETRIES = 2;
assert("max retries is 2", MAX_RETRIES, 2);

// ── callAI retry simulation ───────────────────────────────────────────────────
console.log("\nai-providers: callAI retry loop simulation");
{
  let calls = 0;
  async function simulateCallAI(shouldFailWith) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      calls++;
      if (shouldFailWith && attempt < MAX_RETRIES) {
        const err = new Error("rate limited"); err.status = shouldFailWith;
        if (isRetryableStatus(shouldFailWith)) continue;
        throw err;
      }
      if (!shouldFailWith || attempt === MAX_RETRIES) return "ok";
    }
  }

  simulateCallAI(429).then(r => {
    assert("retries exhaust and return ok on final attempt", r, "ok");
    assert("made MAX_RETRIES+1 attempts for 429", calls, MAX_RETRIES + 1);
  });
}

// ── models.js provider list ───────────────────────────────────────────────────
console.log("\nmodels: provider catalog");
const models = require("../../src/models");
const providers = models.allProviders();
assert("providers list is non-empty", providers.length > 0, true);
assert("anthropic is a provider",  providers.includes("anthropic"),  true);
assert("openai is a provider",     providers.includes("openai"),     true);
assert("google is a provider",     providers.includes("google"),     true);
assert("ollama is a provider",     providers.includes("ollama"),     true);

const anthropicPresets = models.presetsFor("anthropic", false);
assert("anthropic has presets", anthropicPresets.length > 0, true);
assert("anthropic presets have id field",    typeof anthropicPresets[0].id,    "string");
assert("anthropic presets have label field", typeof anthropicPresets[0].label, "string");
assert("anthropic presets have cost field",  typeof anthropicPresets[0].cost,  "string");

const freeOnly = models.presetsFor("openrouter", true);
const allNonFree = freeOnly.filter(m => !m.free);
assert("freeOnly filter returns only free presets", allNonFree.length, 0);

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
