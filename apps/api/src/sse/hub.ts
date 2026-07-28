import type { Response } from 'express';

/**
 * Server-Sent Events hub: real-time push of new insights to any frontend
 * watching a household. Plain HTTP — works through the Vite dev proxy,
 * EventSource reconnects natively.
 */
export class SseHub {
  private clients = new Map<string, Set<Response>>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  register(householdId: string, res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const set = this.clients.get(householdId) ?? new Set();
    set.add(res);
    this.clients.set(householdId, set);

    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        for (const clients of this.clients.values()) {
          for (const client of clients) client.write(': ping\n\n');
        }
      }, 15_000);
      this.heartbeat.unref?.();
    }

    res.on('close', () => {
      set.delete(res);
      if (set.size === 0) this.clients.delete(householdId);
    });
  }

  broadcast(householdId: string, eventName: string, data: unknown): void {
    const set = this.clients.get(householdId);
    if (!set) return;
    const frame = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(frame);
  }
}
