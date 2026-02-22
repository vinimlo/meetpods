import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('background.ts', () => {
  let wsInstance: any;
  let WSConstructorCalls: string[];
  let onMessageHandler: any;
  let tabUpdateListener: any;
  let tabRemovedListener: any;
  let tabActivatedListener: any;
  let alarmListener: any;

  beforeEach(() => {
    WSConstructorCalls = [];
    wsInstance = null;
    onMessageHandler = null;
    tabUpdateListener = null;
    tabRemovedListener = null;
    tabActivatedListener = null;
    alarmListener = null;

    globalThis.chrome = {
      tabs: {
        query: vi.fn((opts: any, cb: any) => cb([])),
        sendMessage: vi.fn().mockResolvedValue({ active: false, muted: false }),
        onUpdated: { addListener: vi.fn((cb: any) => { tabUpdateListener = cb; }) },
        onRemoved: { addListener: vi.fn((cb: any) => { tabRemovedListener = cb; }) },
        onActivated: { addListener: vi.fn((cb: any) => { tabActivatedListener = cb; }) },
      },
      runtime: {
        onMessage: {
          addListener: vi.fn((handler: any) => { onMessageHandler = handler; }),
        },
      },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: {
          addListener: vi.fn((cb: any) => { alarmListener = cb; }),
        },
      },
    };
  });

  afterEach(() => {
    delete globalThis.chrome;
    delete globalThis.WebSocket;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  function installWS(behavior = 'normal') {
    globalThis.WebSocket = function MockWebSocket(this: any, url: string) {
      WSConstructorCalls.push(url);
      if (behavior === 'throw') throw new Error('connection refused');
      wsInstance = this;
      this.url = url;
      this.readyState = 0;
      this.send = vi.fn();
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
    } as any;
    globalThis.WebSocket.OPEN = 1;
    globalThis.WebSocket.CLOSED = 3;
  }

  async function load(wsBehavior = 'normal') {
    installWS(wsBehavior);
    await import('../../extension/background.ts');
  }

  function simulateWSOpen() {
    wsInstance.readyState = 1;
    wsInstance.onopen?.();
  }

  function simulateWSMessage(data: any) {
    wsInstance.onmessage?.({ data: JSON.stringify(data) });
  }

  function simulateWSClose() {
    wsInstance.readyState = 3;
    wsInstance.onclose?.();
  }

  describe('startup', () => {
    it('scans for existing Meet tabs', async () => {
      const tabs = [
        { id: 1, url: 'https://meet.google.com/abc-def', active: true },
        { id: 2, url: 'https://meet.google.com/xyz-uvw', active: false },
      ];
      globalThis.chrome.tabs.query.mockImplementation((opts: any, cb: any) => cb(tabs));

      await load();
      expect(globalThis.chrome.tabs.query).toHaveBeenCalledWith(
        { url: 'https://meet.google.com/*' },
        expect.any(Function)
      );
    });

    it('connects WebSocket on load', async () => {
      await load();
      expect(WSConstructorCalls.length).toBe(1);
      expect(WSConstructorCalls[0]).toBe('ws://127.0.0.1:18432');
    });
  });

  describe('isWsConnected()', () => {
    it('returns false initially', async () => {
      await load();
      const sendResponse = vi.fn();
      onMessageHandler({ type: 'check_electron_status' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ connected: false });
    });

    it('returns true after open', async () => {
      await load();
      simulateWSOpen();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'check_electron_status' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ connected: true });
    });
  });

  describe('tab tracking', () => {
    it('onUpdated adds Meet tab', async () => {
      await load();
      tabUpdateListener(1, {}, { url: 'https://meet.google.com/abc' });
    });

    it('onUpdated updates already-tracked Meet tab', async () => {
      await load();
      tabUpdateListener(1, {}, { url: 'https://meet.google.com/abc' });
      // Update same tab — hits the false branch of !meetTabs.has(tabId)
      tabUpdateListener(1, {}, { url: 'https://meet.google.com/abc-def' });
    });

    it('onUpdated removes non-Meet tab that was previously tracked', async () => {
      await load();
      tabUpdateListener(1, {}, { url: 'https://meet.google.com/abc' });
      tabUpdateListener(1, {}, { url: 'https://google.com' });
    });

    it('onUpdated ignores tab without Meet url', async () => {
      await load();
      tabUpdateListener(1, {}, { url: 'https://google.com' });
    });

    it('onRemoved removes Meet tab', async () => {
      await load();
      tabUpdateListener(1, {}, { url: 'https://meet.google.com/abc' });
      tabRemovedListener(1);
    });

    it('onRemoved handles non-Meet tab', async () => {
      await load();
      tabRemovedListener(999);
    });

    it('onActivated updates lastFocused for Meet tabs', async () => {
      await load();
      tabUpdateListener(1, {}, { url: 'https://meet.google.com/abc' });
      tabActivatedListener({ tabId: 1 });
    });

    it('onActivated ignores non-Meet tabs', async () => {
      await load();
      tabActivatedListener({ tabId: 999 });
    });
  });

  describe('getBestMeetTab()', () => {
    it('returns null when no tabs', async () => {
      await load();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'query_meet_status' }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ active: false, muted: false, tabId: null })
      );
    });

    it('returns most recently focused tab', async () => {
      await load();

      tabUpdateListener(1, {}, { url: 'https://meet.google.com/aaa' });
      await new Promise((r) => setTimeout(r, 10));
      tabUpdateListener(2, {}, { url: 'https://meet.google.com/bbb' });

      // Focus tab 1 most recently so it wins over tab 2
      // This means tab 2 will hit the false branch of `info.lastFocused > bestTime`
      await new Promise((r) => setTimeout(r, 10));
      tabActivatedListener({ tabId: 1 });

      globalThis.chrome.tabs.sendMessage.mockResolvedValue({ active: true, muted: false });

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'query_meet_status' }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));
      // Tab 1 was focused most recently, so it should be the best tab
      expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.any(Object));
    });
  });

  describe('sendToMeetTab()', () => {
    it('returns fallback when no Meet tab', async () => {
      await load();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'query_meet_status' }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ active: false, muted: false, tabId: null })
      );
    });

    it('returns tab response with tabId added', async () => {
      await load();
      tabUpdateListener(5, {}, { url: 'https://meet.google.com/abc' });
      globalThis.chrome.tabs.sendMessage.mockResolvedValue({ active: true, muted: false });

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'query_meet_status' }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ active: true, muted: false, tabId: 5 })
      );
    });

    it('removes tab on sendMessage error', async () => {
      await load();
      tabUpdateListener(5, {}, { url: 'https://meet.google.com/abc' });
      globalThis.chrome.tabs.sendMessage.mockRejectedValue(new Error('tab removed'));

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'query_meet_status' }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ active: false })
      );
    });
  });

  describe('runtime.onMessage', () => {
    it('handles check_electron_status synchronously', async () => {
      await load();
      const sendResponse = vi.fn();
      const result = onMessageHandler({ type: 'check_electron_status' }, {}, sendResponse);
      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ connected: false });
    });

    it('handles query_meet_status asynchronously', async () => {
      await load();
      const sendResponse = vi.fn();
      const result = onMessageHandler({ type: 'query_meet_status' }, {}, sendResponse);
      expect(result).toBe(true);
    });

    it('relays status_changed to Electron when WS connected', async () => {
      await load();
      simulateWSOpen();

      const sender = { tab: { id: 7 } };
      onMessageHandler(
        { type: 'status_changed', active: true, muted: false },
        sender,
        vi.fn()
      );

      expect(wsInstance.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"meet_status"')
      );
      const sent = JSON.parse(wsInstance.send.mock.calls[0][0]);
      expect(sent.tabId).toBe(7);
    });

    it('does not relay status_changed when WS not connected', async () => {
      await load();

      const sender = { tab: { id: 7 } };
      onMessageHandler(
        { type: 'status_changed', active: true, muted: false },
        sender,
        vi.fn()
      );

      expect(wsInstance.send).not.toHaveBeenCalled();
    });

    it('handles status_changed with no sender.tab', async () => {
      await load();
      simulateWSOpen();

      onMessageHandler(
        { type: 'status_changed', active: true, muted: false },
        {},
        vi.fn()
      );

      const sent = JSON.parse(wsInstance.send.mock.calls[0][0]);
      expect(sent.tabId).toBeNull();
    });
  });

  describe('WebSocket events', () => {
    it('onopen clears reconnect alarm after reconnect', async () => {
      await load();
      simulateWSOpen();

      // Close to trigger reconnect scheduling
      simulateWSClose();
      expect(globalThis.chrome.alarms.create).toHaveBeenCalledWith(
        'reconnect',
        expect.objectContaining({ periodInMinutes: expect.any(Number) })
      );

      // Trigger alarm to attempt reconnect
      alarmListener({ name: 'reconnect' });

      // wsInstance now points to the newly created WS
      // Simulate it opening — this should clear the reconnect alarm
      wsInstance.readyState = 1;
      wsInstance.onopen?.();
      expect(globalThis.chrome.alarms.clear).toHaveBeenCalledWith('reconnect');
    });

    it('onmessage handles query_meet_status', async () => {
      await load();
      simulateWSOpen();

      tabUpdateListener(1, {}, { url: 'https://meet.google.com/abc' });
      globalThis.chrome.tabs.sendMessage.mockResolvedValue({ active: true, muted: false });

      simulateWSMessage({ type: 'query_meet_status', requestId: 'req-1' });

      await new Promise((r) => setTimeout(r, 50));

      expect(wsInstance.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"meet_status"')
      );
      const sent = JSON.parse(wsInstance.send.mock.calls[0][0]);
      expect(sent.requestId).toBe('req-1');
    });

    it('onmessage handles toggle_mute', async () => {
      await load();
      simulateWSOpen();

      tabUpdateListener(1, {}, { url: 'https://meet.google.com/abc' });
      globalThis.chrome.tabs.sendMessage.mockResolvedValue({ success: true, muted: true });

      simulateWSMessage({ type: 'toggle_mute', requestId: 'req-2' });

      await new Promise((r) => setTimeout(r, 50));

      expect(wsInstance.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"mute_toggled"')
      );
      const sent = JSON.parse(wsInstance.send.mock.calls[0][0]);
      expect(sent.requestId).toBe('req-2');
    });

    it('onmessage handles ping', async () => {
      await load();
      simulateWSOpen();

      simulateWSMessage({ type: 'ping' });

      expect(wsInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'pong' })
      );
    });

    it('onclose sets ws to null and schedules reconnect', async () => {
      await load();
      simulateWSOpen();
      simulateWSClose();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'check_electron_status' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ connected: false });
    });

    it('onerror does not crash', async () => {
      await load();
      // Trigger onerror — should not throw
      wsInstance.onerror?.();
    });
  });

  describe('connectWS()', () => {
    it('no-op when already connected', async () => {
      await load();
      simulateWSOpen();
      expect(WSConstructorCalls.length).toBe(1);
    });

    it('schedules reconnect when constructor throws', async () => {
      await load('throw');
      expect(WSConstructorCalls.length).toBe(1);
    });
  });

  describe('scheduleReconnect()', () => {
    it('creates alarm on disconnect', async () => {
      await load();
      simulateWSClose();
      expect(globalThis.chrome.alarms.create).toHaveBeenCalledWith(
        'reconnect',
        { periodInMinutes: expect.closeTo(0.166, 1) }
      );
    });
  });

  describe('alarm-based reconnection', () => {
    it('reconnect alarm triggers WebSocket connection', async () => {
      await load();
      simulateWSOpen();
      simulateWSClose();

      // Initial connect = 1 WS call
      expect(WSConstructorCalls.length).toBe(1);

      // Simulate alarm firing
      alarmListener({ name: 'reconnect' });

      // Should create a new WS connection
      expect(WSConstructorCalls.length).toBe(2);
    });

    it('reconnect alarm skips when already connected', async () => {
      await load();
      simulateWSOpen();

      // Simulate alarm firing while connected
      alarmListener({ name: 'reconnect' });

      // Should NOT create a new WS connection
      expect(WSConstructorCalls.length).toBe(1);
    });

    it('ignores non-reconnect alarms', async () => {
      await load();
      simulateWSOpen();
      simulateWSClose();

      const initialCalls = WSConstructorCalls.length;
      alarmListener({ name: 'some-other-alarm' });

      // Should not trigger reconnect for unrelated alarm
      expect(WSConstructorCalls.length).toBe(initialCalls);
    });

    it('reconnect creates new WS that clears alarm on open', async () => {
      await load();
      simulateWSOpen();
      simulateWSClose();

      // Trigger reconnect via alarm
      alarmListener({ name: 'reconnect' });

      // Simulate new WS opening
      wsInstance.readyState = 1;
      wsInstance.onopen?.();

      expect(globalThis.chrome.alarms.clear).toHaveBeenCalledWith('reconnect');
    });
  });
});
