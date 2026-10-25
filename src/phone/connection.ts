import type { ControllerCommand, ControllerReply } from '../shared/remote-control';

const key = 'yingji-controller-token';
let token = location.hash.slice(1);
try {
  if (/^[a-f0-9]{64}$/.test(token)) {
    localStorage.setItem(key, token);
    sessionStorage.setItem(key, token);
  } else token = localStorage.getItem(key) || sessionStorage.getItem(key) || '';
} catch { /* The current tab can still use the fragment when storage is disabled. */ }
history.replaceState(null, '', location.pathname);
window.addEventListener('hashchange', () => {
  const incoming = location.hash.slice(1);
  if (!/^[a-f0-9]{64}$/.test(incoming)) return;
  token = incoming;
  try { localStorage.setItem(key, token); sessionStorage.setItem(key, token); } catch { /* Use memory for this tab. */ }
  history.replaceState(null, '', location.pathname);
});

const errors: Record<string, string> = {
  busy: '正在处理，请稍后再试', blocked: '电视上有未关闭的面板，请先返回', failed: '操作失败，请重试',
  unavailable: '连接已失效，请重新扫码', canceled: '已取消',
  'app-auth': '请先在电视账号页连接 B 站 App 推荐授权',
  'web-auth': '请先在电视账号页完成 B 站网页登录',
};

async function request(path: string, command?: ControllerCommand) {
  if (!token) throw new Error('请扫描应用中的遥控二维码');
  const requestToken = token;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), command && command.kind !== 'action' && command.kind !== 'snapshot' ? 95000 : 7000);
  try {
    const response = await fetch(path, {
      method: command ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: `Bearer ${requestToken}`, ...(command ? { 'Content-Type': 'application/json' } : {}) },
      body: command ? JSON.stringify(command) : undefined,
    });
    const reply: ControllerReply = await response.json();
    if (response.status === 401 && requestToken === token) forgetConnection();
    if (reply.error || !response.ok) throw new Error(errors[reply.error || 'unavailable'] || errors.failed);
    return reply;
  } finally { clearTimeout(timeout); }
}

export const checkConnection = () => request('/state');
let catalogRead = Promise.resolve();
export const sendCommand = (command: ControllerCommand) => {
  if (!['catalog', 'folders', 'related'].includes(command.kind)) return request('/command', command);
  // Related videos and an opened history/folder card share the TV's bounded read lane.
  // Queue only reads. Playback, writes and failed operations are never replayed here.
  const paired = token;
  const result = catalogRead.then(() => {
    if (token !== paired) throw new Error(errors.canceled);
    return request('/command', command);
  });
  catalogRead = result.then(() => {}, () => {});
  return result;
};
export function forgetConnection() {
  token = '';
  try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}
export function connectionError(error: unknown) {
  return error instanceof TypeError || error instanceof DOMException
    ? '连接中断或超时，请检查同一局域网后重试' : error instanceof Error ? error.message : errors.failed;
}
