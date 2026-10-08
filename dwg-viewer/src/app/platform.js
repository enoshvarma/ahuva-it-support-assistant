// Platform glue: Android/iOS (Capacitor), desktop (Electron) and plain web.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
export const desktop = typeof window !== 'undefined' ? window.dwgDesktop || null : null;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Saves (desktop/web) or shares (mobile) an exported file.
export async function saveBlob(blob, filename) {
  if (isNative) {
    const data = await blobToBase64(blob);
    const res = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
    await Share.share({ title: filename, files: [res.uri], dialogTitle: 'Save or share ' + filename });
    return 'shared';
  }
  if (desktop && desktop.saveFile) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const ok = await desktop.saveFile(filename, buf);
    return ok ? 'saved' : 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

async function fetchNativeUrl(url) {
  const src = Capacitor.convertFileSrc(url);
  const r = await fetch(src);
  if (!r.ok) throw new Error('Could not read the shared file (' + r.status + ')');
  return r.arrayBuffer();
}

function nameFromUrl(url) {
  try {
    const u = decodeURIComponent(url);
    const m = /([^/:]+\.(dwg|dxf))(\?|$)/i.exec(u);
    if (m) return m[1];
    const last = u.split('/').pop() || 'drawing.dwg';
    return /\.(dwg|dxf)$/i.test(last) ? last : last + '.dwg';
  } catch { return 'drawing.dwg'; }
}

// Calls onFile(name, arrayBuffer) for files opened from other apps / the OS.
export function onExternalOpen(onFile, onError) {
  if (isNative) {
    const handle = async (url) => {
      if (!url || /^https?:/i.test(url)) return;
      try { onFile(nameFromUrl(url), await fetchNativeUrl(url)); } catch (e) { onError(e); }
    };
    App.addListener('appUrlOpen', (ev) => handle(ev.url));
    App.getLaunchUrl().then((r) => r && handle(r.url)).catch(() => {});
    App.addListener('backButton', () => window.dispatchEvent(new CustomEvent('app-back')));
  }
  if (desktop && desktop.onOpenFile) {
    desktop.onOpenFile((name, data) => onFile(name, data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data));
  }
}

export function exitApp() {
  if (isNative) App.exitApp();
}
