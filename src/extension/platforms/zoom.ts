import type { PlatformAdapter } from './types';

const MUTE_BUTTON_SELECTORS = [
  'button[aria-label*="mute" i][aria-label*="audio" i]',
  'button[aria-label*="unmute" i]',
  'button[aria-label*="mute" i]:not([aria-label*="video" i]):not([aria-label*="chat" i])',
  '.footer-button-base__img-layer button[aria-label*="mute" i]',
];

const CALL_INDICATORS = ['.meeting-app', '.meeting-info-container', '.footer__btns-container', '[class*="meeting-client"]'];

export const zoomAdapter: PlatformAdapter = {
  platformId: 'zoom',
  displayName: 'Zoom',
  muteButtonSelectors: MUTE_BUTTON_SELECTORS,
  callIndicators: CALL_INDICATORS,
  observedAttributes: ['aria-label', 'class'],

  findMuteButton(): HTMLButtonElement | null {
    for (const selector of MUTE_BUTTON_SELECTORS) {
      const btn = document.querySelector(selector) as HTMLButtonElement | null;
      if (btn) return btn;
    }
    return null;
  },

  isMuted(button: HTMLButtonElement): boolean {
    // Zoom: when muted, the button label says "unmute"
    const label = (button.getAttribute('aria-label') ?? '').toLowerCase();
    return label.includes('unmute');
  },

  isInCall(): boolean {
    return CALL_INDICATORS.some((sel) => document.querySelector(sel) !== null);
  },
};
