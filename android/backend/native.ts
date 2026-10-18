import { connectionFailure } from '../../src/shared/connection-failure';
import { abortFailure } from './abort-signals';

export interface NativeBackend {
  controllerStatus(): string;
  controllerEnable(enabled: boolean): string;
  controllerReply(id: string, json: string): void;
  read(name: string): string;
  write(name: string, value: string): string;
  digest(algorithm: string, value: string): string;
  secure(): boolean;
  videoSupport(json: string): number;
  request(id: string, json: string): void;
  cancel(id: string): void;
  register(json: string): string;
  release(id: string): void;
  access(uri: string): boolean;
  select(id: string, directory: boolean): void;
  scan(id: string, roots: string): void;
  official(url: string): string;
  reply(id: string, json: string): void;
  ready(): void;
}

declare global {
  interface Window {
    Backend: NativeBackend;
    nativeReply: (id: string, json: string) => void;
    backendCall: (id: string, method: string, args: unknown[]) => void;
  }
}
export const native = window.Backend;
let sequence = 0;
const requests = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
window.nativeReply = (id, json) => {
  const request = requests.get(id);
  if (!request) return;
  requests.delete(id);
  const reply = JSON.parse(json);
  if (reply.error) request.reject(connectionFailure(reply.errorKind) || new Error(reply.error));
  else request.resolve(reply.value);
};
export function nativeTask(start: (id: string) => void, signal?: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = `native-${++sequence}`;
    const abort = () => {
      requests.delete(id);
      native.cancel(id);
      reject(abortFailure(signal));
    };
    if (signal?.aborted) { reject(abortFailure(signal)); return; }
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => signal?.removeEventListener('abort', abort);
    requests.set(id, {
      resolve: value => { cleanup(); resolve(value); },
      reject: error => { cleanup(); reject(error); },
    });
    try { start(id); } catch (error) { requests.delete(id); cleanup(); reject(error); }
  });
}

export function persist(name: string, value: unknown) {
  const error = native.write(name, JSON.stringify(value));
  if (error) throw new Error(error);
}
