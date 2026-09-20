// Knowledge base: built-in vendor command references (kb/) plus any
// .md / .txt documents the engineer imports (userData/docs/).
// Retrieval is simple keyword scoring over chunks — fast, offline, no extra deps.

const fs = require("fs");
const path = require("path");

function readDocsFromDir(dir) {
  const docs = [];
  if (!fs.existsSync(dir)) return docs;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(md|txt)$/i.test(f)) continue;
    try {
      docs.push({ name: f, text: fs.readFileSync(path.join(dir, f), "utf8") });
    } catch { /* skip unreadable */ }
  }
  return docs;
}

// Split a document into chunks on markdown headings (## ...) or blank-line groups.
function chunkDoc(doc) {
  const parts = doc.text.split(/\n(?=#{1,3}\s)/);
  const chunks = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (t.length <= 1600) {
      chunks.push({ source: doc.name, text: t });
    } else {
      // secondary split for very long sections
      for (let i = 0; i < t.length; i += 1400) {
        chunks.push({ source: doc.name, text: t.slice(i, i + 1600) });
      }
    }
  }
  return chunks;
}

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9.\-]+/)
    .filter(w => w.length > 2);
}

const STOP = new Set(["the", "and", "for", "with", "this", "that", "you", "are", "can", "how", "please", "want", "need", "switch"]);

function scoreChunk(chunk, queryTokens) {
  const hay = chunk.text.toLowerCase();
  let score = 0;
  for (const t of queryTokens) {
    if (STOP.has(t)) continue;
    if (hay.includes(t)) score += t.length >= 5 ? 2 : 1;
  }
  return score;
}

class KnowledgeBase {
  constructor(builtinDir, userDir) {
    this.builtinDir = builtinDir;
    this.userDir = userDir;
    this.chunks = [];
    this.reload();
  }

  reload() {
    const docs = [...readDocsFromDir(this.builtinDir), ...readDocsFromDir(this.userDir)];
    this.chunks = docs.flatMap(chunkDoc);
    return { docCount: docs.length, chunkCount: this.chunks.length, files: docs.map(d => d.name) };
  }

  // Retrieve top chunks for query; vendor name is boosted so Allied Telesis
  // questions pull Allied Telesis syntax, not Cisco.
  search(query, vendor, limit = 4) {
    const qTokens = tokenize(query + " " + (vendor || ""));
    const vend = (vendor || "").toLowerCase();
    const scored = this.chunks.map(c => {
      let s = scoreChunk(c, qTokens);
      if (vend && (c.source.toLowerCase().includes(vend.split(" ")[0]) || c.text.toLowerCase().includes(vend))) s += 3;
      return { c, s };
    });
    return scored
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map(x => x.c);
  }
}

module.exports = { KnowledgeBase, chunkDoc, tokenize, scoreChunk };
