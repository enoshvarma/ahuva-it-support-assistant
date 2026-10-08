// File-format detection and parsing (DWG via libredwg-web, DXF via dxf-json).
import { LibreDwg, Dwg_File_Type, Dwg_Object_Type as T } from '@mlightcad/libredwg-web';
import { DxfParser } from '@mlightcad/dxf-json';
import { normalizeDwg, normalizeDxf } from './normalize.js';

const DWG_VERSIONS = {
  AC1012: 'AutoCAD R13', AC1014: 'AutoCAD R14', AC1015: 'AutoCAD 2000', AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018',
  AC1009: 'AutoCAD R11/R12', AC1006: 'AutoCAD R10', AC1004: 'AutoCAD R9', AC2_10: 'AutoCAD 2.x',
};

export function detectFormat(bytes) {
  const head = String.fromCharCode(...bytes.subarray(0, 22));
  if (/^AC\d{4}/.test(head) || head.startsWith('AC2.')) return { format: 'dwg', version: DWG_VERSIONS[head.slice(0, 6)] || head.slice(0, 6) };
  if (head.startsWith('AutoCAD Binary DXF')) return { format: 'dxfb', version: 'Binary DXF' };
  // ASCII DXF: first non-empty lines are "0" and "SECTION" (or a comment "999")
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, 512));
  if (/^\s*(0|999)\s*\r?\n/.test(text)) return { format: 'dxf', version: 'DXF' };
  return { format: 'unknown', version: '' };
}

const CODEPAGES = {
  ANSI_874: 'windows-874', ANSI_932: 'shift_jis', ANSI_936: 'gbk', ANSI_949: 'euc-kr', ANSI_950: 'big5',
  ANSI_1250: 'windows-1250', ANSI_1251: 'windows-1251', ANSI_1252: 'windows-1252', ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254', ANSI_1255: 'windows-1255', ANSI_1256: 'windows-1256', ANSI_1257: 'windows-1257', ANSI_1258: 'windows-1258',
};

export function decodeDxfText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    const latin = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 20000)));
    const m = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/i.exec(latin);
    const enc = (m && CODEPAGES[m[1].toUpperCase()]) || 'windows-1252';
    try { return new TextDecoder(enc).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
  }
}

// dxf-json overwrites the MLEADER context text height (group 41) with group 44;
// recover it from the raw text.
function patchMleaderHeights(text, db) {
  const need = (db.entities || []).concat(...Object.values(db.blocks || {}).map((b) => b.entities || []))
    .filter((e) => e && e.type === 'MULTILEADER' && !(e.textHeight > 0));
  if (!need.length) return;
  const byHandle = new Map(need.map((e) => [String(e.handle).toUpperCase(), e]));
  const re = /\n\s*0\r?\nMULTILEADER\r?\n\s*5\r?\n([0-9A-Fa-f]+)\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const e = byHandle.get(m[1].toUpperCase());
    if (!e) continue;
    const start = text.indexOf('CONTEXT_DATA{', m.index);
    if (start < 0) continue;
    const lines = text.slice(start, start + 4000).split(/\r?\n/);
    for (let i = 1; i + 1 < lines.length; i += 2) {
      const code = lines[i].trim();
      if (code === '41') { const v = parseFloat(lines[i + 1]); if (v > 0) e.textHeight = v; break; }
      if (code === '301' || code === '302') break;
    }
  }
}

// Entities that libredwg-web does not convert (polyface / polygon meshes and arc
// dimensions) are read straight from the decoder.
function hex(v) {
  if (v === undefined || v === null) return '';
  return (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v)))).toString(16).toUpperCase();
}

