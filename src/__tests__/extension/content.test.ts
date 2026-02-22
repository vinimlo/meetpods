import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('content.ts', () => {
  let onMessageHandler: any;
  let mutationCallback: any;
  let mockObserverInstance: any;

  beforeEach(() => {
    onMessageHandler = null;
    mutationCallback = null;

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
      location: { href: 'https://meet.google.com/abc-defg-hij' },
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

  describe('findMuteButton()', () => {
    it('finds first matching selector', async () => {
      const btn = { getAttribute: vi.fn().mockReturnValue('false'), click: vi.fn() };
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel.includes('microphone')) return btn;
        return null;
      });

      await loadContent();
      expect(globalThis.document.querySelector).toHaveBeenCalled();
    });

    it('returns null when no selector matches', async () => {
      globalThis.document.querySelector.mockReturnValue(null);
      await loadContent();
      expect(globalThis.document.querySelector).toHaveBeenCalled();
    });
  });

  describe('checkCallStatus()', () => {
    it('detects muted state from button', async () => {
      const btn = { getAttribute: vi.fn().mockReturnValue('true'), click: vi.fn() };
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel.includes('microphone')) return btn;
        return null;
      });

      await loadContent();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'get_status' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ active: true, muted: true });
    });

    it('detects unmuted state from button', async () => {
      const btn = { getAttribute: vi.fn().mockReturnValue('false'), click: vi.fn() };
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel.includes('microphone')) return btn;
        return null;
      });

      await loadContent();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'get_status' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ active: true, muted: false });
    });

    it('detects call via CALL_INDICATORS when no mute button', async () => {
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel === '[data-call-ended]') return { tagName: 'DIV' };
        return null;
      });

      await loadContent();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'get_status' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ active: true, muted: false });
    });

    it('detects no call when nothing matches', async () => {
      globalThis.document.querySelector.mockReturnValue(null);
      await loadContent();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'get_status' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ active: false, muted: false });
    });
  });

  describe('toggleMute()', () => {
    it('clicks button and returns result after delay', async () => {
      const btn = { getAttribute: vi.fn().mockReturnValue('false'), click: vi.fn() };
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel.includes('microphone')) return btn;
        return null;
      });

      await loadContent();

      const sendResponse = vi.fn();
      const result = onMessageHandler({ type: 'toggle_mute' }, {}, sendResponse);
      expect(result).toBe(true);

      await new Promise((r) => setTimeout(r, 150));

      expect(btn.click).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('returns error when no mute button found', async () => {
      globalThis.document.querySelector.mockReturnValue(null);
      await loadContent();

      const sendResponse = vi.fn();
      onMessageHandler({ type: 'toggle_mute' }, {}, sendResponse);

      await new Promise((r) => setTimeout(r, 50));

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'Mute button not found' })
      );
    });
  });

  describe('onMessage handler', () => {
    it('handles get_status synchronously', async () => {
      globalThis.document.querySelector.mockReturnValue(null);
      await loadContent();

      const sendResponse = vi.fn();
      const result = onMessageHandler({ type: 'get_status' }, {}, sendResponse);
      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalled();
    });

    it('handles toggle_mute asynchronously', async () => {
      globalThis.document.querySelector.mockReturnValue(null);
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
      globalThis.document.querySelector.mockReturnValue(null);
      await loadContent();

      // Now simulate a mute button appearing
      const btn = { getAttribute: vi.fn().mockReturnValue('true'), click: vi.fn() };
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel.includes('microphone')) return btn;
        return null;
      });

      mutationCallback();

      expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status_changed',
          active: true,
          muted: true,
        })
      );
    });

    it('does not send when status unchanged', async () => {
      globalThis.document.querySelector.mockReturnValue(null);
      await loadContent();

      globalThis.chrome.runtime.sendMessage.mockClear();
      mutationCallback();

      expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('handles sendMessage error gracefully', async () => {
      globalThis.document.querySelector.mockReturnValue(null);
      await loadContent();

      globalThis.chrome.runtime.sendMessage.mockRejectedValue(new Error('disconnected'));

      const btn = { getAttribute: vi.fn().mockReturnValue('false'), click: vi.fn() };
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel.includes('microphone')) return btn;
        return null;
      });

      // Should not throw
      mutationCallback();
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  describe('startObserving()', () => {
    it('creates MutationObserver on load', async () => {
      await loadContent();
      expect(mockObserverInstance.observe).toHaveBeenCalledWith(
        globalThis.document.body,
        expect.objectContaining({ childList: true, subtree: true })
      );
    });
  });
});
