interface SyncJob {
  run: () => Promise<boolean>;
  complete: (result: 'synced' | 'failed' | 'skipped') => void;
}

/** Remote writes stay in order; waiting updates keep only the latest position. */
export class HistorySync {
  private pending = new Map<string, SyncJob>();
  private running = false;
  private stopped = false;

  enqueue(key: string, job: SyncJob) {
    if (this.stopped) return;
    this.pending.set(key, job);
    if (!this.running) void this.drain();
  }

  stop() {
    this.stopped = true;
    this.pending.clear();
  }

  private async drain() {
    this.running = true;
    try {
      while (!this.stopped && this.pending.size) {
        const [key, job] = this.pending.entries().next().value!;
        this.pending.delete(key);
        try {
          const synced = await job.run();
          job.complete(synced ? 'synced' : 'skipped');
        } catch {
          job.complete('failed');
        }
      }
    } finally {
      this.running = false;
    }
  }
}
