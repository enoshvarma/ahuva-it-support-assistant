// Entry point for esbuild — bundles pure-logic src/ modules for browser use.
// The bundled output attaches to window.AhuvaModules.

window.AhuvaModules = {
  safety:       require("../src/safety"),
  mode:         require("../src/mode"),
  detect:       require("../src/detect"),
  validate:     require("../src/validate"),
  models:       require("../src/models"),
  switchConfig: require("../src/switch-config"),
  prompt:       require("../src/prompt"),
  pcapAnalyser: require("../src/pcap-analyser"),
};
