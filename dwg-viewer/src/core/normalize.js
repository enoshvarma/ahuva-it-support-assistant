// Normalises the output of the DWG reader (libredwg-web) and the DXF reader
// (dxf-json) into one document model used by the display-list builder.

import { aciToRgb, DWG_LINEWEIGHTS } from './aci.js';
import { repairByteSwapped } from './text.js';

const D2R = Math.PI / 180;

function lowerMap(entries, fn) {
  const m = new Map();
  for (const e of entries || []) if (e && e.name != null) m.set(String(e.name).toLowerCase(), fn(e));
  return m;
}

function dwgLineweight(v) {
  if (v === undefined || v === null) return -1;
  if (v === 29) return -1; // ByLayer
  if (v === 30) return -2; // ByBlock
  if (v === 31) return -3; // Default
  if (v >= 0 && v < DWG_LINEWEIGHTS.length) return DWG_LINEWEIGHTS[v];
  return -3;
}

function layerColor(l) {
  const ci = l.colorIndex;
  if (typeof ci === 'number' && Math.abs(ci) >= 1 && Math.abs(ci) <= 255) return { rgb: aciToRgb(Math.abs(ci)), aci: Math.abs(ci) };
  if (typeof l.color === 'number' && l.color >= 0 && l.color <= 0xffffff && !(l.color === 0xffffff && ci === 256)) return { rgb: l.color, aci: 0 };
  return { rgb: -1, aci: 7 };
}

function buildCommon(db, source) {
  const header = {};
  for (const [k, v] of Object.entries(db.header || {})) header[k.replace(/^\$/, '')] = v;

  const layerEntries = db.tables?.LAYER?.entries || [];
  const layers = layerEntries.map((l) => {
    const { rgb, aci } = layerColor(l);
    const frozen = source === 'dxf' ? !!((l.standardFlag || 0) & 1) || !!l.frozen : !!l.frozen;
    const off = !!l.off || (typeof l.colorIndex === 'number' && l.colorIndex < 0);
    return {
      name: String(l.name ?? ''),
      color: rgb,
      aci,
      frozen,
      off,
      ltype: l.lineType || 'Continuous',
      lw: source === 'dwg' ? dwgLineweight(l.lineweight) : (l.lineweight ?? -3),
      plot: l.plotFlag !== 0 && l.isPlotting !== false,
    };
  });

  const ltypes = lowerMap(db.tables?.LTYPE?.entries, (t) => {
    const pattern = (t.pattern || []).map((p) => (typeof p === 'number' ? p : p.elementLength || 0));
    return { name: t.name, pattern, description: t.description || '' };
  });

  const styles = lowerMap(db.tables?.STYLE?.entries, (s) => ({
    font: s.font || '',
    bigFont: s.bigFont || '',
    extendedFont: s.extendedFont || '',
    widthFactor: s.widthFactor || 1,
    oblique: (s.obliqueAngle || 0) * (source === 'dxf' ? D2R : 1),
    fixedHeight: s.fixedTextHeight || 0,
  }));

  const dimstyles = lowerMap(db.tables?.DIMSTYLE?.entries, (d) => d);

  return { header, layers, ltypes, styles, dimstyles };
}

// ---------------------------------------------------------------------------
// DWG (libredwg-web DwgDatabase)

function fixDwgEntity(e) {
  if (!e || typeof e !== 'object') return e;
  e.lineweight = dwgLineweight(e.lineweight);
  if (e.type === 'MULTILEADER' && typeof e.textContent === 'string') e.textContent = repairByteSwapped(e.textContent);
  if (e.type === 'LWPOLYLINE') {
    // DWG flag bits differ from DXF: 512 = closed, 256 = plinegen
    const f = e.flag || 0;
    e.flag = (f & 512 ? 1 : 0) | (f & 256 ? 128 : 0);
  }
  if (e.type === 'INSERT' && Array.isArray(e.attribs)) e.attribs.forEach(fixDwgEntity);
  return e;
}

