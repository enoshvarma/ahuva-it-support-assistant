// Stand-in for Node built-ins inside the Android WebView bundle. Only pure helpers of the
// bundled modules are called on Android, so these are never exercised at runtime.
function unavailable() { throw new Error("Not available on Android"); }
module.exports = {
  promises: {},
  existsSync: () => false,
  readdirSync: () => [],
  mkdirSync: () => {},
  readFileSync: unavailable,
  writeFileSync: unavailable,
  appendFileSync: unavailable,
  createWriteStream: unavailable,
  join: (...p) => p.join("/"),
  basename: p => String(p).split("/").pop(),
  platform: () => "android",
  tmpdir: () => "/tmp",
  homedir: () => "/",
  hostname: () => "android",
  networkInterfaces: () => ({}),
  spawn: unavailable,
  execFile: unavailable,
  execSync: unavailable,
  createSocket: unavailable,
  Socket: unavailable,
  get: unavailable,
};
