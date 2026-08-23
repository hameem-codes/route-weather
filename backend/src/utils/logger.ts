type LogLevel = 'info' | 'warn' | 'error';

interface LogPayload {
  level: LogLevel;
  message: string;
  route?: string;
  durationMs?: number;
  errorCode?: string;
  [key: string]: any;
}

const formatLog = (payload: LogPayload) => {
  const timestamp = new Date().toISOString();
  return JSON.stringify({ timestamp, ...payload });
};

export const logger = {
  info: (message: string, context?: Omit<LogPayload, 'level' | 'message'>) => {
    console.log(formatLog({ level: 'info', message, ...context }));
  },
  warn: (message: string, context?: Omit<LogPayload, 'level' | 'message'>) => {
    console.warn(formatLog({ level: 'warn', message, ...context }));
  },
  error: (message: string, context?: Omit<LogPayload, 'level' | 'message'>) => {
    console.error(formatLog({ level: 'error', message, ...context }));
  }
};
