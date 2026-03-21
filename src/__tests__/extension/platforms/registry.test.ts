import { describe, it, expect } from 'vitest';
import { detectPlatform, detectPlatformFromUrl, PLATFORM_URL_PATTERNS } from '../../../extension/platforms/registry';

describe('registry', () => {
  describe('detectPlatform()', () => {
    it('returns meetAdapter for meet.google.com', () => {
      const adapter = detectPlatform('meet.google.com');
      expect(adapter?.platformId).toBe('meet');
    });

    it('returns zoomAdapter for zoom.us', () => {
      const adapter = detectPlatform('zoom.us');
      expect(adapter?.platformId).toBe('zoom');
    });

    it('returns zoomAdapter for app.zoom.us', () => {
      const adapter = detectPlatform('app.zoom.us');
      expect(adapter?.platformId).toBe('zoom');
    });

    it('returns teamsAdapter for teams.microsoft.com', () => {
      const adapter = detectPlatform('teams.microsoft.com');
      expect(adapter?.platformId).toBe('teams');
    });

    it('returns teamsAdapter for teams.live.com', () => {
      const adapter = detectPlatform('teams.live.com');
      expect(adapter?.platformId).toBe('teams');
    });

    it('returns null for unknown hostname', () => {
      expect(detectPlatform('google.com')).toBeNull();
    });
  });

  describe('detectPlatformFromUrl()', () => {
    it('returns meet for Meet URLs', () => {
      expect(detectPlatformFromUrl('https://meet.google.com/abc-def-ghi')).toBe('meet');
    });

    it('returns zoom for Zoom URLs', () => {
      expect(detectPlatformFromUrl('https://zoom.us/wc/123456')).toBe('zoom');
      expect(detectPlatformFromUrl('https://app.zoom.us/wc/123456')).toBe('zoom');
    });

    it('returns teams for Teams URLs', () => {
      expect(detectPlatformFromUrl('https://teams.microsoft.com/meeting/123')).toBe('teams');
      expect(detectPlatformFromUrl('https://teams.live.com/meeting/123')).toBe('teams');
    });

    it('returns null for unknown URLs', () => {
      expect(detectPlatformFromUrl('https://google.com')).toBeNull();
    });
  });

  describe('PLATFORM_URL_PATTERNS', () => {
    it('includes patterns for all 3 platforms', () => {
      expect(PLATFORM_URL_PATTERNS.some((p) => p.includes('meet.google.com'))).toBe(true);
      expect(PLATFORM_URL_PATTERNS.some((p) => p.includes('zoom.us'))).toBe(true);
      expect(PLATFORM_URL_PATTERNS.some((p) => p.includes('teams.microsoft.com'))).toBe(true);
    });
  });
});
