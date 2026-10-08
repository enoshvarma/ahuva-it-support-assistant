// Text helpers: AutoCAD control codes (%%c, %%d ...), \U+XXXX escapes and MTEXT formatting.

const SPECIAL = { c: '\u2300', d: '\u00b0', p: '\u00b1', '%': '%' };

export function decodeUnicode(s) {
  return s
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\M\+[0-9a-fA-F]([0-9a-fA-F]{4})/g, () => '?');
}

// Some DWG strings come out of the parser with their UTF-16 bytes swapped
// (each char holds two ASCII bytes). Detect and repair that.
export function repairByteSwapped(s) {
  if (!s || s.length === 0) return s;
  let suspicious = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const lo = c & 0xff, hi = c >> 8;
    if (c > 0xff && lo >= 0x20 && lo < 0x7f && (hi === 0 || (hi >= 0x20 && hi < 0x7f))) suspicious++;
    else return s;
  }
  if (!suspicious) return s;
  let r = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    r += String.fromCharCode(c & 0xff);
    if (c >> 8) r += String.fromCharCode(c >> 8);
  }
  return r;
}

export function plainText(s) {
  if (!s) return '';
  s = decodeUnicode(String(s));
  return s.replace(/%%(\d{3}|[cdpCDP%]|[uUoOkK])/g, (m, code) => {
    if (/^\d{3}$/.test(code)) return String.fromCharCode(parseInt(code, 10));
    const k = code.toLowerCase();
    if (k === 'u' || k === 'o' || k === 'k') return '';
    return SPECIAL[k] || '';
  });
}

// Strip MTEXT formatting; returns array of paragraph strings.
export function mtextLines(raw) {
  if (!raw) return [''];
  let s = decodeUnicode(String(raw));
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      const n = s[i + 1];
      if (n === undefined) { i++; continue; }
      switch (n) {
        case 'P': out += '\n'; i += 2; break;
        case 'X': out += '\n'; i += 2; break;
        case '~': out += '\u00a0'; i += 2; break;
        case '\\': case '{': case '}': out += n; i += 2; break;
        case 'L': case 'l': case 'O': case 'o': case 'K': case 'k': case 'N': i += 2; break;
        case 'S': {
          const end = s.indexOf(';', i + 2);
          const body = end < 0 ? s.slice(i + 2) : s.slice(i + 2, end);
          out += body.replace(/[\^#]/, '/').replace(/\^/g, '');
          i = end < 0 ? s.length : end + 1;
          break;
        }
        case 'f': case 'F': case 'H': case 'h': case 'W': case 'w': case 'Q': case 'q':
        case 'T': case 't': case 'A': case 'a': case 'C': case 'c': case 'p':
        default: {
          if (/[A-Za-z]/.test(n)) {
            const end = s.indexOf(';', i + 2);
            // codes without terminating ';' just swallow the letter
            i = end < 0 ? i + 2 : end + 1;
          } else { out += n; i += 2; }
        }
      }
    } else if (ch === '{' || ch === '}') {
      i++;
    } else if (ch === '^' && s[i + 1] === 'I') {
      out += '    '; i += 2;
    } else if (ch === '^' && s[i + 1] === 'J') {
      out += '\n'; i += 2;
    } else if (ch === '\n') {
      out += '\n'; i++;
    } else {
      out += ch; i++;
    }
  }
  return plainText(out).split('\n');
}

// Rich MTEXT parsing: returns lines of runs [{ t, c, h, b, i }] where c is an
// ACI index (number) or rgb ('#rrggbb'), h a height factor relative to the base height.
export function mtextRuns(raw, baseHeight = 1) {
  const lines = [[]];
  if (!raw) return lines;
  const s = decodeUnicode(String(raw));
  const stack = [];
  let st = { c: null, h: 1, b: false, i: false };
  let buf = '';
  const flush = () => {
    if (!buf) return;
    lines[lines.length - 1].push({ t: plainText(buf), c: st.c, h: st.h, b: st.b, i: st.i });
    buf = '';
  };
  const readArg = (from) => {
    const end = s.indexOf(';', from);
    return end < 0 ? [s.slice(from), s.length] : [s.slice(from, end), end + 1];
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      const n = s[i + 1];
      if (n === undefined) { i++; continue; }
      if (n === 'P' || n === 'X') { flush(); lines.push([]); i += 2; continue; }
      if (n === '~') { buf += ' '; i += 2; continue; }
      if (n === '\\' || n === '{' || n === '}') { buf += n; i += 2; continue; }
      if ('LlOoKkN'.includes(n)) { i += 2; continue; }
      if (n === 'S') {
        const [arg, next] = readArg(i + 2);
        buf += arg.replace(/[\^#]/, '/').replace(/\^/g, '');
        i = next; continue;
      }
      if (n === 'C' || n === 'c') {
        const [arg, next] = readArg(i + 2);
        flush();
        const v = parseInt(arg, 10);
        if (n === 'C') st = { ...st, c: v === 256 || v === 0 || isNaN(v) ? null : v };
        else st = { ...st, c: '#' + (v & 0xffffff).toString(16).padStart(6, '0') };
        i = next; continue;
      }
      if (n === 'H') {
        const [arg, next] = readArg(i + 2);
        flush();
        const rel = /x$/i.test(arg);
        const v = parseFloat(arg);
        if (v > 0) st = { ...st, h: rel ? st.h * v : v / (baseHeight || 1) };
        i = next; continue;
      }
      if (n === 'f' || n === 'F') {
        const [arg, next] = readArg(i + 2);
        flush();
        st = { ...st, b: /\|b1/i.test(arg), i: /\|i1/i.test(arg) };
        i = next; continue;
      }
      if (/[A-Za-z]/.test(n)) { i = readArg(i + 2)[1]; continue; }
      buf += n; i += 2; continue;
    }
    if (ch === '{') { flush(); stack.push(st); i++; continue; }
    if (ch === '}') { flush(); st = stack.pop() || st; i++; continue; }
    if (ch === '^' && s[i + 1] === 'I') { buf += '    '; i += 2; continue; }
    if (ch === '^' && s[i + 1] === 'J') { flush(); lines.push([]); i += 2; continue; }
    if (ch === '\n') { flush(); lines.push([]); i++; continue; }
    buf += ch; i++;
  }
  flush();
  return lines;
}

export function runsArePlain(lines) {
  for (const l of lines) for (const r of l) if (r.c !== null || r.h !== 1 || r.b || r.i) return false;
  return true;
}
