import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zoomAdapter } from '../../../extension/platforms/zoom';

describe('zoomAdapter', () => {
  beforeEach(() => {
    globalThis.document = {
      querySelector: vi.fn().mockReturnValue(null),
    };
  });

  it('has correct platformId and displayName', () => {
    expect(zoomAdapter.platformId).toBe('zoom');
    expect(zoomAdapter.displayName).toBe('Zoom');
  });

  it('has correct observedAttributes', () => {
    expect(zoomAdapter.observedAttributes).toEqual(['aria-label', 'class']);
  });

  describe('findMuteButton()', () => {
    it('finds button matching mute selector', () => {
      const btn = { tagName: 'BUTTON' };
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel.includes('mute')) return btn;
        return null;
      });

      expect(zoomAdapter.findMuteButton()).toBe(btn);
    });

    it('returns null when no selector matches', () => {
      expect(zoomAdapter.findMuteButton()).toBeNull();
    });
  });

  describe('isMuted()', () => {
    it('returns true when aria-label contains unmute', () => {
      const btn = { getAttribute: vi.fn().mockReturnValue('Unmute audio') } as any;
      expect(zoomAdapter.isMuted(btn)).toBe(true);
    });

    it('returns false when aria-label says mute (not unmute)', () => {
      const btn = { getAttribute: vi.fn().mockReturnValue('Mute audio') } as any;
      expect(zoomAdapter.isMuted(btn)).toBe(false);
    });

    it('returns false when aria-label is null', () => {
      const btn = { getAttribute: vi.fn().mockReturnValue(null) } as any;
      expect(zoomAdapter.isMuted(btn)).toBe(false);
    });
  });

  describe('isInCall()', () => {
    it('returns true when meeting-app found', () => {
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel === '.meeting-app') return { tagName: 'DIV' };
        return null;
      });

      expect(zoomAdapter.isInCall()).toBe(true);
    });

    it('returns false when no indicator found', () => {
      expect(zoomAdapter.isInCall()).toBe(false);
    });
  });
});
