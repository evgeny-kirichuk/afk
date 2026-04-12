// ── SSE Event Bus ───────────────────────────────────────────────────────────
// Typed pub/sub for broadcasting events to SSE-connected clients.

export interface DaemonEvent {
  type: string;
  data: unknown;
  timestamp: string;
}

type Listener = (event: DaemonEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type: string, data: unknown = {}): void {
    const event: DaemonEvent = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let a failing listener break broadcast
      }
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  clear(): void {
    this.listeners.clear();
  }
}
