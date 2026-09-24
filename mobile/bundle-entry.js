// esbuild entry: the desktop's own src/ modules, bundled for the Android WebView.
// Node built-ins are replaced by stubs in build-web.js; only pure functions are used from Node-heavy modules.

window.AhuvaModules = {
  safety:       require("../src/safety"),
  mode:         require("../src/mode"),
  detect:       require("../src/detect"),
  validate:     require("../src/validate"),
  models:       require("../src/models"),
  switchConfig: require("../src/switch-config"),
  prompt:       require("../src/prompt"),
  pcapAnalyser: require("../src/pcap-analyser"),
  ai:           require("../src/ai-providers"),
  kb:           require("../src/kb"),
  errorlog:     require("../src/errorlog"),
  research:     require("../src/research"),
  scanner:      require("../src/network-scanner"),
  packets:      require("../src/packets"),
};
