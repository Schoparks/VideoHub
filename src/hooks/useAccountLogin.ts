import { useEffect, useRef, useState } from 'react';
import type { AccountStatus, QRLogin } from '../shared/types';
import { api, message } from '../api';

export function useAccountLogin(update: (account: AccountStatus) => void, notify: (text: string) => void) {
  const [qr, setQR] = useState<QRLogin>();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [operation, setOperation] = useState<'app' | 'web' | 'logout'>();
  const generation = useRef(0), pending = useRef(false), currentQR = useRef(qr);
  currentQR.current = qr;
  useEffect(() => () => {
    generation.current++;
    if (currentQR.current) void api.cancelLogin(currentQR.current.id).catch(() => {});
  }, []);

  const start = async (type: 'app' | 'web') => {
    if (pending.current) return;
    const token = ++generation.current;
    pending.current = true; setBusy(true); setError('');
    setOperation(type);
    const previous = currentQR.current;
    currentQR.current = undefined; setQR(undefined);
    try {
      if (previous) await api.cancelLogin(previous.id);
      const qr = await api.login(type);
      if (token !== generation.current) { await api.cancelLogin(qr.id); return; }
      currentQR.current = qr; setQR(qr); setStatus('使用哔哩哔哩手机 App 扫码');
    } catch (error) { if (token === generation.current) setError(message(error)); }
    finally { if (token === generation.current) { pending.current = false; setBusy(false); setOperation(undefined); } }
  };

  useEffect(() => {
    if (!qr) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const token = generation.current;
    const poll = async () => {
      try {
        const result = await api.pollLogin(qr.id);
        if (stopped || token !== generation.current) return;
        setError('');
        if (result.state === 'success') {
          update(result.account!); currentQR.current = undefined; setQR(undefined);
          notify('B 站授权已连接'); return;
        }
        if (result.state === 'expired') { setStatus('二维码已过期，请刷新'); return; }
        setStatus(result.state === 'scanned' ? '已扫码，请在手机上确认' : '使用哔哩哔哩手机 App 扫码');
        timer = setTimeout(poll, 2500);
      } catch (error) {
        if (!stopped && token === generation.current) { setError(message(error)); timer = setTimeout(poll, 5000); }
      }
    };
    timer = setTimeout(poll, 2500);
    return () => { stopped = true; clearTimeout(timer); void api.cancelLogin(qr.id).catch(() => {}); };
  }, [qr]);

  const logout = async () => {
    if (pending.current) return;
    const token = ++generation.current;
    pending.current = true; setBusy(true); setError('');
    setOperation('logout');
    const previous = currentQR.current;
    currentQR.current = undefined; setQR(undefined);
    try {
      if (previous) await api.cancelLogin(previous.id);
      const account = await api.logout();
      if (token !== generation.current) return;
      update(account); notify('已移除此设备上的 B 站授权');
    } catch (error) { if (token === generation.current) setError(message(error)); }
    finally { if (token === generation.current) { pending.current = false; setBusy(false); setOperation(undefined); } }
  };
  return { qr, status, busy, error, operation, start, logout };
}
