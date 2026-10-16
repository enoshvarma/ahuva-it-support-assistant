#!/usr/bin/env bash
# Regenerates app/src/main/assets/oui.txt.gz (MAC prefix -> vendor) from the IEEE registry,
# using the oui-data npm package (BSD-2-Clause) as the source.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -r "$TMP"' EXIT
(cd "$TMP" && npm pack oui-data >/dev/null && tar xzf oui-data-*.tgz)
node -e '
const d = require(process.argv[1]); const out = [];
for (const [k, v] of Object.entries(d)) { const n = v.split("\n")[0].trim().replace(/\s+/g, " "); if (n) out.push(k.toUpperCase() + "\t" + n); }
out.sort(); process.stdout.write(out.join("\n") + "\n");
' "$TMP/package/index.json" | gzip -9 > app/src/main/assets/oui.txt.gz
echo "Wrote $(zcat app/src/main/assets/oui.txt.gz | wc -l) entries"