export function normalizeDwg(db) {
  const common = buildCommon(db, 'dwg');
  const blocks = new Map();
  const blockByHandle = new Map();
  let model = null;
  const paper = new Map(); // handle -> entities
  for (const br of db.tables?.BLOCK_RECORD?.entries || []) {
    const ents = (br.entities || []).map(fixDwgEntity);
    const blk = { name: br.name, handle: br.handle, base: br.basePoint || { x: 0, y: 0, z: 0 }, flags: br.flags || 0, entities: ents };
    blocks.set(br.name, blk);
    blockByHandle.set(br.handle, blk);
    const lname = String(br.name).toLowerCase();
    if (lname === '*model_space') model = blk;
    else if (lname.startsWith('*paper_space')) paper.set(br.handle, blk);
  }
  if (!model) {
    model = { name: '*Model_Space', handle: '', base: { x: 0, y: 0, z: 0 }, flags: 0, entities: (db.entities || []).map(fixDwgEntity) };
  }

  const layouts = [];
  for (const lo of db.objects?.LAYOUT || []) {
    const blk = blockByHandle.get(lo.paperSpaceTableId);
    if (!blk || blk === model) continue;
    layouts.push({ name: lo.layoutName, tabOrder: lo.tabOrder ?? layouts.length + 1, block: blk, limMin: lo.minLimit, limMax: lo.maxLimit, extMin: lo.minExtent, extMax: lo.maxExtent });
  }
  layouts.sort((a, b) => a.tabOrder - b.tabOrder);
  return { source: 'dwg', ...common, blocks, blockByHandle, model, layouts };
}

// ---------------------------------------------------------------------------
// DXF (dxf-json)

function textFromFlat(e) {
  return {
    text: e.text ?? '',
    startPoint: e.startPoint || { x: 0, y: 0 },
    endPoint: e.alignmentPoint || e.endPoint,
    textHeight: e.textHeight ?? 2.5,
    rotation: (e.rotation || 0) * D2R,
    xScale: e.scale ?? e.xScale ?? 1,
    obliqueAngle: (e.obliqueAngle || 0) * D2R,
    styleName: e.textStyle || e.styleName || 'Standard',
    generationFlag: e.textGenerationFlag ?? e.generationFlag ?? 0,
    halign: e.horizontalJustification ?? e.halign ?? 0,
    valign: e.verticalJustification ?? e.valign ?? 0,
    extrusionDirection: e.extrusionDirection,
  };
}

function fixDxfEntity(e) {
  if (!e || typeof e !== 'object') return e;
  switch (e.type) {
    case 'ARC':
      e.startAngle = (e.startAngle || 0) * D2R;
      e.endAngle = (e.endAngle ?? 360) * D2R;
      break;
    case 'TEXT':
      e.rotation = (e.rotation || 0) * D2R;
      e.obliqueAngle = (e.obliqueAngle || 0) * D2R;
      e.xScale = e.xScale ?? 1;
      break;
    case 'MTEXT':
      e.textHeight = e.height ?? e.textHeight;
      e.rectWidth = e.width ?? e.rectWidth;
      e.rotation = (e.rotation || 0) * D2R;
      break;
    case 'INSERT':
      e.xScale = e.xScale ?? 1; e.yScale = e.yScale ?? 1; e.zScale = e.zScale ?? 1;
      e.rotation = (e.rotation || 0) * D2R;
      e.attribs = e.attribs || [];
      break;
    case 'ATTRIB':
    case 'ATTDEF':
      e.flags = e.attributeFlag ?? e.flags ?? 0;
      e.text = textFromFlat(e);
      break;
    case 'SOLID':
    case 'TRACE':
    case '3DFACE': {
      const p = e.points || e.vertices || [];
      e.corner1 = p[0]; e.corner2 = p[1]; e.corner3 = p[2]; e.corner4 = p[3];
      if (e.type === '3DFACE') e.flag = e.invisibleEdgeFlags || 0;
      break;
    }
    case 'XLINE':
    case 'RAY':
      e.firstPoint = e.position || e.firstPoint;
      e.unitDirection = e.direction || e.unitDirection;
      break;
    case 'HATCH':
      for (const d of e.definitionLines || []) d.angle = (d.angle || 0) * D2R;
      for (const bp of e.boundaryPaths || []) {
        for (const ed of bp.edges || []) {
          if (ed.type === 2 || ed.type === 3) {
            ed.startAngle = (ed.startAngle || 0) * D2R;
            ed.endAngle = (ed.endAngle || 0) * D2R;
          }
        }
      }
      break;
    case 'WIPEOUT':
      e.uPixel = e.uDirection || e.uPixel;
      e.vPixel = e.vDirection || e.vPixel;
      e.clippingBoundaryPath = e.boundary || e.clippingBoundaryPath;
      break;
    case 'DIMENSION':
      break;
    case 'TOLERANCE':
      e.insertionPoint = e.position || e.insertionPoint;
      break;
    case 'MLINE':
      if (!e.vertices && Array.isArray(e.segments)) {
        e.vertices = e.segments.map((sg) => ({
          vertex: sg.position, vertexDirection: sg.direction, miterDirection: sg.miterDirection,
          lines: (sg.elements || []).map((el) => ({ segmentParams: el.parameters || [] })),
        }));
        e.numberOfLines = e.styleCount || (e.vertices[0] ? e.vertices[0].lines.length : 0);
      }
      break;
    default:
  }
  return e;
}

