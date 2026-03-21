import type { PlatformAdapter, PlatformId } from './types';
import { meetAdapter } from './meet';
import { zoomAdapter } from './zoom';
import { teamsAdapter } from './teams';

const HOST_MAP: Record<string, PlatformAdapter> = {
  'meet.google.com': meetAdapter,
  'zoom.us': zoomAdapter,
  'app.zoom.us': zoomAdapter,
  'teams.microsoft.com': teamsAdapter,
  'teams.live.com': teamsAdapter,
};

export function detectPlatform(hostname: string): PlatformAdapter | null {
  return HOST_MAP[hostname] ?? null;
}

export function detectPlatformFromUrl(url: string): PlatformId | null {
  if (url.includes('meet.google.com')) return 'meet';
  if (url.includes('zoom.us') || url.includes('app.zoom.us')) return 'zoom';
  if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
  return null;
}

export const PLATFORM_URL_PATTERNS = [
  'https://meet.google.com/*',
  'https://zoom.us/wc/*',
  'https://zoom.us/meeting/*',
  'https://app.zoom.us/*',
  'https://teams.microsoft.com/*',
  'https://teams.live.com/*',
];
