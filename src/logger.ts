export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Minimal logger interface; compatible with console, pino, winston and similar. */
export interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** Logs to the console, dropping messages below `minLevel`. */
export function createConsoleLogger(minLevel: LogLevel = 'info', prefix = '[sse-to-mqtt]'): Logger {
  const enabled = (level: LogLevel): boolean => LEVELS.indexOf(level) >= LEVELS.indexOf(minLevel);
  const log = (level: LogLevel) => (message: string, ...meta: unknown[]): void => {
    if (enabled(level)) console[level](prefix ? `${prefix} ${message}` : message, ...meta);
  };

  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

/** Discards all messages. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

/** Logger used when none is passed in options. */
export const defaultLogger: Logger = createConsoleLogger('debug', '');
