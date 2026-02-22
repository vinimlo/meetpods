import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('popup.ts', () => {
  let elements: Record<string, { className: string; textContent: string }>;

  beforeEach(() => {
    elements = {
      'dot-electron': { className: '', textContent: '' },
      'badge-electron': { className: '', textContent: '' },
      'dot-meet': { className: '', textContent: '' },
      'badge-meet': { className: '', textContent: '' },
      'dot-mic': { className: '', textContent: '' },
      'badge-mic': { className: '', textContent: '' },
    };

    globalThis.document = {
      getElementById: vi.fn((id: string) => elements[id]),
    };

    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(),
      },
    };
  });

  afterEach(() => {
    delete globalThis.document;
    delete globalThis.chrome;
    vi.resetModules();
  });

  async function loadPopup() {
    await import('../../extension/popup.ts');
    // Wait for async checks to complete
    await new Promise((r) => setTimeout(r, 50));
  }

  describe('setElectronStatus', () => {
    it('shows connected state when true', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce({ connected: true })
        .mockResolvedValueOnce({ active: false, muted: false });

      await loadPopup();

      expect(elements['dot-electron'].className).toBe('status-dot green');
      expect(elements['badge-electron'].textContent).toBe('Connected');
    });

    it('shows offline state when false', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce({ connected: false })
        .mockResolvedValueOnce({ active: false, muted: false });

      await loadPopup();

      expect(elements['dot-electron'].className).toBe('status-dot red');
      expect(elements['badge-electron'].textContent).toBe('Offline');
    });

    it('shows offline on sendMessage error', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockRejectedValueOnce(new Error('no response'))
        .mockResolvedValueOnce({ active: false, muted: false });

      await loadPopup();

      expect(elements['dot-electron'].className).toBe('status-dot red');
      expect(elements['badge-electron'].textContent).toBe('Offline');
    });

    it('shows offline on null response', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ active: false, muted: false });

      await loadPopup();

      expect(elements['dot-electron'].className).toBe('status-dot red');
      expect(elements['badge-electron'].textContent).toBe('Offline');
    });
  });

  describe('setMeetStatus', () => {
    it('shows no call when not active', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce({ connected: true })
        .mockResolvedValueOnce({ active: false, muted: false });

      await loadPopup();

      expect(elements['dot-meet'].className).toBe('status-dot dim');
      expect(elements['badge-meet'].textContent).toBe('No call');
      expect(elements['dot-mic'].className).toBe('status-dot dim');
      expect(elements['badge-mic'].textContent).toBe('--');
    });

    it('shows mic ON when active and not muted', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce({ connected: true })
        .mockResolvedValueOnce({ active: true, muted: false });

      await loadPopup();

      expect(elements['dot-meet'].className).toBe('status-dot green');
      expect(elements['badge-meet'].textContent).toBe('In call');
      expect(elements['dot-mic'].className).toBe('status-dot green');
      expect(elements['badge-mic'].textContent).toBe('Mic ON');
    });

    it('shows muted when active and muted', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce({ connected: true })
        .mockResolvedValueOnce({ active: true, muted: true });

      await loadPopup();

      expect(elements['dot-mic'].className).toBe('status-dot red');
      expect(elements['badge-mic'].textContent).toBe('Muted');
    });

    it('handles undefined active in response', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce({ connected: true })
        .mockResolvedValueOnce({});

      await loadPopup();

      // active is undefined — setMeetStatus not called
      expect(elements['dot-meet'].className).toBe('');
    });

    it('handles query_meet_status error', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce({ connected: true })
        .mockRejectedValueOnce(new Error('no meet'));

      await loadPopup();

      // Should not crash
      expect(elements['dot-meet'].className).toBe('');
    });
  });
});
