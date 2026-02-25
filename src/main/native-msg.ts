import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

const TAG = '[MeetPods:bridge]';
const REQUEST_TIMEOUT_MS = 2000;
const PING_INTERVAL_MS = 15_000;

export interface MeetStatus {
  active: boolean;
  muted: boolean;
  tabId: number | null;
}

export interface MuteResult {
  success: boolean;
  muted?: boolean;
  error?: string;
}

export class ExtensionBridge extends EventEmitter {
  private wss: any = null;
  private clients: Set<any> = new Set();
  private port: number;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(port: number = 18432) {
    super();
    this.port = port;
  }

  async start(): Promise<void> {
    const { WebSocketServer } = await import('ws');

    this.wss = new WebSocketServer({
      port: this.port,
      host: '127.0.0.1',
    });

    console.log(`${TAG} WebSocket server listening on 127.0.0.1:${this.port}`);

    this.pingInterval = setInterval(() => {
      for (const client of this.clients) {
        if (client.isAlive === false) {
          console.log(`${TAG} Client unresponsive — terminating`);
          client.terminate();
          continue;
        }
        client.isAlive = false;
        client.ping();
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: 'ping' }));
        }
      }
    }, PING_INTERVAL_MS);

    this.wss.on('connection', (ws: any) => {
      ws.isAlive = true;
      this.clients.add(ws);
      console.log(`${TAG} Client connected (total: ${this.clients.size})`);
      this.emit('connected');

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          console.log(`${TAG} Received message: ${message.type}`);
          this.handleMessage(message, ws);
        } catch (err) {
          console.error(`${TAG} Invalid message from extension:`, err);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`${TAG} Client disconnected (remaining: ${this.clients.size})`);
        if (this.clients.size === 0) {
          this.emit('disconnected');
        }
      });
    });
  }

  private broadcast(message: object, excludeSender?: any): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client !== excludeSender && client.readyState === 1) {
        client.send(data);
      }
    }
  }

  private handleMessage(message: any, _sender?: any): void {
    switch (message.type) {
      case 'meet_status':
        console.log(`${TAG} handleMessage(meet_status): active=${message.active}, muted=${message.muted}`);
        this.emit('meet-status', message as MeetStatus);
        break;
      case 'mute_toggled':
        console.log(`${TAG} handleMessage(mute_toggled): success=${message.success}, muted=${message.muted}`);
        this.emit('mute-toggled', message as MuteResult);
        break;
      case 'pong':
        break;
    }
  }

  send(message: object): void {
    const msg = message as any;
    console.log(`${TAG} Sending "${msg.type}" to ${this.clients.size} client(s)`);
    this.broadcast(message);
  }

  private request<T>(sendType: string, responseEvent: string, fallback: T): Promise<T> {
    const requestId = randomUUID();
    console.log(`${TAG} ${sendType}() called (requestId=${requestId})`);
    return new Promise((resolve) => {
      let resolved = false;

      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        console.log(`${TAG} ${sendType}() TIMED OUT (${REQUEST_TIMEOUT_MS}ms)`);
        this.removeListener(responseEvent, handler);
        resolve(fallback);
      }, REQUEST_TIMEOUT_MS);

      const handler = (result: T & { requestId?: string }) => {
        if (result.requestId && result.requestId !== requestId) {
          this.once(responseEvent, handler);
          return;
        }
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve(result);
      };
      this.once(responseEvent, handler);

      this.send({ type: sendType, requestId });
    });
  }

  queryMeetStatus(): Promise<MeetStatus> {
    return this.request('query_meet_status', 'meet-status', { active: false, muted: false, tabId: null });
  }

  toggleMute(): Promise<MuteResult> {
    return this.request('toggle_mute', 'mute-toggled', { success: false, error: 'Timeout' });
  }

  get isConnected(): boolean {
    return this.clients.size > 0;
  }

  stop(): void {
    console.log(`${TAG} Stopping WebSocket server`);
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.clients.clear();
  }
}
