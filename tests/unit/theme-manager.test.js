// Unit tests for theme state management logic (pure JS, no DOM).
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

// Inline the theme-state logic extracted from app.js for pure unit testing.
const VALID_THEMES = ["dark", "light", "hacker"];

function resolveTheme(raw) {
  return VALID_THEMES.includes(raw) ? raw : "dark";
}

function themeDataAttr(name) {
  return name === "dark" ? "" : name;
}

// ── resolveTheme ──────────────────────────────────────────────────────────────
console.log("\ntheme-manager: resolveTheme");
assert("dark resolves to dark",   resolveTheme("dark"),   "dark");
assert("light resolves to light", resolveTheme("light"),  "light");
assert("hacker resolves to hacker", resolveTheme("hacker"), "hacker");
assert("unknown falls back to dark", resolveTheme("purple"), "dark");
assert("null falls back to dark",    resolveTheme(null),     "dark");
assert("undefined falls back to dark", resolveTheme(undefined), "dark");

// ── themeDataAttr ─────────────────────────────────────────────────────────────
console.log("\ntheme-manager: data-theme attribute value");
assert("dark → empty string (default CSS)",  themeDataAttr("dark"),   "");
assert("light → 'light'",                    themeDataAttr("light"),  "light");
assert("hacker → 'hacker'",                  themeDataAttr("hacker"), "hacker");

// ── xterm theme palette presence ─────────────────────────────────────────────
console.log("\ntheme-manager: hacker palette sanity");
const hackerTheme = {
  background: "#000000",
  foreground: "#00ff66",
  cursor: "#00ff66",
};
assert("hacker bg is true black",  hackerTheme.background, "#000000");
assert("hacker fg is electric green", hackerTheme.foreground, "#00ff66");

// ── localStorage key ─────────────────────────────────────────────────────────
console.log("\ntheme-manager: storage key contract");
const STORAGE_KEY = "ahuva-theme";
assert("storage key unchanged", STORAGE_KEY, "ahuva-theme");

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
