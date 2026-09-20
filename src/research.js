// Weekly research engine.
// Fetches trusted networking sources + (where the provider supports it) does a
// web-search discovery pass, then has the AI distil NEW / notable configuration
// info into a dated, clearly-labelled markdown digest that is added to the
// knowledge base as REVIEW material — never auto-executed.

// Curated, editable trusted sources. Official vendor docs first — these are the
// safe, authoritative places for command/config changes. The engineer can add
// their own trusted URLs in the Research Center.
const DEFAULT_SOURCES = [
  // Vendor configuration guides
  { label: "Allied Telesis — AlliedWare Plus release notes", url: "https://www.alliedtelesis.com/us/en/documents/alliedware-plus-release-notes" },
  { label: "Cisco — Catalyst IOS-XE release notes", url: "https://www.cisco.com/c/en/us/support/switches/catalyst-9000-series-switches/series.html" },
  { label: "Fortinet — FortiOS admin guide", url: "https://docs.fortinet.com/product/fortigate/" },
  { label: "MikroTik — RouterOS changelog", url: "https://mikrotik.com/download/changelogs" },
  { label: "Juniper — JunOS release notes", url: "https://www.juniper.net/documentation/us/en/software/junos/release-notes/" },
  // Security advisories — critical for field engineers
  { label: "Cisco PSIRT — Security Advisories", url: "https://sec.cloudapps.cisco.com/security/center/publicationListing.x" },
  { label: "Fortinet PSIRT — Security Advisories", url: "https://www.fortiguard.com/psirt" },
  { label: "MikroTik — Security advisories", url: "https://mikrotik.com/about/whats_new" },
  // Best-practice references
  { label: "NSA — Network Infrastructure Security Guide", url: "https://media.defense.gov/2022/Jun/15/2003018261/-1/-1/0/CTR_NSA_NETWORK_INFRASTRUCTURE_SECURITY_GUIDE_20220615.PDF" }
];

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Should the weekly run fire? (>= `days` since last, or never run)
function shouldRunWeekly(lastIso, now = new Date(), days = 7) {
  if (!lastIso) return true;
  const last = new Date(lastIso).getTime();
  if (isNaN(last)) return true;
  return (now.getTime() - last) >= days * 24 * 3600 * 1000;
}

function buildResearchPrompt(vendors, sourceBlocks) {
  const vlist = (vendors && vendors.length ? vendors : ["Allied Telesis", "Cisco", "Fortinet", "MikroTik"]).join(", ");
  const src = sourceBlocks.length
    ? sourceBlocks.map(s => `### Source: ${s.label}\n${s.text.slice(0, 6000)}`).join("\n\n")
    : "(no source text fetched — use your own up-to-date knowledge, and clearly say it is not from a fetched source)";
  return `You are updating the knowledge base of a field network-configuration assistant used by engineers of Ahuva Electronic Technologies. Focus vendors: ${vlist}.

From the material below (and your knowledge), produce a concise, PRACTICAL update covering ONLY things useful for on-site switch/router/firewall configuration:
- New or changed CLI commands / syntax
- New recommended best-practice configurations
- Deprecated commands or gotchas to avoid
- CRITICAL: Active security advisories (CVEs, PSIRT bulletins) for the above vendors — include CVE ID, affected versions, and the exact config fix or mitigation command
- Default credentials that must be changed on first login
- Protocol hardening (SSH version, cipher suites, SNMPv3 requirements)

STRICT RULES:
- Group by vendor with clear headings.
- For every command, give the exact syntax and a one-line purpose.
- If you are not certain something is current/correct, say so explicitly — do NOT present guesses as fact.
- Do NOT invent version numbers, CVE IDs, or commands. If a source doesn't support a claim, omit it.
- Keep it tight and skimmable. This is reference material an engineer will VERIFY before using on live equipment.

Return clean markdown only (no preamble).

MATERIAL:
${src}`;
}

function formatDigest(aiMarkdown, sources, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  const srcList = sources.map(s => `- ${s.label}${s.ok === false ? " (unavailable this run)" : ""}: ${s.url}`).join("\n");
  return `# Research digest — ${stamp}

> ⚠ **AI-researched reference. VERIFY on the device before using on live client equipment.**
> Generated automatically by the weekly research task. Not a substitute for official vendor documentation.

**Sources consulted this run:**
${srcList}

---

${String(aiMarkdown || "").trim() || "_No content produced this run._"}
`;
}

// Fetch source texts (best-effort; failures are skipped and marked).
async function fetchSources(sources, fetchImpl) {
  const f = fetchImpl || fetch;
  const out = [];
  for (const s of sources) {
    try {
      const res = await f(s.url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "AhuvaITAssistant/research" } });
      const html = await res.text();
      out.push({ label: s.label, url: s.url, text: htmlToText(html), ok: res.ok });
    } catch {
      out.push({ label: s.label, url: s.url, text: "", ok: false });
    }
  }
  return out;
}

// Orchestrate one research run. aiImpl(systemPrompt, messages) -> {reply}
async function runResearch({ vendors, sources, fetchImpl, aiImpl }) {
  const srcList = (sources && sources.length ? sources : DEFAULT_SOURCES);
  const fetched = await fetchSources(srcList, fetchImpl);
  const usable = fetched.filter(s => s.text && s.text.length > 200);
  const prompt = buildResearchPrompt(vendors, usable);
  const ai = await aiImpl(prompt, [{ role: "user", content: "Produce the configuration update digest now." }]);
  const digest = formatDigest(ai.reply || ai || "", fetched);
  return { digest, sources: fetched, generatedAt: new Date().toISOString() };
}

module.exports = { DEFAULT_SOURCES, htmlToText, shouldRunWeekly, buildResearchPrompt, formatDigest, fetchSources, runResearch };
