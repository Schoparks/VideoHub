interface FullscreenWindow {
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  setFullScreen(value: boolean): void;
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}

/** Serial native transitions shared by preferences and player requests. */
export function createFullscreenControl(getWindow: () => FullscreenWindow | null, hidden: boolean, timeoutMs = 5000) {
  let pending = Promise.resolve();
  return (value: boolean) => {
    const operation = pending.catch(() => {}).then(async () => {
      const window = getWindow();
      if (hidden) return;
      if (!window || window.isDestroyed()) throw new Error('窗口已关闭');
      if (window.isFullScreen() === value) return;
      await new Promise<void>((resolve, reject) => {
        const event = value ? 'enter-full-screen' : 'leave-full-screen';
        const finish = (error?: Error) => {
          clearTimeout(timer);
          window.removeListener(event, changed);
          window.removeListener('closed', closed);
          if (error) reject(error);
          else resolve();
        };
        const changed = () => { if (window.isFullScreen() === value) finish(); };
        const closed = () => finish(new Error('窗口已关闭'));
        const timer = setTimeout(() => finish(new Error('全屏切换超时，请重试')), timeoutMs);
        window.on(event, changed);
        window.on('closed', closed);
        try { window.setFullScreen(value); }
        catch { finish(new Error('无法切换全屏，请重试')); }
      });
    });
    pending = operation;
    return operation;
  };
}
