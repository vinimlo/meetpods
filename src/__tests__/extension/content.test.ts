import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockDetectPlatform = vi.hoisted(() => vi.fn());

vi.mock('../../extension/platforms/registry', () => ({
  detectPlatform: mockDetectPlatform,
}));

describe('content.ts', () => {
  let onMessageHandler: any;
  let mutationCallback: any;
  let mockObserverInstance: any;
  let mockAdapter: any;

  beforeEach(() => {
    onMessageHandler = null;
    mutationCallback = null;

    mockAdapter = {
      platformId: 'meet',
      displayName: 'Google Meet',
      muteButtonSelectors: [
        'button[data-is-muted][aria-label*="microphone" i]',
        'button[data-is-muted][aria-label*="microfone" i]',
      ],
      callIndicators: ['[data-call-ended]', 'button[data-is-muted]', '[data-meeting-title]'],
      observedAttributes: ['data-is-muted', 'aria-label'],
      findMuteButton: vi.fn().mockReturnValue(null),
      isMuted: vi.fn().mockReturnValue(false),
      isInCall: vi.fn().mockReturnValue(false),
    };

    mockDetectPlatform.mockReturnValue(mockAdapter);

    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: {
          addListener: vi.fn((handler: any) => {
            onMessageHandler = handler;
          }),
        },
      },
    };

    globalThis.window = {
      location: { href: 'https://meet.google.com/abc-defg-hij', hostname: 'meet.google.com' },
    };

    globalThis.document = {
      querySelector: vi.fn().mockReturnValue(null),
      body: { tagName: 'BODY' },
    };

    mockObserverInstance = {
      observe: vi.fn(),
      disconnect: vi.fn(),
    };

    globalThis.MutationObserver = function MutationObserver(cb: any) {
      mutationCallback = cb;
      return mockObserverInstance;
    };
  });

  afterEach(() => {
    delete globalThis.chrome;
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.MutationObserver;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function loadContent() {
    await import('../../extension/content.ts');
  }

  describe('platform detection', () => {
    it('exits early when no adapter matches', async () => {
      mockDetectPlatform.mockReturnValue(null);

      await loadContent();
      expect(globalThis.chrome.runtime.onMessage.addListener).not.toHaveBeenCalled();
    });
  });

  describe('findMuteButton()', () => {
    it('delegates to adapter.findMuteButton()', async () => {
      const btn = { getAttribute: vi.fn().mockReturnValue('false'), click: vi.fn() };
      mockAdapter.findMuteButton.mockReturnValue(btn);
      mockAdapter.isMuted.mockReturnValue(false);

      await loadContent();
      expect(mockAdapter.findMuteButton).toHaveBeenCalled();
    });

    it('returns null when adapter finds no button', async () => {
      mockAdapter.findMuteButton.mockReturnValue(null);
      mockAdapter.isInCall.mockReturnValue(false);

      await loadContent();
      expect(mockAdapter.findMuteButton).toHaveBeenCalled();
    });
  });

  describe('checkCallStatus()', () => {
    it('detects muted state from adapter', async () => {
      const btn = { getAttribute: vi.fn(), click: vi.fn() };
      mockAdapter.findMuteButton.mockReturnValue(btn);
      mockAdapter.isMuted.mockReturnValue(true);

      await loadContent();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'get_status' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ active: true, muted: true });
    });

    it('detects unmuted state from adapter', async () => {
      const btn = { getAttribute: vi.fn(), click: vi.fn() };
      mockAdapter.findMuteButton.mockReturnValue(btn);
      mockAdapter.isMuted.mockReturnValue(false);

      await loadContent();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'get_status' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ active: true, muted: false });
    });

    it('detects call via adapter.isInCall() when no mute button', async () => {
      mockAdapter.findMuteButton.mockReturnValue(null);
      mockAdapter.isInCall.mockReturnValue(true);

      await loadContent();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'get_status' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ active: true, muted: false });
    });

    it('detects no call when nothing matches', async () => {
      mockAdapter.findMuteButton.mockReturnValue(null);
      mockAdapter.isInCall.mockReturnValue(false);

      await loadContent();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'get_status' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ active: false, muted: false });
    });
  });

  describe('toggleMute()', () => {
    it('clicks button and returns result after delay', async () => {
      const btn = { getAttribute: vi.fn(), click: vi.fn() };
      mockAdapter.findMuteButton.mockReturnValue(btn);
      mockAdapter.isMuted.mockReturnValue(false);

      await loadContent();

      const sendResponse = vi.fn();
      const result = onMessageHandler({ type: 'toggle_mute' }, {}, sendResponse);
      expect(result).toBe(true);

      await new Promise((r) => setTimeout(r, 150));

      expect(btn.click).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('returns error when no mute button found', async () => {
      mockAdapter.findMuteButton.mockReturnValue(null);
      mockAdapter.isInCall.mockReturnValue(false);

      await loadContent();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'toggle_mute' }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'Mute button not found' }),
      );
    });
  });

  describe('onMessage handler', () => {
    it('handles get_status synchronously', async () => {
      mockAdapter.findMuteButton.mockReturnValue(null);
      mockAdapter.isInCall.mockReturnValue(false);

      await loadContent();

      const sendResponse = vi.fn();
      const result = onMessageHandler({ type: 'get_status' }, {}, sendResponse);
      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalled();
    });

    it('handles toggle_mute asynchronously', async () => {
      mockAdapter.findMuteButton.mockReturnValue(null);
      mockAdapter.isInCall.mockReturnValue(false);

      await loadContent();

      const sendResponse = vi.fn();
      const result = onMessageHandler({ type: 'toggle_mute' }, {}, sendResponse);
      expect(result).toBe(true);
    });

    it('returns undefined for unknown message type', async () => {
      await loadContent();

      const sendResponse = vi.fn();
      const result = onMessageHandler({ type: 'unknown' }, {}, sendResponse);
      expect(result).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });

  describe('pushStatusChange()', () => {
    it('sends status_changed when status changes', async () => {
      mockAdapter.findMuteButton.mockReturnValue(null);
      mockAdapter.isInCall.mockReturnValue(false);

      await loadContent();

      // Now simulate a mute button appearing
      const btn = { getAttribute: vi.fn(), click: vi.fn() };
      mockAdapter.findMuteButton.mockReturnValue(btn);
      mockAdapter.isMuted.mockReturnValue(true);

      mutationCallback();

      expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status_changed',
          active: true,
          muted: true,
        }),
      );
    });

    // A new document (reload, or Meet sending the left-call page to /home) gets a fresh
    // content script whose initial state is "not in call" — it must say so, otherwise the
    // previous document's active=true stays in the background and Electron forever.
    it.each([
      [false, false],
      [true, true],
    ])('reports its initial status on load (active=%s)', async (active, muted) => {
      mockAdapter.findMuteButton.mockReturnValue(active ? { getAttribute: vi.fn(), click: vi.fn() } : null);
      mockAdapter.isMuted.mockReturnValue(muted);
      mockAdapter.isInCall.mockReturnValue(false);

      await loadContent();

      expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'status_changed', active, muted });
    });

    it('does not send when status unchanged', async () => {
      mockAdapter.findMuteButton.mockReturnValue(null);
      mockAdapter.isInCall.mockReturnValue(false);

      await loadContent();

      globalThis.chrome.runtime.sendMessage.mockClear();
      mutationCallback();

      expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('handles sendMessage error gracefully', async () => {
      mockAdapter.findMuteButton.mockReturnValue(null);
      mockAdapter.isInCall.mockReturnValue(false);

      await loadContent();

      globalThis.chrome.runtime.sendMessage.mockRejectedValue(new Error('disconnected'));

      const btn = { getAttribute: vi.fn(), click: vi.fn() };
      mockAdapter.findMuteButton.mockReturnValue(btn);
      mockAdapter.isMuted.mockReturnValue(false);

      // Should not throw
      mutationCallback();
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  describe('startObserving()', () => {
    it('creates MutationObserver on load with adapter attributes', async () => {
      await loadContent();
      expect(mockObserverInstance.observe).toHaveBeenCalledWith(
        globalThis.document.body,
        expect.objectContaining({
          childList: true,
          subtree: true,
          attributeFilter: ['data-is-muted', 'aria-label'],
        }),
      );
    });
  });
});
