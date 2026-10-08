import { describe, it, expect, vi, beforeEach } from 'vitest';
import { teamsAdapter } from '../../../extension/platforms/teams';

describe('teamsAdapter', () => {
  beforeEach(() => {
    globalThis.document = {
      querySelector: vi.fn().mockReturnValue(null),
    };
  });

  it('has correct platformId and displayName', () => {
    expect(teamsAdapter.platformId).toBe('teams');
    expect(teamsAdapter.displayName).toBe('Teams');
  });

  it('has correct observedAttributes', () => {
    expect(teamsAdapter.observedAttributes).toEqual(['aria-pressed', 'aria-label', 'class']);
  });

  describe('findMuteButton()', () => {
    it('finds button by id containing microphone-button', () => {
      const btn = { tagName: 'BUTTON' };
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel.includes('microphone-button')) return btn;
        return null;
      });

      expect(teamsAdapter.findMuteButton()).toBe(btn);
    });

    it('returns null when no selector matches', () => {
      expect(teamsAdapter.findMuteButton()).toBeNull();
    });
  });

  describe('isMuted()', () => {
    it('returns true when aria-pressed is true', () => {
      const btn = {
        getAttribute: vi.fn().mockImplementation((attr: string) => {
          if (attr === 'aria-pressed') return 'true';
          return null;
        }),
      } as any;
      expect(teamsAdapter.isMuted(btn)).toBe(true);
    });

    it('returns true when aria-label contains unmute', () => {
      const btn = {
        getAttribute: vi.fn().mockImplementation((attr: string) => {
          if (attr === 'aria-pressed') return 'false';
          if (attr === 'aria-label') return 'Unmute microphone';
          return null;
        }),
      } as any;
      expect(teamsAdapter.isMuted(btn)).toBe(true);
    });

    it('returns false when aria-pressed is false and label says mute', () => {
      const btn = {
        getAttribute: vi.fn().mockImplementation((attr: string) => {
          if (attr === 'aria-pressed') return 'false';
          if (attr === 'aria-label') return 'Mute microphone';
          return null;
        }),
      } as any;
      expect(teamsAdapter.isMuted(btn)).toBe(false);
    });
  });

  describe('isInCall()', () => {
    it('returns true when calling-screen found', () => {
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel === '[data-tid="calling-screen"]') return { tagName: 'DIV' };
        return null;
      });

      expect(teamsAdapter.isInCall()).toBe(true);
    });

    it('returns false when no indicator found', () => {
      expect(teamsAdapter.isInCall()).toBe(false);
    });
  });
});
