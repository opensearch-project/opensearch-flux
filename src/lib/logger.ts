type LogFn = (msg: string) => void;
let _log: LogFn = console.error;
export function setLogOutput(fn: LogFn) { _log = fn; }
export function log(msg: string) { _log(msg); }