// Attach ATTRIB entities (which follow their INSERT in DXF) to the insert.
function attachAttribs(list) {
  const out = [];
  let lastInsert = null;
  for (const raw of list || []) {
    const e = fixDxfEntity(raw);
    if (e.type === 'ATTRIB') {
      if (lastInsert) lastInsert.attribs.push(e);
      continue;
    }
    if (e.type === 'SEQEND') continue;
    if (e.type === 'INSERT') lastInsert = e; else lastInsert = null;
    out.push(e);
  }
  return out;
}

export function normalizeDxf(db) {
  const common = buildCommon(db, 'dxf');
  const blocks = new Map();
  const blockByHandle = new Map();
  const brByName = new Map();
  for (const br of db.tables?.BLOCK_RECORD?.entries || []) brByName.set(br.name, br);
  for (const [name, b] of Object.entries(db.blocks || {})) {
    const br = brByName.get(name);
    const blk = { name, handle: br?.handle || b.ownerHandle || '', base: b.position || { x: 0, y: 0, z: 0 }, flags: b.type || 0, entities: attachAttribs(b.entities) };
    blocks.set(name, blk);
    if (blk.handle) blockByHandle.set(blk.handle, blk);
  }

  // DXF stores model-space and active paper-space entities in the ENTITIES section
  const topLevel = attachAttribs(db.entities);
  let modelBlk = [...blocks.values()].find((b) => b.name.toLowerCase() === '*model_space');
  const modelHandle = modelBlk?.handle;
  const psActive = [...blocks.values()].find((b) => b.name.toLowerCase() === '*paper_space');
  const modelEnts = [];
  const paperEnts = [];
  for (const e of topLevel) {
    if (e.isInPaperSpace || (psActive && e.ownerBlockRecordSoftId === psActive.handle && e.ownerBlockRecordSoftId !== modelHandle)) paperEnts.push(e);
    else modelEnts.push(e);
  }
  if (!modelBlk) { modelBlk = { name: '*Model_Space', handle: '', base: { x: 0, y: 0, z: 0 }, flags: 0, entities: [] }; }
  modelBlk.entities = modelEnts.length ? modelEnts : modelBlk.entities;
  if (psActive && paperEnts.length) psActive.entities = paperEnts;

  const layouts = [];
  for (const lo of db.objects?.byName?.LAYOUT || []) {
    const blk = blockByHandle.get(lo.paperSpaceTableId);
    if (!blk || blk === modelBlk) continue;
    layouts.push({ name: lo.layoutName, tabOrder: lo.tabOrder ?? layouts.length + 1, block: blk, limMin: lo.minLimit, limMax: lo.maxLimit, extMin: lo.minExtent, extMax: lo.maxExtent });
  }
  layouts.sort((a, b) => a.tabOrder - b.tabOrder);
  return { source: 'dxf', ...common, blocks, blockByHandle, model: modelBlk, layouts };
}
