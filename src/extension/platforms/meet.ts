import type { PlatformAdapter } from './types';

const MUTE_BUTTON_SELECTORS = [
  'button[data-is-muted][aria-label*="microphone" i]',
  'button[data-is-muted][aria-label*="microfone" i]',
  'button[data-is-muted][aria-label*="mikrofon" i]',
  '[data-tooltip*="microphone" i] button[data-is-muted]',
  '[data-tooltip*="microfone" i] button[data-is-muted]',
];

const CALL_INDICATORS = ['[data-call-ended]', 'button[data-is-muted]', '[data-meeting-title]'];

export const meetAdapter: PlatformAdapter = {
  platformId: 'meet',
  displayName: 'Google Meet',
  muteButtonSelectors: MUTE_BUTTON_SELECTORS,
  callIndicators: CALL_INDICATORS,
  observedAttributes: ['data-is-muted', 'aria-label'],

  findMuteButton(): HTMLButtonElement | null {
    for (const selector of MUTE_BUTTON_SELECTORS) {
      const btn = document.querySelector(selector) as HTMLButtonElement | null;
      if (btn) return btn;
    }
    return null;
  },

  isMuted(button: HTMLButtonElement): boolean {
    return button.getAttribute('data-is-muted') === 'true';
  },

  isInCall(): boolean {
    return CALL_INDICATORS.some((sel) => document.querySelector(sel) !== null);
  },
};
