import type { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { ControllerServer } from './server';
import type { ControllerCommand, ControllerReply } from '../../src/shared/remote-control';

export class PhoneController {
  private pending = new Map<string, { finish: (reply: ControllerReply) => void; timer: ReturnType<typeof setTimeout> }>();
  private server: ControllerServer;

  constructor(directory: string, private window: () => BrowserWindow | null) {
    this.server = new ControllerServer(directory, command => this.dispatch(command));
  }

  status = async () => this.server.start();
  // Retain the named bridge for older clients; the application now keeps control enabled.
  setEnabled = async (_enabled: boolean) => this.status();

  cancelPending = async () => {
    for (const id of this.pending.keys()) await this.reply(id, { error: 'unavailable' });
  };

  reply = async (id: string, reply: ControllerReply) => {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.finish(reply);
  };

  async stop() {
    await this.cancelPending();
    return this.server.stop();
  }

  private dispatch(command: ControllerCommand): Promise<ControllerReply> {
    const window = this.window();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed() || window.isMinimized()) {
      return Promise.resolve({ error: 'unavailable' });
    }
    const id = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => { void this.reply(id, { error: 'unavailable' }); }, command.kind === 'action' ? 5000 : 90000);
      this.pending.set(id, { finish: resolve, timer });
      window.webContents.send('controller:command', { id, command });
    });
  }
}
