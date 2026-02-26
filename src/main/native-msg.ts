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
  private activeMeetClient: any = null;
  private port: number;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private nextClientId = 1;

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
          console.log(`${TAG} [${client.clientId}] unresponsive — terminating`);
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
      ws.clientId = `c${this.nextClientId++}`;
      this.clients.add(ws);
      console.log(`${TAG} [${ws.clientId}] connected (total: ${this.clients.size})`);
      this.emit('connected');

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type !== 'pong') {
            console.log(`${TAG} [${ws.clientId}] recv: ${message.type}`);
          }
          this.handleMessage(message, ws);
        } catch (err) {
          console.error(`${TAG} [${ws.clientId}] invalid message:`, err);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        if (ws === this.activeMeetClient) {
          console.log(`${TAG} [${ws.clientId}] was active Meet client — clearing`);
          this.activeMeetClient = null;
        }
        console.log(`${TAG} [${ws.clientId}] disconnected (remaining: ${this.clients.size})`);
        if (this.clients.size === 0) {
          this.emit('disconnected');
        }
      });
    });
  }

  private handleMessage(message: any, sender?: any): void {
    switch (message.type) {
      case 'meet_status':
        console.log(`${TAG} [${sender?.clientId}] meet_status: active=${message.active}, muted=${message.muted}`);
        // Track which client has the active Meet session
        if (message.active && sender) {
          if (this.activeMeetClient !== sender) {
            console.log(`${TAG} Active Meet client: ${sender.clientId}`);
          }
          this.activeMeetClient = sender;
        }
        this.emit('meet-status', message as MeetStatus);
        break;
      case 'mute_toggled':
        console.log(`${TAG} [${sender?.clientId}] mute_toggled: success=${message.success}, muted=${message.muted}`);
        this.emit('mute-toggled', message as MuteResult);
        break;
      case 'pong':
        break;
    }
  }

  /** Send a message to a specific client, or broadcast if no target. */
  private sendTo(message: object, target?: any): void {
    const data = JSON.stringify(message);
    if (target && target.readyState === 1) {
      console.log(`${TAG} send → ${target.clientId}: ${(message as any).type}`);
      target.send(data);
    } else {
      console.log(`${TAG} broadcast → ${this.clients.size} client(s): ${(message as any).type}`);
      for (const client of this.clients) {
        if (client.readyState === 1) {
          client.send(data);
        }
      }
    }
  }

  /**
   * Send a request and wait for a response event.
   * If targetClient is provided and connected, sends only to it.
   * Otherwise broadcasts to all clients.
   */
  private request<T>(sendType: string, responseEvent: string, fallback: T, targetClient?: any): Promise<T> {
    const requestId = randomUUID();
    const target = targetClient?.readyState === 1 ? targetClient : null;
    console.log(
      `${TAG} ${sendType}() called (requestId=${requestId.slice(0, 8)}, target=${target?.clientId ?? 'broadcast'})`,
    );
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

      this.sendTo({ type: sendType, requestId }, target);
    });
  }

  queryMeetStatus(): Promise<MeetStatus> {
    // Target the known Meet client if available; broadcast to discover if not
    return this.request(
      'query_meet_status',
      'meet-status',
      { active: false, muted: false, tabId: null },
      this.activeMeetClient,
    );
  }

  toggleMute(): Promise<MuteResult> {
    if (!this.activeMeetClient || this.activeMeetClient.readyState !== 1) {
      console.log(`${TAG} toggleMute() — no active Meet client, failing fast`);
      return Promise.resolve({ success: false, error: 'No active Meet client' });
    }
    return this.request('toggle_mute', 'mute-toggled', { success: false, error: 'Timeout' }, this.activeMeetClient);
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
    this.activeMeetClient = null;
  }
}
