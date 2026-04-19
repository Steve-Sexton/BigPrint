// Thin logging wrapper used by both the main and renderer processes.
//
// Goals:
//  - Consistent `[module] message` prefix so grepping log output is predictable.
//  - Single place to redirect output later (e.g. to electron-log, a file sink,
//    or a renderer dev-tools panel) without touching every call site.
//  - Zero runtime dependencies — keeps the shared module DOM-free and usable
//    from the sandboxed preload.
//
// This is intentionally a small shim, not a real logging framework.

type LogLevel = 'warn' | 'error' | 'info'

function emit(level: LogLevel, module: string, args: unknown[]): void {
  const prefix = `[${module}]`
  // eslint-disable-next-line no-console -- this IS the wrapper
  const fn = level === 'error' ? console.error : level === 'info' ? console.info : console.warn
  fn(prefix, ...args)
}

export const log = {
  warn(module: string, ...args: unknown[]): void {
    emit('warn', module, args)
  },
  error(module: string, ...args: unknown[]): void {
    emit('error', module, args)
  },
  info(module: string, ...args: unknown[]): void {
    emit('info', module, args)
  },
}
