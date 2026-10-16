import { ConnectionFailure } from '../../src/shared/connection-failure';

// Chromium 66 abort() discards reasons. Keep timeout identity inside this backend.
const reasons = new WeakMap<AbortSignal, Error>();

export function abortFailure(signal?: AbortSignal): Error {
  if (signal && reasons.has(signal)) return reasons.get(signal)!;
  if (signal?.reason?.name === 'TimeoutError') return new ConnectionFailure('timeout');
  return new DOMException('操作已取消', 'AbortError');
}

export function installAbortSignals() {
  if (!AbortSignal.timeout) AbortSignal.timeout = delay => {
    const controller = new AbortController();
    setTimeout(() => {
      reasons.set(controller.signal, new ConnectionFailure('timeout'));
      controller.abort();
    }, delay);
    return controller.signal;
  };
  if (!AbortSignal.any) AbortSignal.any = signals => {
    const controller = new AbortController();
    const listeners = new Map<AbortSignal, () => void>();
    const abort = (signal: AbortSignal) => {
      reasons.set(controller.signal, abortFailure(signal));
      controller.abort();
      for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
      listeners.clear();
    };
    for (const signal of signals) {
      if (signal.aborted) { abort(signal); break; }
      const listener = () => abort(signal);
      listeners.set(signal, listener);
      signal.addEventListener('abort', listener, { once: true });
    }
    return controller.signal;
  };
}
