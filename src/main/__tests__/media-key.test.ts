import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import Module from 'module';

// Mock native addon
const mockAddon = {
  start: vi.fn().mockReturnValue(true),
  stop: vi.fn(),
  setConsume: vi.fn(),
  isActive: vi.fn().mockReturnValue(false),
  startAudioInput: vi.fn().mockReturnValue(true),
  stopAudioInput: vi.fn(),
};

// Intercept require() calls for the native addon
const originalLoad = (Module as any)._load;

function installAddonMock(behavior: 'prod' | 'dev' | 'none') {
  (Module as any)._load = function (request: string, parent: any, isMain: boolean) {
    if (request.endsWith('media_key_tap.node')) {
      if (behavior === 'none') throw new Error('Cannot find module');
      const isProd = request.includes('resources');
      if (behavior === 'prod' && isProd) return mockAddon;
      if (behavior === 'dev' && !isProd) return mockAddon;
      throw new Error('Cannot find module');
    }
    return originalLoad(request, parent, isMain);
  };
}

function resetAddonMock() {
  (Module as any)._load = originalLoad;
}

// Ensure process.resourcesPath exists (Electron-only property)
if (!(process as any).resourcesPath) {
  (process as any).resourcesPath = '/fake/resources';
}

describe('MediaKeyManager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    Object.values(mockAddon).forEach((fn) => fn.mockClear());
    mockAddon.start.mockReturnValue(true);
    mockAddon.startAudioInput.mockReturnValue(true);
  });

  afterEach(() => {
    resetAddonMock();
  });

  describe('loadAddon()', () => {
    it('loads from prod path first', async () => {
      installAddonMock('prod');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();
      expect(mgr).toBeDefined();
    });

    it('falls back to dev path when prod fails', async () => {
      installAddonMock('dev');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();
      expect(mgr).toBeDefined();
    });

    it('throws when both paths fail', async () => {
      installAddonMock('none');
      const { MediaKeyManager } = await import('../media-key');
      expect(() => new MediaKeyManager()).toThrow();
    });
  });

  describe('start()', () => {
    it('starts and emits media-key on keyDown=true', async () => {
      installAddonMock('dev');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();

      mockAddon.start.mockImplementation((cb: any) => {
        // Simulate a key event
        cb('play_pause', true);
        return true;
      });

      const events: any[] = [];
      mgr.on('media-key', (e) => events.push(e));

      const result = mgr.start();
      expect(result).toBe(true);
      expect(events).toEqual([{ key: 'play_pause' }]);
    });

    it('ignores keyDown=false events', async () => {
      installAddonMock('dev');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();

      mockAddon.start.mockImplementation((cb: any) => {
        cb('play_pause', false);
        return true;
      });

      const events: any[] = [];
      mgr.on('media-key', (e) => events.push(e));

      mgr.start();
      expect(events).toEqual([]);
    });

    it('returns true and skips when already running', async () => {
      installAddonMock('dev');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();

      mockAddon.start.mockReturnValue(true);
      mgr.start();
      mockAddon.start.mockClear();

      const result = mgr.start();
      expect(result).toBe(true);
      expect(mockAddon.start).not.toHaveBeenCalled();
    });

    it('emits error and returns false when addon throws', async () => {
      installAddonMock('dev');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();

      const err = new Error('tap failed');
      mockAddon.start.mockImplementation(() => {
        throw err;
      });

      const errors: any[] = [];
      mgr.on('error', (e) => errors.push(e));

      const result = mgr.start();
      expect(result).toBe(false);
      expect(errors).toEqual([err]);
    });
  });

  describe('stop()', () => {
    it('stops when running', async () => {
      installAddonMock('dev');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();

      mockAddon.start.mockReturnValue(true);
      mgr.start();
      mgr.stop();
      expect(mockAddon.stop).toHaveBeenCalledOnce();
    });

    it('no-op when not running', async () => {
      installAddonMock('dev');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();

      mgr.stop();
      expect(mockAddon.stop).not.toHaveBeenCalled();
    });
  });

  describe('setConsume()', () => {
    it('delegates to addon', async () => {
      installAddonMock('dev');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();

      mgr.setConsume(true);
      expect(mockAddon.setConsume).toHaveBeenCalledWith(true);

      mgr.setConsume(false);
      expect(mockAddon.setConsume).toHaveBeenCalledWith(false);
    });
  });

  describe('startAudioInput()', () => {
    it('returns true on success', async () => {
      installAddonMock('dev');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();

      mockAddon.startAudioInput.mockReturnValue(true);
      expect(mgr.startAudioInput()).toBe(true);
    });

    it('returns false when addon throws', async () => {
      installAddonMock('dev');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();

      mockAddon.startAudioInput.mockImplementation(() => {
        throw new Error('no mic');
      });
      expect(mgr.startAudioInput()).toBe(false);
    });
  });

  describe('stopAudioInput()', () => {
    it('calls addon on success', async () => {
      installAddonMock('dev');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();

      mgr.stopAudioInput();
      expect(mockAddon.stopAudioInput).toHaveBeenCalledOnce();
    });

    it('logs error when addon throws', async () => {
      installAddonMock('dev');
      const { MediaKeyManager } = await import('../media-key');
      const mgr = new MediaKeyManager();

      mockAddon.stopAudioInput.mockImplementation(() => {
        throw new Error('fail');
      });
      // Should not throw
      mgr.stopAudioInput();
      expect(mockAddon.stopAudioInput).toHaveBeenCalledOnce();
    });
  });
});
