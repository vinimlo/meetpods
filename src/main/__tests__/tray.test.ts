import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock state (vi.hoisted so they exist when vi.mock runs)
const mocks = vi.hoisted(() => {
  const trayInst = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    setImage: vi.fn(),
    destroy: vi.fn(),
  };
  const menuTemplate: any[] = [];
  return { trayInst, menuTemplate };
});

vi.mock('electron', () => {
  // Tray must be a regular function so `new Tray(...)` works
  function Tray() {
    return mocks.trayInst;
  }
  return {
    Tray,
    Menu: {
      buildFromTemplate: vi.fn((template: any[]) => {
        mocks.menuTemplate.length = 0;
        mocks.menuTemplate.push(...template);
        return { items: template };
      }),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({
        setTemplateImage: vi.fn(),
      })),
      createEmpty: vi.fn(() => ({ empty: true })),
    },
    app: {
      isPackaged: false,
      getVersion: vi.fn(() => '0.1.0'),
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
      setLoginItemSettings: vi.fn(),
      quit: vi.fn(),
    },
  };
});

import { MeetPodsTray } from '../tray';
import { nativeImage, app } from 'electron';

describe('MeetPodsTray', () => {
  let tray: MeetPodsTray;
  let toggleCallback: ReturnType<typeof vi.fn<(enabled: boolean) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    toggleCallback = vi.fn<(enabled: boolean) => void>();
    tray = new MeetPodsTray(toggleCallback);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates Tray with idle icon, sets tooltip, builds menu', () => {
      expect(mocks.trayInst.setToolTip).toHaveBeenCalledWith('MeetPods');
      expect(mocks.trayInst.setContextMenu).toHaveBeenCalled();
    });
  });

  describe('getIcon()', () => {
    it('uses correct icon names for each state', () => {
      expect(nativeImage.createFromPath).toHaveBeenCalledWith(expect.stringContaining('tray-icon.png'));

      tray.setState('in-call');
      expect(nativeImage.createFromPath).toHaveBeenCalledWith(expect.stringContaining('tray-icon-active.png'));

      tray.setState('muted');
      expect(nativeImage.createFromPath).toHaveBeenCalledWith(expect.stringContaining('tray-icon-muted.png'));
    });

    it('uses dev path when not packaged', () => {
      tray.setState('idle');
      expect(nativeImage.createFromPath).toHaveBeenCalledWith(expect.stringContaining('assets/tray-icon.png'));
    });

    it('uses prod path when packaged', () => {
      (app as any).isPackaged = true;
      const origPath = (process as any).resourcesPath;
      (process as any).resourcesPath = '/app/resources';

      tray.setState('idle');
      expect(nativeImage.createFromPath).toHaveBeenCalledWith('/app/resources/assets/tray-icon.png');

      (app as any).isPackaged = false;
      (process as any).resourcesPath = origPath;
    });

    it('returns empty image when createFromPath throws', () => {
      vi.mocked(nativeImage.createFromPath).mockImplementation(() => {
        throw new Error('file not found');
      });

      tray.setState('idle');
      expect(nativeImage.createEmpty).toHaveBeenCalled();
    });
  });

  describe('getStatusText()', () => {
    it('shows correct text for each state', () => {
      const getStatusLabel = () => mocks.menuTemplate[0]?.label;

      tray.setState('idle');
      expect(getStatusLabel()).toBe('No active call');

      tray.setState('in-call');
      expect(getStatusLabel()).toBe('In call — mic ON');

      tray.setState('muted');
      expect(getStatusLabel()).toBe('In call — MUTED');
    });

    it('shows Disabled when toggled off', () => {
      const activeItem = mocks.menuTemplate.find((item: any) => item.label === 'Active');
      activeItem.click();

      const statusLabel = mocks.menuTemplate[0]?.label;
      expect(statusLabel).toBe('Disabled');
    });
  });

  describe('setState()', () => {
    it('updates icon and rebuilds menu', () => {
      vi.clearAllMocks();
      tray.setState('muted');

      expect(mocks.trayInst.setImage).toHaveBeenCalled();
      expect(mocks.trayInst.setContextMenu).toHaveBeenCalled();
    });
  });

  describe('flash()', () => {
    it('temporarily shows idle icon then restores', () => {
      vi.useFakeTimers();
      tray.setState('muted');
      vi.clearAllMocks();

      tray.flash();
      expect(mocks.trayInst.setImage).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(200);
      expect(mocks.trayInst.setImage).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('destroy()', () => {
    it('calls tray.destroy()', () => {
      tray.destroy();
      expect(mocks.trayInst.destroy).toHaveBeenCalledOnce();
    });
  });

  describe('menu items', () => {
    it('Active checkbox toggles enabled state and calls callback', () => {
      const activeItem = mocks.menuTemplate.find((item: any) => item.label === 'Active');
      expect(activeItem.checked).toBe(true);

      activeItem.click();
      expect(toggleCallback).toHaveBeenCalledWith(false);

      const activeItem2 = mocks.menuTemplate.find((item: any) => item.label === 'Active');
      activeItem2.click();
      expect(toggleCallback).toHaveBeenCalledWith(true);
    });

    it('Open at Login toggles app login settings', () => {
      const loginItem = mocks.menuTemplate.find((item: any) => item.label === 'Open at Login');
      loginItem.click({ checked: true });
      expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    });

    it('Quit calls app.quit()', () => {
      const quitItem = mocks.menuTemplate.find((item: any) => item.label === 'Quit');
      quitItem.click();
      expect(app.quit).toHaveBeenCalledOnce();
    });

    it('Test Sound calls onTestSound handler', () => {
      const handler = vi.fn();
      tray.setOnTestSound(handler);
      // Force menu rebuild to pick up handler
      tray.setState('idle');

      const testSoundItem = mocks.menuTemplate.find((item: any) => item.label === 'Test Sound');
      expect(testSoundItem).toBeDefined();
      testSoundItem.click();
      expect(handler).toHaveBeenCalledOnce();
    });

    it('Test Sound is safe to click without handler', () => {
      const testSoundItem = mocks.menuTemplate.find((item: any) => item.label === 'Test Sound');
      expect(testSoundItem).toBeDefined();
      expect(() => testSoundItem.click()).not.toThrow();
    });

    it('Show Mute HUD checkbox is present and checked by default', () => {
      const hudItem = mocks.menuTemplate.find((item: any) => item.label === 'Show Mute HUD');
      expect(hudItem).toBeDefined();
      expect(hudItem.type).toBe('checkbox');
      expect(hudItem.checked).toBe(true);
    });

    it('Show Mute HUD click toggles state and calls callback', () => {
      const handler = vi.fn();
      tray.setOnShowMuteHudChanged(handler);
      // Rebuild menu to pick up handler
      tray.setState('idle');

      const hudItem = mocks.menuTemplate.find((item: any) => item.label === 'Show Mute HUD');
      hudItem.click();

      expect(handler).toHaveBeenCalledWith(false);

      // Click again to re-enable
      const hudItem2 = mocks.menuTemplate.find((item: any) => item.label === 'Show Mute HUD');
      hudItem2.click();
      expect(handler).toHaveBeenCalledWith(true);
    });

    it('Show Mute HUD is safe to click without handler', () => {
      const hudItem = mocks.menuTemplate.find((item: any) => item.label === 'Show Mute HUD');
      expect(() => hudItem.click()).not.toThrow();
    });

    it('setShowMuteHud() updates menu checkbox state', () => {
      tray.setShowMuteHud(false);
      const hudItem = mocks.menuTemplate.find((item: any) => item.label === 'Show Mute HUD');
      expect(hudItem.checked).toBe(false);
    });
  });
});