function recoverDwgEntities(lib, data, db) {
  const layerByHandle = new Map((db.tables?.LAYER?.entries || []).map((l) => [String(l.handle).toUpperCase(), l.name]));
  const modelHandle = (db.tables?.BLOCK_RECORD?.entries || []).find((b) => /^\*model_space$/i.test(b.name))?.handle;
  const n = lib.dwg_get_num_objects(data);
  const owners = new Map(); // polyline handle -> { kind, attrs, verts, faces }
  const result = [];
  const sat = new Map(); // handle -> ACIS text
  const common = (obj, ent) => {
    const lay = lib.dwg_object_entity_get_layer_object_ref(ent);
    const col = lib.dwg_object_entity_get_color_object(ent) || {};
    const own = lib.dwg_object_entity_get_ownerhandle_object(ent);
    const handle = hex(lib.dwg_object_get_handle_object(obj).value);
    let entmode = 2;
    try { entmode = lib.dwg_dynapi_common_value(ent, 'entmode').data; } catch { /* ignore */ }
    const method = col.method || ((col.rgb >>> 24) & 0xff);
    const ownHex = hex(own && own.absolute_ref);
    if (!ownHex || ownHex === '0') entmode = 2;
    return {
      handle,
      layer: layerByHandle.get(hex(lay && lay.handleref && lay.handleref.value)) || '0',
      colorIndex: col.index === undefined ? 256 : col.index,
      color: method === 0xc2 ? col.rgb & 0xffffff : undefined,
      lineweight: 29,
      owner: entmode === 2 ? 'model' : hex(own && own.absolute_ref),
      ownerBlockRecordSoftId: entmode === 2 ? modelHandle : hex(own && own.absolute_ref),
    };
  };
  for (let i = 0; i < n; i++) {
    const obj = lib.dwg_get_object(data, i);
    if (!obj) continue;
    const ft = lib.dwg_object_get_fixedtype(obj);
    if (ft === T.DWG_TYPE_3DSOLID || ft === T.DWG_TYPE_REGION || ft === T.DWG_TYPE_BODY) {
      // keep the ACIS text so the builder can draw a wireframe
      try {
        const tio = lib.dwg_object_to_entity_tio(obj);
        const ptr = tio && lib.dwg_dynapi_entity_data(tio, 'acis_data');
        const w = lib.wasmInstance;
        if (ptr && w && w.HEAPU8) {
          const heap = w.HEAPU8;
          let end = ptr;
          while (end < heap.length && heap[end] !== 0 && end - ptr < 64 * 1024 * 1024) end++;
          const text = new TextDecoder('latin1').decode(heap.subarray(ptr, end));
          if (text.length > 20) {
            sat.set(hex(lib.dwg_object_get_handle_object(obj).value), text);
            // libredwg-web only converts 3DSOLID; regions and bodies are added here
            if (ft !== T.DWG_TYPE_3DSOLID) {
              const ent = lib.dwg_object_to_entity(obj);
              const c = common(obj, ent);
              result.push({ owner: c.owner, entity: { ...c, type: ft === T.DWG_TYPE_REGION ? 'REGION' : 'BODY', satText: text } });
            }
          }
        }
      } catch { /* ignore */ }
      continue;
    }
    if (ft !== T.DWG_TYPE_POLYLINE_PFACE && ft !== T.DWG_TYPE_POLYLINE_MESH && ft !== T.DWG_TYPE_VERTEX_PFACE &&
        ft !== T.DWG_TYPE_VERTEX_PFACE_FACE && ft !== T.DWG_TYPE_VERTEX_MESH && ft !== T.DWG_TYPE_ARC_DIMENSION) continue;
    const ent = lib.dwg_object_to_entity(obj);
    const tio = lib.dwg_object_to_entity_tio(obj);
    if (!ent || !tio) continue;
    const c = common(obj, ent);
    if (ft === T.DWG_TYPE_POLYLINE_PFACE || ft === T.DWG_TYPE_POLYLINE_MESH) {
      const rec = { ...c, type: 'POLYLINE', vertices: [], flag: ft === T.DWG_TYPE_POLYLINE_PFACE ? 64 : 16 };
      if (ft === T.DWG_TYPE_POLYLINE_MESH) {
        const f = lib.dwg_dynapi_entity_data(tio, 'flag') || 0;
        rec.flag = 16 | (f & 1) | (f & 32);
        rec.meshMVertexCount = lib.dwg_dynapi_entity_data(tio, 'num_m_verts') || 0;
        rec.meshNVertexCount = lib.dwg_dynapi_entity_data(tio, 'num_n_verts') || 0;
      }
      owners.set(c.handle, rec);
      result.push({ owner: c.owner, entity: rec });
    } else if (ft === T.DWG_TYPE_VERTEX_PFACE || ft === T.DWG_TYPE_VERTEX_MESH) {
      const own = lib.dwg_object_entity_get_ownerhandle_object(ent);
      const rec = owners.get(hex(own && own.absolute_ref));
      const p = lib.dwg_dynapi_entity_data(tio, 'point');
      if (rec && p) rec.vertices.push({ x: p.x, y: p.y, z: p.z || 0, flag: ft === T.DWG_TYPE_VERTEX_PFACE ? 192 : 64 });
    } else if (ft === T.DWG_TYPE_VERTEX_PFACE_FACE) {
      const own = lib.dwg_object_entity_get_ownerhandle_object(ent);
      const rec = owners.get(hex(own && own.absolute_ref));
      // vertind[4] (int16) follows the parent pointer and the flag byte
      const idx = lib.dwg_ptr_to_int16_t_array(tio + 6, 4);
      if (rec && idx && idx.every((k) => Math.abs(k) <= 32767)) rec.vertices.push({ x: 0, y: 0, z: 0, flag: 128, faces: idx.filter((k) => k !== 0) });
    } else if (ft === T.DWG_TYPE_ARC_DIMENSION) {
      const ref = lib.dwg_dynapi_entity_data(tio, 'block');
      const bh = ref ? hex(lib.dwg_ref_get_absref(ref)) : '';
      const blk = (db.tables?.BLOCK_RECORD?.entries || []).find((b) => String(b.handle).toUpperCase() === bh);
      if (blk) result.push({ owner: c.owner, entity: { ...c, type: 'DIMENSION', name: blk.name } });
    }
  }
  // drop face indices that point outside the vertex list
  for (const rec of owners.values()) {
    const nv = rec.vertices.filter((v) => !v.faces).length;
    rec.vertices = rec.vertices.filter((v) => !v.faces || v.faces.every((k) => Math.abs(k) <= nv));
  }
  result.sat = sat;
  return result;
}

