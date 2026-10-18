import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, message } from '../api';
import type { ControllerStatus } from '../shared/remote-control';

export function useControllerPairing() {
  const [status, setStatus] = useState<ControllerStatus>({ enabled: false, urls: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [image, setImage] = useState('');
  const generation = useRef(0), pending = useRef(false);
  const url = status.urls[index] || status.urls[0] || '';
  const supported = !!api.controllerEnable && !!api.onControllerCommand;
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (pending.current) return;
      const token = generation.current;
      try {
        const next = await api.controllerStatus?.();
        if (active && token === generation.current && next) {
          setStatus(next);
          setError(next.enabled && !next.urls.length ? '未找到局域网地址，请检查网络连接' : '');
        }
      } catch (error) { if (active && token === generation.current) setError(message(error)); }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 4000);
    return () => { active = false; generation.current++; clearInterval(timer); };
  }, []);
  useEffect(() => {
    let active = true;
    setImage('');
    if (url) void QRCode.toDataURL(url, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
      .then(image => { if (active) setImage(image); })
      .catch(() => { if (active) setError('二维码生成失败，请关闭后重试'); });
    return () => { active = false; };
  }, [url]);
  const enable = async (enabled: boolean) => {
    if (pending.current) return;
    const token = ++generation.current;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await api.controllerEnable!(enabled);
      if (token === generation.current) { setStatus(next); setIndex(0); }
    } catch (error) { if (token === generation.current) setError(message(error)); }
    finally { pending.current = false; if (token === generation.current) setBusy(false); }
  };
  return { supported, status, busy, error, index, setIndex, image, url, enable };
}
