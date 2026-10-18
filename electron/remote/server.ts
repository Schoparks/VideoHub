import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { controllerHosts, privateAddress } from './addresses';
import { controllerAssets } from './assets';
import { parseControllerCommand, type ControllerCommand, type ControllerReply, type ControllerStatus } from '../../src/shared/remote-control';

/** Separate LAN listener; it has no media gateway, account, disk or generic IPC endpoints. */
export class ControllerServer {
  private server?: Server;
  private token = '';
  private hosts = new Set<string>();
  private urls: string[] = [];
  private starting?: Promise<ControllerStatus>;
  private revision = 0;
  private active = 0;
  private allowance = 30;
  private refilled = Date.now();

  constructor(private directory: string, private execute: (command: ControllerCommand) => Promise<ControllerReply>) {}

  status(): ControllerStatus { return { enabled: !!this.server, urls: [...this.urls] }; }

  start(): Promise<ControllerStatus> {
    if (this.server) {
      this.updateAddresses(controllerHosts());
      return Promise.resolve(this.status());
    }
    if (this.starting) return this.starting;
    const revision = this.revision;
    this.starting = this.listen(revision).finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async listen(revision: number) {
    const addresses = controllerHosts();
    if (!addresses.length) throw new Error('未找到局域网地址，请先连接 Wi-Fi 或有线网络');
    const assets = await controllerAssets(this.directory);
    if (revision !== this.revision) return this.status();
    const server = createServer((request, response) => {
      void this.handle(request, response, assets).catch(() => {
        if (!response.headersSent) this.respond(response, 400, { error: 'failed' });
        else response.destroy();
      });
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 5000;
    server.maxConnections = 16;
    server.maxRequestsPerSocket = 100;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); });
    }).catch(() => { throw new Error('无法开启手机遥控，请检查网络或端口权限'); });
    if (revision !== this.revision) { server.close(); return this.status(); }
    server.on('error', () => { void this.stop(); });
    this.token = randomBytes(32).toString('hex');
    this.server = server;
    this.updateAddresses(addresses);
    return this.status();
  }

  private updateAddresses(addresses: string[]) {
    const port = (this.server!.address() as { port: number }).port;
    this.hosts = new Set([...addresses, '127.0.0.1'].map(address => `${address}:${port}`));
    this.urls = addresses.map(address => `http://${address}:${port}/#${this.token}`);
  }

  async stop() {
    this.revision++;
    const server = this.server;
    this.server = undefined;
    this.token = '';
    this.urls = [];
    this.hosts.clear();
    server?.closeAllConnections();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    return this.status();
  }

  private respond(response: ServerResponse, status: number, value: unknown) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  }

  private async handle(request: IncomingMessage, response: ServerResponse,
    assets: Awaited<ReturnType<typeof controllerAssets>>) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const host = request.headers.host || '';
    const peer = (request.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const origin = request.headers.origin;
    if (!this.hosts.has(host) || !(peer === '127.0.0.1' || privateAddress(peer))
      || origin && origin !== `http://${host}` || request.headers['sec-fetch-site'] === 'cross-site') {
      this.respond(response, 403, { error: 'unavailable' }); return;
    }
    const path = request.url || '/';
    const asset = assets.get(path);
    if (request.method === 'GET' && asset) {
      response.writeHead(200, { 'Content-Type': asset.mime }); response.end(asset.body); return;
    }
    const supplied = request.headers.authorization?.replace(/^Bearer /, '') || '';
    if (!this.token || !/^[a-f0-9]{64}$/.test(supplied)
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(this.token))) {
      this.respond(response, 401, { error: 'unavailable' }); return;
    }
    if (request.method === 'GET' && path === '/state') {
      this.respond(response, 200, {}); return;
    }
    if (request.method !== 'POST' || path !== '/command') { this.respond(response, 404, {}); return; }
    if (request.headers['content-type'] !== 'application/json' || request.headers['transfer-encoding']) {
      this.respond(response, 400, { error: 'failed' }); return;
    }
    const now = Date.now();
    this.allowance = Math.min(30, this.allowance + (now - this.refilled) / 100);
    this.refilled = now;
    if (this.allowance < 1 || this.active >= 4) { this.respond(response, 429, { error: 'busy' }); return; }
    this.allowance--;
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 32768) { this.respond(response, 413, { error: 'failed' }); return; }
      chunks.push(Buffer.from(chunk));
    }
    const command = parseControllerCommand(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!command) { this.respond(response, 400, { error: 'failed' }); return; }
    // Stop/reopen during body upload must not execute an old capability.
    if (supplied !== this.token) { this.respond(response, 401, { error: 'unavailable' }); return; }
    if (this.active >= 4) { this.respond(response, 429, { error: 'busy' }); return; }
    this.active++;
    try { this.respond(response, 200, await this.execute(command)); }
    finally { this.active--; }
  }
}
