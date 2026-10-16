import { afterEach, describe, expect, it, vi } from 'vitest';
import { BiliHttp, ProviderError } from '../electron/protocol/http';
import { ConnectionFailure, connectionFailure } from '../src/shared/connection-failure';
import { abortFailure, installAbortSignals } from '../android/backend/abort-signals';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Android transport feedback', () => {
  it.each(['dns', 'tls', 'timeout', 'offline'] as const)('retains %s from native transport', async kind => {
    const http = new BiliHttp(() => '', vi.fn().mockRejectedValue(new ConnectionFailure(kind)));
    const error = await http.get('https://api.bilibili.com/test').catch(error => error);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.message).toContain('B 站');
    expect(error.message).not.toContain('失败或超时');
    if (kind === 'tls') expect(error.message).toContain('日期时间');
    if (kind === 'dns') expect(error.message).toContain('DNS');
  });

  it('does not expose raw errors, unknown categories, URLs or credentials', async () => {
    const http = new BiliHttp(() => '', vi.fn().mockRejectedValue(new Error('secret Cookie=token https://private.test')));
    await expect(http.get('https://api.bilibili.com/test')).rejects.toThrow('连接 B 站失败或超时');
    expect(connectionFailure('secret')).toBeUndefined();
    expect(connectionFailure('__proto__')).toBeUndefined();
    expect(connectionFailure({ kind: 'tls' })).toBeUndefined();
    expect(connectionFailure('tls')?.message).not.toContain('B 站');
  });

  it('preserves HTTP and platform errors', async () => {
    const blocked = new BiliHttp(() => '', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(blocked.get('https://api.bilibili.com/test')).rejects.toMatchObject({ code: 403, message: 'B 站接口返回 HTTP 403' });
    const limited = new BiliHttp(() => '', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: -412 }))));
    await expect(limited.get('https://api.bilibili.com/test')).rejects.toMatchObject({ code: -412 });
  });

  it('distinguishes timeouts from user cancellation on old signals and composed signals', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('AbortSignal', {});
    installAbortSignals();
    const canceled = new AbortController();
    const timeout = AbortSignal.timeout(100);
    const combined = AbortSignal.any([canceled.signal, timeout]);
    await vi.advanceTimersByTimeAsync(100);
    expect(combined.aborted).toBe(true);
    expect(abortFailure(timeout)).toMatchObject({ kind: 'timeout' });
    expect(abortFailure(combined)).toMatchObject({ kind: 'timeout' });
    const user = new AbortController();
    const userFirst = AbortSignal.any([user.signal, AbortSignal.timeout(100)]);
    user.abort();
    expect(abortFailure(userFirst).name).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(100);
    expect(abortFailure(userFirst).name).toBe('AbortError');
    expect(abortFailure(AbortSignal.any([timeout]))).toMatchObject({ kind: 'timeout' });
  });

  it('recognizes native modern timeout reasons', () => {
    const controller = new AbortController();
    controller.abort(new DOMException('expired', 'TimeoutError'));
    expect(abortFailure(controller.signal)).toMatchObject({ kind: 'timeout' });
  });
});
