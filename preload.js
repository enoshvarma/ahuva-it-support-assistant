// Preload: exposes a minimal, typed API to the renderer via contextBridge.
// No Node APIs are exposed directly — only specific IPC channels.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ahuva", {
  // Settings
  getSettings:    ()    => ipcRenderer.invoke("settings:get"),
  saveSettings:   s     => ipcRenderer.invoke("settings:save", s),
  testAI:         ()    => ipcRenderer.invoke("ai:test"),
  modelPresets:   p     => ipcRenderer.invoke("models:presets", p),

  // Serial ports
  listSerialPorts: ()   => ipcRenderer.invoke("serial:list"),

  // Device session
  connect:         cfg  => ipcRenderer.invoke("session:connect", cfg),
  disconnect:      ()   => ipcRenderer.invoke("session:disconnect"),
  write:           data => ipcRenderer.invoke("session:write", data),
  sendCommand:     cmd  => ipcRenderer.invoke("session:sendCommand", cmd),

  // Safety / mode
  classify:        cmd  => ipcRenderer.invoke("safety:classify", cmd),
  detectMode:      buf  => ipcRenderer.invoke("mode:detect", buf),
  prepFor:         (mode, cmd) => ipcRenderer.invoke("mode:prep", { mode, cmd }),

  // Device fingerprinting & discovery
  fingerprint:     text  => ipcRenderer.invoke("device:fingerprint", text),
  probes:          ()    => ipcRenderer.invoke("device:probes"),
  arpCmds:         brand => ipcRenderer.invoke("device:arpCmds", brand),
  parsePing:       text  => ipcRenderer.invoke("device:parsePing", text),

  // Backup / restore
  storeRestorePoint: p   => ipcRenderer.invoke("backup:store", p),
  getRestorePoint:   ()  => ipcRenderer.invoke("backup:getRestorePoint"),
  saveBackup:        p   => ipcRenderer.invoke("backup:save", p),

  // Error logging
  scanErrors:   text => ipcRenderer.invoke("errors:scan", text),
  recordError:  info => ipcRenderer.invoke("errors:record", info),

  // Packet capture
  pktCheck:      ()                  => ipcRenderer.invoke("pkt:check"),
  pktIfaces:     ()                  => ipcRenderer.invoke("pkt:ifaces"),
  pktDeviceCmds: p                   => ipcRenderer.invoke("pkt:deviceCmds", p),
  pktCapture:    o                   => ipcRenderer.invoke("pkt:capture", o),
  pktExport:     (result, fmt)       => ipcRenderer.invoke("pkt:export", { captureResult: result, format: fmt }),

  // AI
  askAI: payload => ipcRenderer.invoke("ai:ask", payload),

  // Knowledge base
  kbInfo:   ()  => ipcRenderer.invoke("kb:info"),
  kbImport: ()  => ipcRenderer.invoke("kb:import"),

  // Research
  researchInfo:       ()       => ipcRenderer.invoke("research:info"),
  researchRun:        p        => ipcRenderer.invoke("research:run", p),
  researchRead:       f        => ipcRenderer.invoke("research:read", f),
  researchSetEnabled: on       => ipcRenderer.invoke("research:setEnabled", on),
  researchSetSources: s        => ipcRenderer.invoke("research:setSources", s),
  researchOpenFolder: ()       => ipcRenderer.invoke("research:openFolder"),

  // Session events (renderer side)
  onSessionData:   cb => ipcRenderer.on("session:data",   (_e, d) => cb(d)),
  onSessionClosed: cb => ipcRenderer.on("session:closed", (_e, r) => cb(r)),
  onSessionError:  cb => ipcRenderer.on("session:error",  (_e, m) => cb(m)),
  onResearchDue:   cb => ipcRenderer.on("research:due",   ()      => cb())
});
