import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('popup.ts', () => {
  let elements: Record<string, any>;

  beforeEach(() => {
    elements = {
      'dot-electron': { className: '', textContent: '' },
      'badge-electron': { className: '', textContent: '' },
      'dot-meet': { className: '', textContent: '' },
      'badge-meet': { className: '', textContent: '' },
      'dot-mic': { className: '', textContent: '' },
      'badge-mic': { className: '', textContent: '' },
      'row-mic': {
        className: '',
        textContent: '',
        style: {},
        classList: { add: vi.fn(), remove: vi.fn() },
        addEventListener: vi.fn(),
      },
      'toggle-hint': { className: '', textContent: '', style: {} },
      'version-label': { className: '', textContent: '' },
      'tabs-section': { style: { display: 'none' }, className: '', textContent: '' },
      'tabs-count': { className: '', textContent: '' },
      'tabs-list': { innerHTML: '', children: [], appendChild: vi.fn() },
    };

    globalThis.document = {
      getElementById: vi.fn((id: string) => elements[id]),
      createElement: vi.fn((tag: string) => ({
        tagName: tag.toUpperCase(),
        className: '',
        textContent: '',
        title: '',
        innerHTML: '',
        style: {},
        children: [],
        appendChild: vi.fn(),
        addEventListener: vi.fn(),
      })),
    };

    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(),
        getManifest: vi.fn(() => ({ version: '0.2.0' })),
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
        .mockResolvedValueOnce({ tabs: [], pinnedTabId: null });

      await loadPopup();

      expect(elements['dot-electron'].className).toBe('status-dot green');
      expect(elements['badge-electron'].textContent).toBe('Connected');
    });

    it('shows offline state when false', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce({ connected: false })
        .mockResolvedValueOnce({ tabs: [], pinnedTabId: null });

      await loadPopup();

      expect(elements['dot-electron'].className).toBe('status-dot red');
      expect(elements['badge-electron'].textContent).toBe('Offline');
    });

    it('shows offline on sendMessage error', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockRejectedValueOnce(new Error('no response'))
        .mockResolvedValueOnce({ tabs: [], pinnedTabId: null });

      await loadPopup();

      expect(elements['dot-electron'].className).toBe('status-dot red');
      expect(elements['badge-electron'].textContent).toBe('Offline');
    });

    it('shows offline on null response', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ tabs: [], pinnedTabId: null });

      await loadPopup();

      expect(elements['dot-electron'].className).toBe('status-dot red');
      expect(elements['badge-electron'].textContent).toBe('Offline');
    });
  });

  describe('setMeetStatus', () => {
    it('shows no call when no active tabs', async () => {
      globalThis.chrome.runtime.sendMessage.mockResolvedValueOnce({ connected: true }).mockResolvedValueOnce({
        tabs: [{ tabId: 1, title: 'Meet', url: 'https://meet.google.com/abc', active: false, muted: false }],
        pinnedTabId: null,
      });

      await loadPopup();

      expect(elements['dot-meet'].className).toBe('status-dot dim');
      expect(elements['badge-meet'].textContent).toBe('No call');
      expect(elements['dot-mic'].className).toBe('status-dot dim');
      expect(elements['badge-mic'].textContent).toBe('--');
    });

    it('shows mic ON when active and not muted', async () => {
      globalThis.chrome.runtime.sendMessage.mockResolvedValueOnce({ connected: true }).mockResolvedValueOnce({
        tabs: [{ tabId: 1, title: 'Meet', url: 'https://meet.google.com/abc', active: true, muted: false }],
        pinnedTabId: null,
      });

      await loadPopup();

      expect(elements['dot-meet'].className).toBe('status-dot green');
      expect(elements['badge-meet'].textContent).toBe('In call');
      expect(elements['dot-mic'].className).toBe('status-dot green');
      expect(elements['badge-mic'].textContent).toBe('Mic ON');
    });

    it('shows muted when active and muted', async () => {
      globalThis.chrome.runtime.sendMessage.mockResolvedValueOnce({ connected: true }).mockResolvedValueOnce({
        tabs: [{ tabId: 1, title: 'Meet', url: 'https://meet.google.com/abc', active: true, muted: true }],
        pinnedTabId: null,
      });

      await loadPopup();

      expect(elements['dot-mic'].className).toBe('status-dot red');
      expect(elements['badge-mic'].textContent).toBe('Muted');
    });

    it('shows no call when tabs list is empty', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce({ connected: true })
        .mockResolvedValueOnce({ tabs: [], pinnedTabId: null });

      await loadPopup();

      expect(elements['dot-meet'].className).toBe('status-dot dim');
      expect(elements['badge-meet'].textContent).toBe('No call');
    });

    it('handles get_tab_list error', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce({ connected: true })
        .mockRejectedValueOnce(new Error('no meet'));

      await loadPopup();

      // Should not crash — meet status stays at initial state
      expect(elements['dot-meet'].className).toBe('');
    });

    it('uses pinned tab for status when available', async () => {
      globalThis.chrome.runtime.sendMessage.mockResolvedValueOnce({ connected: true }).mockResolvedValueOnce({
        tabs: [
          { tabId: 1, title: 'Meet A', url: 'https://meet.google.com/aaa', active: true, muted: false },
          { tabId: 2, title: 'Meet B', url: 'https://meet.google.com/bbb', active: true, muted: true },
        ],
        pinnedTabId: 2,
      });

      await loadPopup();

      // Should show status of pinned tab (tab 2: muted)
      expect(elements['dot-mic'].className).toBe('status-dot red');
      expect(elements['badge-mic'].textContent).toBe('Muted');
    });

    it('hides tabs section when no tabs', async () => {
      globalThis.chrome.runtime.sendMessage
        .mockResolvedValueOnce({ connected: true })
        .mockResolvedValueOnce({ tabs: [], pinnedTabId: null });

      await loadPopup();

      expect(elements['tabs-section'].style.display).toBe('none');
    });

    it('shows tabs section when tabs exist', async () => {
      globalThis.chrome.runtime.sendMessage.mockResolvedValueOnce({ connected: true }).mockResolvedValueOnce({
        tabs: [{ tabId: 1, title: 'Meet', url: 'https://meet.google.com/abc', active: false, muted: false }],
        pinnedTabId: null,
      });

      await loadPopup();

      expect(elements['tabs-section'].style.display).toBe('');
      expect(elements['tabs-count'].textContent).toBe('1');
    });
  });
});
