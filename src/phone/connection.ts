import type { ControllerCommand, ControllerReply } from '../shared/remote-control';

const key = 'yingji-controller-token';
let token = location.hash.slice(1);
try {
  if (/^[a-f0-9]{64}$/.test(token)) sessionStorage.setItem(key, token);
  else token = sessionStorage.getItem(key) || '';
} catch { /* The current tab can still use the fragment when storage is disabled. */ }
history.replaceState(null, '', location.pathname);

const errors: Record<string, string> = {
  busy: '正在处理，请稍后再试', blocked: '请先返回浏览页面', failed: '操作失败，请在屏幕上查看详情或重试',
  unavailable: '连接已失效，请重新扫码', canceled: '已取消',
};

async function request(path: string, command?: ControllerCommand) {
  if (!token) throw new Error('请扫描应用中的遥控二维码');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), command?.kind === 'url' ? 95000 : 7000);
  try {
    const response = await fetch(path, {
      method: command ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, ...(command ? { 'Content-Type': 'application/json' } : {}) },
      body: command ? JSON.stringify(command) : undefined,
    });
    const reply: ControllerReply = await response.json();
    if (reply.error || !response.ok) throw new Error(errors[reply.error || 'unavailable'] || errors.failed);
  } finally { clearTimeout(timeout); }
}

export const checkConnection = () => request('/state');
export const sendCommand = (command: ControllerCommand) => request('/command', command);
export function connectionError(error: unknown) {
  return error instanceof TypeError || error instanceof DOMException
    ? '连接中断或超时，请检查同一局域网后重试' : error instanceof Error ? error.message : errors.failed;
}