// libredwg keeps global state that is not fully reset by dwg_free(), so every
// drawing gets a fresh WebAssembly instance (the compiled module is cached by the engine).
export function getLibreDwg(wasmDir) {
  LibreDwg.instance = null;
  return LibreDwg.create(wasmDir);
}

export async function parseDrawing(buffer, { wasmDir } = {}) {
  const bytes = new Uint8Array(buffer);
  const { format, version } = detectFormat(bytes);
  if (format === 'dwg') {
    const lib = await getLibreDwg(wasmDir);
    let ptr;
    let readError = 0;
    try {
      const w = lib.wasmInstance;
      if (w && w.FS && w.dwg_read_file) {
        // same as dwg_read_data, but keeps the error code
        w.FS.writeFile('in.dwg', bytes);
        const r = w.dwg_read_file('in.dwg');
        try { w.FS.unlink('in.dwg'); } catch { /* ignore */ }
        if (r.error & 8192) throw new Error('out of memory');
        ptr = r.data;
        readError = r.error || 0;
      } else {
        ptr = lib.dwg_read_data(buffer, Dwg_File_Type.DWG);
      }
    } catch (e) {
      throw new Error('This DWG file could not be decoded (' + (e && e.message || e) + ').');
    }
    if (!ptr) throw new Error('This DWG file could not be decoded. It may be damaged or use an unsupported version.');
    let db;
    let extra = [];
    try {
      db = lib.convert(ptr);
      try { extra = recoverDwgEntities(lib, ptr, db); } catch (e) { console.warn('recover', e); }
    } finally {
      try { lib.dwg_free(ptr); } catch { /* ignore */ }
    }
    const doc = normalizeDwg(db);
    if (extra.sat && extra.sat.size) {
      const attach = (list) => { for (const e of list) if (e && extra.sat.has(e.handle)) e.satText = extra.sat.get(e.handle); };
      for (const b of doc.blocks.values()) attach(b.entities);
      attach(doc.model.entities);
    }
    for (const { owner, entity } of extra) {
      const blk = owner === 'model' ? doc.model : doc.blockByHandle.get(owner);
      if (blk) blk.entities.push(entity);
    }
    // error codes >= 128 are critical in libredwg (missing sections, invalid file)
    const empty = !doc.model.entities.length && !doc.layouts.some((l) => l.block.entities.length > 1);
    if (readError >= 128 && empty) throw new Error('This DWG file is damaged or uses a format variant that cannot be read (code ' + readError + ').');
    return { doc, format, version, partial: readError >= 128 };
  }
  if (format === 'dxf') {
    const text = decodeDxfText(bytes);
    const db = new DxfParser().parseSync(text);
    patchMleaderHeights(text, db);
    const v = db.header && db.header.$ACADVER;
    return { doc: normalizeDxf(db), format, version: 'DXF ' + (DWG_VERSIONS[v] ? DWG_VERSIONS[v].replace('AutoCAD ', '') : v || '') };
  }
  if (format === 'dxfb') throw new Error('Binary DXF files are not supported yet. Please save the drawing as ASCII DXF or DWG.');
  throw new Error('This file is not a DWG or DXF drawing.');
}
