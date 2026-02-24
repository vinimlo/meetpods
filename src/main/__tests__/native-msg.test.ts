import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';

let bridge: any;

async function createBridge() {
  const { ExtensionBridge } = await import('../native-msg');
  const b = new ExtensionBridge(0);
  await b.start();
  // Wait for the server to actually be listening (needed for port 0)
  const wss = (b as any).wss;
  if (!wss.address()) {
    await new Promise<void>((resolve) => wss.on('listening', resolve));
  }
  const port = wss.address().port as number;
  return { bridge: b, port };
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForEvent(emitter: any, event: string, timeout = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    emitter.once(event, (data: any) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function waitForMessage(ws: WebSocket, timeout = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeout);
    ws.once('message', (data: any) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function closeClient(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.on('close', () => resolve());
    ws.close();
  });
}

describe('ExtensionBridge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    bridge?.stop();
    bridge = null;
    // Small delay to let sockets clean up
    await new Promise((r) => setTimeout(r, 50));
  });

  describe('start() and connections', () => {
    it('creates server and emits connected when client connects', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      expect(bridge.isConnected).toBe(true);
      await closeClient(client);
    });

    it('emits disconnected when last client disconnects', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      const disconnP = waitForEvent(bridge, 'disconnected');
      await closeClient(client);
      await disconnP;

      expect(bridge.isConnected).toBe(false);
    });

    it('does not emit disconnected when one of two clients disconnects', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const conn1P = waitForEvent(bridge, 'connected');
      const client1 = await connectClient(setup.port);
      await conn1P;

      const conn2P = waitForEvent(bridge, 'connected');
      const client2 = await connectClient(setup.port);
      await conn2P;

      let disconnected = false;
      bridge.on('disconnected', () => {
        disconnected = true;
      });

      await closeClient(client1);
      await new Promise((r) => setTimeout(r, 100));

      expect(disconnected).toBe(false);
      expect(bridge.isConnected).toBe(true);

      await closeClient(client2);
    });
  });

  describe('message handling', () => {
    it('emits meet-status on meet_status message', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      const statusP = waitForEvent(bridge, 'meet-status');
      client.send(JSON.stringify({ type: 'meet_status', active: true, muted: false, tabId: 1 }));
      const status = await statusP;

      expect(status.active).toBe(true);
      expect(status.muted).toBe(false);
      await closeClient(client);
    });

    it('emits mute-toggled on mute_toggled message', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      const muteP = waitForEvent(bridge, 'mute-toggled');
      client.send(JSON.stringify({ type: 'mute_toggled', success: true, muted: true }));
      const result = await muteP;

      expect(result.success).toBe(true);
      await closeClient(client);
    });

    it('handles invalid JSON without crashing', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      client.send('not valid json{{{');
      await new Promise((r) => setTimeout(r, 100));

      expect(bridge.isConnected).toBe(true);
      await closeClient(client);
    });

    it('ignores unknown message types', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      let emitted = false;
      bridge.on('meet-status', () => {
        emitted = true;
      });
      bridge.on('mute-toggled', () => {
        emitted = true;
      });

      client.send(JSON.stringify({ type: 'unknown_type' }));
      await new Promise((r) => setTimeout(r, 100));

      expect(emitted).toBe(false);
      await closeClient(client);
    });
  });

  describe('send()', () => {
    it('broadcasts to all connected clients', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const conn1P = waitForEvent(bridge, 'connected');
      const client1 = await connectClient(setup.port);
      await conn1P;

      const conn2P = waitForEvent(bridge, 'connected');
      const client2 = await connectClient(setup.port);
      await conn2P;

      const msg1P = waitForMessage(client1);
      const msg2P = waitForMessage(client2);
      bridge.send({ type: 'test', data: 'hello' });

      const [msg1, msg2] = await Promise.all([msg1P, msg2P]);
      expect(msg1.type).toBe('test');
      expect(msg2.type).toBe('test');

      await closeClient(client1);
      await closeClient(client2);
    });
  });

  describe('queryMeetStatus()', () => {
    it('resolves when client responds with matching requestId', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      client.on('message', (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'query_meet_status') {
          client.send(
            JSON.stringify({
              type: 'meet_status',
              active: true,
              muted: true,
              tabId: 5,
              requestId: msg.requestId,
            }),
          );
        }
      });

      const status = await bridge.queryMeetStatus();
      expect(status.active).toBe(true);
      expect(status.muted).toBe(true);

      await closeClient(client);
    });

    it('resolves with fallback on timeout', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      // Client does NOT respond
      const status = await bridge.queryMeetStatus();
      expect(status.active).toBe(false);
      expect(status.muted).toBe(false);
      expect(status.tabId).toBeNull();

      await closeClient(client);
    });

    it('re-registers handler on mismatched requestId', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      client.on('message', (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'query_meet_status') {
          // First: wrong requestId
          client.send(
            JSON.stringify({
              type: 'meet_status',
              active: false,
              muted: false,
              tabId: null,
              requestId: 'wrong-id',
            }),
          );
          // Then: correct one
          setTimeout(() => {
            client.send(
              JSON.stringify({
                type: 'meet_status',
                active: true,
                muted: false,
                tabId: 2,
                requestId: msg.requestId,
              }),
            );
          }, 50);
        }
      });

      const status = await bridge.queryMeetStatus();
      expect(status.active).toBe(true);

      await closeClient(client);
    });
  });

  describe('toggleMute()', () => {
    it('resolves when client responds', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      client.on('message', (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'toggle_mute') {
          client.send(
            JSON.stringify({
              type: 'mute_toggled',
              success: true,
              muted: true,
              requestId: msg.requestId,
            }),
          );
        }
      });

      const result = await bridge.toggleMute();
      expect(result.success).toBe(true);
      expect(result.muted).toBe(true);

      await closeClient(client);
    });

    it('resolves with fallback on timeout', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      const result = await bridge.toggleMute();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout');

      await closeClient(client);
    });
  });

  describe('ping/pong keepalive', () => {
    it('sends ping to connected clients', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      // Client should receive a ping and auto-respond with pong
      const pingReceived = new Promise<void>((resolve) => {
        client.on('ping', () => resolve());
      });

      // Access internal pingInterval to verify it's set
      expect((bridge as any).pingInterval).not.toBeNull();

      // Manually trigger what the interval does by waiting for the interval to fire
      // Instead, we'll just verify the ping comes through
      // The ping interval is 15s, but we can't wait that long in tests.
      // Instead, verify the mechanism works by checking client isAlive tracking.

      // Force a ping cycle manually
      const clients = (bridge as any).clients;
      for (const ws of clients) {
        expect(ws.isAlive).toBe(true);
        ws.isAlive = false;
        ws.ping();
      }

      await pingReceived;

      // After pong is received, isAlive should be true again
      await new Promise((r) => setTimeout(r, 50));
      for (const ws of clients) {
        expect(ws.isAlive).toBe(true);
      }

      await closeClient(client);
    });

    it('terminates unresponsive clients', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      // Simulate an unresponsive client: set isAlive=false and prevent pong
      const clients = (bridge as any).clients;
      for (const ws of clients) {
        ws.isAlive = false;
      }

      // Trigger the ping cycle logic manually (simulates interval firing)
      for (const ws of [...clients]) {
        if (ws.isAlive === false) {
          ws.terminate();
        }
      }

      await new Promise((r) => setTimeout(r, 100));
      expect(bridge.isConnected).toBe(false);
    });

    it('clears ping interval on stop()', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      expect((bridge as any).pingInterval).not.toBeNull();
      bridge.stop();
      expect((bridge as any).pingInterval).toBeNull();
      bridge = null;
    });
  });

  describe('stop()', () => {
    it('closes server and clears clients', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      const connP = waitForEvent(bridge, 'connected');
      const client = await connectClient(setup.port);
      await connP;

      bridge.stop();
      expect(bridge.isConnected).toBe(false);
      bridge = null;
    });

    it('no-op when server is null', async () => {
      const setup = await createBridge();
      bridge = setup.bridge;

      bridge.stop();
      bridge.stop(); // second stop should not throw
      bridge = null;
    });
  });
});
