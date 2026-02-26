import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mock state ──────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const webContents = {
    executeJavaScript: vi.fn().mockResolvedValue(undefined),
  };
  const winInst = {
    loadURL: vi.fn(),
    showInactive: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
    setPosition: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    isVisible: vi.fn().mockReturnValue(false),
    on: vi.fn(),
    once: vi.fn(),
    webContents,
  };
  const bwConstructorCalls: any[][] = [];
  return { winInst, webContents, bwConstructorCalls };
});

vi.mock('electron', () => {
  function BrowserWindow(...args: any[]) {
    mocks.bwConstructorCalls.push(args);
    return mocks.winInst;
  }
  return {
    BrowserWindow,
    screen: {
      getCursorScreenPoint: vi.fn().mockReturnValue({ x: 500, y: 400 }),
      getDisplayNearestPoint: vi.fn().mockReturnValue({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    },
  };
});

import { showMuteHud, destroyMuteHud } from '../mute-hud';
import { screen } from 'electron';

/** Helper: find the ready-to-show handler registered via winInst.once */
function getReadyHandler(): (() => void) | undefined {
  const call = mocks.winInst.once.mock.calls.find((c: any[]) => c[0] === 'ready-to-show');
  return call?.[1];
}

/** Helper: create window and trigger ready-to-show */
function createAndShow(): void {
  showMuteHud(true);
  getReadyHandler()!();
  vi.clearAllMocks();
  mocks.bwConstructorCalls.length = 0;
  mocks.winInst.isDestroyed.mockReturnValue(false);
}

describe('mute-hud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.bwConstructorCalls.length = 0;
    // Reset isDestroyed BEFORE cleanup so destroyMuteHud() can null out the module state
    mocks.winInst.isDestroyed.mockReturnValue(false);
    destroyMuteHud();
    // Clear mocks again after cleanup call
    vi.clearAllMocks();
    mocks.bwConstructorCalls.length = 0;
    mocks.winInst.isDestroyed.mockReturnValue(false);
    mocks.winInst.isVisible.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('showMuteHud() — first call', () => {
    it('creates BrowserWindow with correct config', () => {
      showMuteHud(true);
      expect(mocks.bwConstructorCalls).toHaveLength(1);
      const opts = mocks.bwConstructorCalls[0][0];
      expect(opts).toMatchObject({
        width: 200,
        height: 200,
        frame: false,
        transparent: true,
        focusable: false,
        hasShadow: false,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
    });

    it('sets always-on-top with screen-saver level', () => {
      showMuteHud(true);
      expect(mocks.winInst.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    });

    it('sets ignore mouse events', () => {
      showMuteHud(true);
      expect(mocks.winInst.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    });

    it('loads HTML data URI with baked-in content', () => {
      showMuteHud(true);
      const url = mocks.winInst.loadURL.mock.calls[0][0];
      expect(url).toContain('data:text/html;charset=utf-8,');
      // Content should be baked into the HTML (Muted label)
      const decoded = decodeURIComponent(url.replace('data:text/html;charset=utf-8,', ''));
      expect(decoded).toContain('Muted');
      expect(decoded).toContain('#F44336'); // red fill for muted icon
    });

    it('bakes unmuted state into HTML when muted=false', () => {
      showMuteHud(false);
      const url = mocks.winInst.loadURL.mock.calls[0][0];
      const decoded = decodeURIComponent(url.replace('data:text/html;charset=utf-8,', ''));
      expect(decoded).toContain('Unmuted');
      expect(decoded).toContain('#4CAF50'); // green fill for unmuted icon
    });

    it('registers ready-to-show handler', () => {
      showMuteHud(true);
      expect(mocks.winInst.once).toHaveBeenCalledWith('ready-to-show', expect.any(Function));
    });

    it('on ready-to-show: positions window and shows', () => {
      showMuteHud(true);
      getReadyHandler()!();

      expect(mocks.winInst.setPosition).toHaveBeenCalled();
      expect(mocks.winInst.showInactive).toHaveBeenCalled();
    });

    it('on ready-to-show: skips if window destroyed', () => {
      showMuteHud(true);
      mocks.winInst.isDestroyed.mockReturnValue(true);
      getReadyHandler()!();

      expect(mocks.winInst.showInactive).not.toHaveBeenCalled();
    });

    it('registers closed handler that clears state', () => {
      showMuteHud(true);
      const closedHandler = mocks.winInst.on.mock.calls.find((c: any[]) => c[0] === 'closed')![1];

      // After 'closed', next showMuteHud should create a new window
      closedHandler();
      vi.clearAllMocks();
      mocks.bwConstructorCalls.length = 0;
      mocks.winInst.isDestroyed.mockReturnValue(false);
      mocks.winInst.isVisible.mockReturnValue(false);

      showMuteHud(true);
      expect(mocks.bwConstructorCalls).toHaveLength(1);
    });
  });

  describe('showMuteHud() — reuse existing window', () => {
    it('reuses window on second call', () => {
      createAndShow();
      mocks.winInst.isVisible.mockReturnValue(false);
      showMuteHud(false);

      // Should NOT create a new BrowserWindow
      expect(mocks.bwConstructorCalls).toHaveLength(0);
      expect(mocks.webContents.executeJavaScript).toHaveBeenCalledWith('update(false)');
      expect(mocks.winInst.showInactive).toHaveBeenCalled();
    });

    it('does not call showInactive when already visible', () => {
      createAndShow();
      mocks.winInst.isVisible.mockReturnValue(true);
      showMuteHud(false);

      expect(mocks.winInst.showInactive).not.toHaveBeenCalled();
    });

    it('repositions on reuse', () => {
      createAndShow();
      mocks.winInst.isVisible.mockReturnValue(true);
      showMuteHud(true);

      expect(mocks.winInst.setPosition).toHaveBeenCalled();
    });

    it('resets visibility after full dismiss cycle (fade-out regression)', () => {
      createAndShow();

      // Let the full dismiss cycle complete: fadeOut at 1500ms, hide at 1500+300ms
      vi.advanceTimersByTime(1500 + 300);
      vi.clearAllMocks();
      mocks.winInst.isDestroyed.mockReturnValue(false);
      mocks.winInst.isVisible.mockReturnValue(false);

      // Show again after dismiss — should call update() which resets the fade-out class
      showMuteHud(true);

      expect(mocks.webContents.executeJavaScript).toHaveBeenCalledWith('update(true)');
      expect(mocks.winInst.showInactive).toHaveBeenCalled();
      // No new BrowserWindow should be created — window is reused
      expect(mocks.bwConstructorCalls).toHaveLength(0);
    });
  });

  describe('positioning', () => {
    it('centers on cursor display workArea', () => {
      vi.mocked(screen.getDisplayNearestPoint).mockReturnValue({
        workArea: { x: 100, y: 50, width: 1600, height: 900 },
      } as any);

      showMuteHud(true);
      getReadyHandler()!();

      // x = 100 + 1600/2 - 200/2 = 100 + 800 - 100 = 800
      // y = 50 + 900/2 - 200/2 = 50 + 450 - 100 = 400
      expect(mocks.winInst.setPosition).toHaveBeenCalledWith(800, 400);
    });

    it('uses getCursorScreenPoint to find display', () => {
      showMuteHud(true);
      getReadyHandler()!();

      expect(screen.getCursorScreenPoint).toHaveBeenCalled();
      expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 500, y: 400 });
    });
  });

  describe('dismiss timer', () => {
    it('calls fadeOut() after 1500ms', () => {
      createAndShow();
      vi.advanceTimersByTime(1500);
      expect(mocks.webContents.executeJavaScript).toHaveBeenCalledWith('fadeOut()');
    });

    it('hides window after fadeOut (1500 + 300ms)', () => {
      createAndShow();
      vi.advanceTimersByTime(1500 + 300);
      expect(mocks.winInst.hide).toHaveBeenCalled();
    });

    it('rapid toggles reset the dismiss timer', () => {
      createAndShow();

      // Advance 1000ms (timer running but not fired yet)
      vi.advanceTimersByTime(1000);
      expect(mocks.webContents.executeJavaScript).not.toHaveBeenCalledWith('fadeOut()');

      // Toggle again — resets timer
      mocks.winInst.isVisible.mockReturnValue(true);
      showMuteHud(false);
      vi.clearAllMocks();
      mocks.winInst.isDestroyed.mockReturnValue(false);

      // Another 1000ms — still no fadeOut (timer was reset)
      vi.advanceTimersByTime(1000);
      expect(mocks.webContents.executeJavaScript).not.toHaveBeenCalledWith('fadeOut()');

      // Full 1500ms from last toggle — now fadeOut fires
      vi.advanceTimersByTime(500);
      expect(mocks.webContents.executeJavaScript).toHaveBeenCalledWith('fadeOut()');
    });

    it('skips fadeOut if window was destroyed mid-timer', () => {
      createAndShow();
      mocks.winInst.isDestroyed.mockReturnValue(true);

      vi.advanceTimersByTime(1500);
      expect(mocks.webContents.executeJavaScript).not.toHaveBeenCalled();
    });

    it('skips hide if window was destroyed during fade-out', () => {
      createAndShow();
      vi.advanceTimersByTime(1500);
      // fadeOut called, now destroy before hide
      mocks.winInst.isDestroyed.mockReturnValue(true);

      vi.advanceTimersByTime(300);
      expect(mocks.winInst.hide).not.toHaveBeenCalled();
    });
  });

  describe('destroyMuteHud()', () => {
    it('destroys existing window', () => {
      showMuteHud(true);
      vi.clearAllMocks();
      mocks.winInst.isDestroyed.mockReturnValue(false);

      destroyMuteHud();
      expect(mocks.winInst.destroy).toHaveBeenCalled();
    });

    it('is safe to call when no window exists', () => {
      expect(() => destroyMuteHud()).not.toThrow();
    });

    it('is safe to call when window already destroyed', () => {
      showMuteHud(true);
      mocks.winInst.isDestroyed.mockReturnValue(true);
      expect(() => destroyMuteHud()).not.toThrow();
      expect(mocks.winInst.destroy).not.toHaveBeenCalled();
    });

    it('clears pending dismiss timer', () => {
      showMuteHud(true);
      getReadyHandler()!();

      // Timer is scheduled; destroy before it fires
      destroyMuteHud();
      vi.clearAllMocks();

      vi.advanceTimersByTime(2000);
      // Neither fadeOut nor hide should be called
      expect(mocks.webContents.executeJavaScript).not.toHaveBeenCalled();
      expect(mocks.winInst.hide).not.toHaveBeenCalled();
    });
  });
});
