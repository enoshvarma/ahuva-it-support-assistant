// DWG Viewer desktop shell (Windows / macOS / Linux).
const { app, BrowserWindow, dialog, ipcMain, Menu, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const WWW = path.join(__dirname, '..', 'www');

// AppImages cannot ship a setuid sandbox helper, and Ubuntu 24.04+ blocks the
// user-namespace sandbox for unconfined apps; without this the app would not start.
if (process.platform === 'linux' && process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox');
let win = null;
let pageReady = false;
const pendingFiles = [];

// Serve the app from a privileged custom scheme so workers, wasm and storage behave like a website.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function isDrawing(p) { return typeof p === 'string' && /\.(dwg|dxf)$/i.test(p) && fs.existsSync(p); }

function sendFile(p) {
  if (!isDrawing(p)) return;
  if (!win || !pageReady) { pendingFiles.push(p); return; }
  try {
    const data = fs.readFileSync(p);
    win.webContents.send('open-file', path.basename(p), new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (win.isMinimized()) win.restore();
    win.focus();
  } catch (e) {
    dialog.showErrorBox('DWG Viewer', 'Could not read ' + p + '\n' + e.message);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 420,
    minHeight: 480,
    backgroundColor: '#0b1220',
    title: 'DWG Viewer',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.loadURL('app://dwg-viewer/index.html');
  win.webContents.on('did-start-loading', () => { pageReady = false; });
  win.webContents.on('did-finish-load', () => { pageReady = true; while (pendingFiles.length) sendFile(pendingFiles.shift()); });
  // open external links in the browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
}

const single = app.requestSingleInstanceLock();
if (!single) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = argv.find(isDrawing);
    if (f) sendFile(f);
    else if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  // macOS: double-clicked files arrive through open-file (also before ready)
  app.on('open-file', (e, p) => { e.preventDefault(); sendFile(p); });

  app.whenReady().then(() => {
    protocol.handle('app', (req) => {
      const { pathname } = new URL(req.url);
      const file = path.normalize(path.join(WWW, decodeURIComponent(pathname)));
      if (!file.startsWith(WWW)) return new Response('forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    ipcMain.handle('save-file', async (_e, name, bytes) => {
      const ext = path.extname(name).slice(1).toLowerCase();
      const r = await dialog.showSaveDialog(win, {
        defaultPath: path.join(app.getPath('documents'), name),
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (r.canceled || !r.filePath) return false;
      fs.writeFileSync(r.filePath, Buffer.from(bytes));
      return true;
    });
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: 'appMenu' },
        { label: 'File', submenu: [{ label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => win && win.webContents.executeJavaScript("document.getElementById('file-input').click()") }, { role: 'close' }] },
        { role: 'editMenu' },
        { role: 'windowMenu' },
      ]));
    } else {
      Menu.setApplicationMenu(null);
    }
    createWindow();
    const f = process.argv.slice(1).find(isDrawing);
    if (f) pendingFiles.push(f);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
