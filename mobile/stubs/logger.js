const noop = () => {};
const log = { debug: noop, info: noop, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
module.exports = { child: () => log, initFileLogging: noop, logFilePath: () => null };
