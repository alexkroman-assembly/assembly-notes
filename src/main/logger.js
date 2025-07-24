import log from 'electron-log/main.js';
import { app } from 'electron';
import path from 'path';

// Configure file logging
log.transports.file.resolvePathFn = () => {
  const logsPath = path.join(app.getPath('userData'), 'logs', 'main.log');
  return logsPath;
};

// Set log level (error, warn, info, verbose, debug, silly)
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// Format logs
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

// Catch errors
log.errorHandler.startCatching();

// Initialize renderer logging
log.initialize();

export default log;
