import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { transform } from 'esbuild';

/** Direct page CDP: modern Playwright sends commands missing from WebView 66. */
export async function connectLegacyWebViews(serial, port = 9552) {
  if (!/^emulator-\d+$/.test(serial || '')) throw new Error('必须显式指定隔离模拟器');
  const adb = resolve(process.env.ANDROID_HOME || '.tmp/android-tools/sdk', 'platform-tools',
    process.platform === 'win32' ? 'adb.exe' : 'adb');
  const command = args => new Promise((resolveCommand, reject) => {
    const child = spawn(adb, ['-s', serial, ...args], { windowsHide: true });
    const chunks = [], errors = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveCommand(Buffer.concat(chunks)) : reject(new Error(Buffer.concat(errors).toString())));
  });
  const pid = (await command(['shell', 'pidof', 'app.yingji.tv'])).toString().trim();
  if (!/^\d+$/.test(pid)) throw new Error('测试 APK 未运行');
  await command(['forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`]);
  let targets;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.length >= 2) break;
    } catch { /* The native debug socket opens asynchronously after Activity start. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  if (!targets?.length) throw new Error('旧内核调试页面未就绪');
  const pages = [];
  for (const target of targets) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let id = 0;
    const pending = new Map(), errors = [];
    socket.addEventListener('close', () => {
      for (const job of pending.values()) job.reject(new Error('旧内核调试页面已关闭'));
      pending.clear();
    });
    socket.addEventListener('message', event => {
      const response = JSON.parse(event.data);
      if (response.id) {
        const job = pending.get(response.id);
        pending.delete(response.id);
        if (response.error) job?.reject(new Error(JSON.stringify(response.error)));
        else job?.resolve(response.result);
      } else if (response.method === 'Runtime.exceptionThrown') errors.push(response.params.exceptionDetails);
      else if (response.method === 'Runtime.consoleAPICalled' && response.params.type === 'error') {
        errors.push(response.params.args.map(argument => argument.description || argument.value));
      }
    });
    const send = (method, params = {}) => new Promise((resolveResponse, reject) => {
      if (socket.readyState !== WebSocket.OPEN) { reject(new Error('旧内核调试连接已关闭')); return; }
      const requestId = ++id;
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`旧内核调试命令超时: ${method}`));
      }, 60000);
      pending.set(requestId, {
        resolve: result => { clearTimeout(timeout); resolveResponse(result); },
        reject: error => { clearTimeout(timeout); reject(error); },
      });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    await send('Runtime.enable');
    const evaluate = async (fn, argument, boolean = false) => {
      const call = `(${fn.toString()})(${JSON.stringify(argument) ?? 'undefined'})`;
      const source = boolean ? `Boolean(${call})` : call;
      const { code } = await transform(source, { target: 'chrome66' });
      const result = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const wait = async (fn, argument, timeout = 15000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const result = await evaluate(fn, argument, true);
        if (result) return result;
        await new Promise(resolveWait => setTimeout(resolveWait, 100));
      }
      throw new Error(`旧内核等待超时: ${fn.toString()}`);
    };
    pages.push({ url: target.url, evaluate, wait, errors, send, close: () => socket.close() });
  }
  return { pages, command, close: async () => {
    pages.forEach(page => page.close());
    await command(['forward', '--remove', `tcp:${port}`]);
  } };
}
