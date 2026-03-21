import { describe, it, expect, vi, beforeEach } from 'vitest';
import { meetAdapter } from '../../../extension/platforms/meet';

describe('meetAdapter', () => {
  beforeEach(() => {
    globalThis.document = {
      querySelector: vi.fn().mockReturnValue(null),
    };
  });

  it('has correct platformId and displayName', () => {
    expect(meetAdapter.platformId).toBe('meet');
    expect(meetAdapter.displayName).toBe('Google Meet');
  });

  it('has correct observedAttributes', () => {
    expect(meetAdapter.observedAttributes).toEqual(['data-is-muted', 'aria-label']);
  });

  describe('findMuteButton()', () => {
    it('finds button matching first selector', () => {
      const btn = { tagName: 'BUTTON' };
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel.includes('microphone')) return btn;
        return null;
      });

      expect(meetAdapter.findMuteButton()).toBe(btn);
    });

    it('returns null when no selector matches', () => {
      expect(meetAdapter.findMuteButton()).toBeNull();
    });
  });

  describe('isMuted()', () => {
    it('returns true when data-is-muted is true', () => {
      const btn = { getAttribute: vi.fn().mockReturnValue('true') } as any;
      expect(meetAdapter.isMuted(btn)).toBe(true);
    });

    it('returns false when data-is-muted is false', () => {
      const btn = { getAttribute: vi.fn().mockReturnValue('false') } as any;
      expect(meetAdapter.isMuted(btn)).toBe(false);
    });
  });

  describe('isInCall()', () => {
    it('returns true when call indicator found', () => {
      globalThis.document.querySelector.mockImplementation((sel: string) => {
        if (sel === '[data-call-ended]') return { tagName: 'DIV' };
        return null;
      });

      expect(meetAdapter.isInCall()).toBe(true);
    });

    it('returns false when no indicator found', () => {
      expect(meetAdapter.isInCall()).toBe(false);
    });
  });
});
