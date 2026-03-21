import type { PlatformAdapter } from './types';

const MUTE_BUTTON_SELECTORS = [
  'button[id*="microphone-button"]',
  '[data-tid="toggle-mute"]',
  'button[aria-label*="mute" i]:not([aria-label*="video" i]):not([aria-label*="chat" i])',
  'button[title*="mute" i]:not([title*="video" i])',
];

const CALL_INDICATORS = ['[data-tid="calling-screen"]', '.calling-controls-section', '#roster-button', '[data-tid="call-duration"]'];

export const teamsAdapter: PlatformAdapter = {
  platformId: 'teams',
  displayName: 'Teams',
  muteButtonSelectors: MUTE_BUTTON_SELECTORS,
  callIndicators: CALL_INDICATORS,
  observedAttributes: ['aria-pressed', 'aria-label', 'class'],

  findMuteButton(): HTMLButtonElement | null {
    for (const selector of MUTE_BUTTON_SELECTORS) {
      const btn = document.querySelector(selector) as HTMLButtonElement | null;
      if (btn) return btn;
    }
    return null;
  },

  isMuted(button: HTMLButtonElement): boolean {
    // Teams: aria-pressed="true" means muted, or label says "unmute"
    if (button.getAttribute('aria-pressed') === 'true') return true;
    const label = (button.getAttribute('aria-label') ?? '').toLowerCase();
    return label.includes('unmute');
  },

  isInCall(): boolean {
    return CALL_INDICATORS.some((sel) => document.querySelector(sel) !== null);
  },
};
