export {};

import { detectPlatform } from './platforms/registry';
import type { PlatformAdapter } from './platforms/types';

const TAG = '[MeetPods:content]';
const POST_CLICK_DELAY_MS = 100;
const POLL_INTERVAL_MS = 5000;

const adapter: PlatformAdapter | null = detectPlatform(window.location.hostname);

if (!adapter) {
  console.log(`${TAG} No platform adapter for ${window.location.hostname}, exiting`);
} else {
  let isInCall = false;
  let isMuted = false;
  let muteButton: HTMLButtonElement | null = null;
  let observer: MutationObserver | null = null;
  let isToggling = false;

  console.log(`${TAG} Content script loaded on ${window.location.href} (platform: ${adapter.platformId})`);

  function checkCallStatus(): void {
    const prevActive = isInCall;
    const prevMuted = isMuted;

    muteButton = adapter!.findMuteButton();
    if (muteButton) {
      isInCall = true;
      isMuted = adapter!.isMuted(muteButton);
    } else {
      isInCall = adapter!.isInCall();
      isMuted = false;
    }

    if (isInCall !== prevActive || isMuted !== prevMuted) {
      console.log(
        `${TAG} Status changed: active=${isInCall}, muted=${isMuted} (was: active=${prevActive}, muted=${prevMuted})`,
      );
    }
  }

  function toggleMute(): Promise<{ success: boolean; muted?: boolean; error?: string }> {
    console.log(`${TAG} toggleMute() — called (isInCall=${isInCall}, isMuted=${isMuted}, isToggling=${isToggling})`);
    muteButton = adapter!.findMuteButton();
    if (!muteButton) {
      console.log(`${TAG} toggleMute() — mute button NOT FOUND`);
      console.log(
        `${TAG} toggleMute() — DOM check: ${adapter!.muteButtonSelectors.map((s) => `${s}=${!!document.querySelector(s)}`).join(', ')}`,
      );
      return Promise.resolve({ success: false, error: 'Mute button not found' });
    }
    console.log(
      `${TAG} toggleMute() — clicking mute button (aria-label=${muteButton.getAttribute('aria-label')})`,
    );
    isToggling = true;
    muteButton.click();
    return new Promise((resolve) => {
      setTimeout(() => {
        checkCallStatus();
        isToggling = false;
        console.log(`${TAG} toggleMute() — after click: muted=${isMuted}`);
        resolve({ success: true, muted: isMuted });
        // Deferred push: the MutationObserver push was suppressed during isToggling,
        // so explicitly send the status update after sendResponse has already fired.
        // This is safe because sendResponse closed its port — sendMessage uses a new one.
        chrome.runtime.sendMessage({ type: 'status_changed', active: isInCall, muted: isMuted }).catch(() => {});
      }, POST_CLICK_DELAY_MS);
    });
  }

  function getStatus(): { active: boolean; muted: boolean } {
    checkCallStatus();
    return { active: isInCall, muted: isMuted };
  }

  function pushStatusChange(): void {
    if (isToggling) return;
    const prevActive = isInCall;
    const prevMuted = isMuted;
    checkCallStatus();
    if (isInCall !== prevActive || isMuted !== prevMuted) {
      console.log(`${TAG} Pushing status change to background: active=${isInCall}, muted=${isMuted}`);
      chrome.runtime
        .sendMessage({
          type: 'status_changed',
          active: isInCall,
          muted: isMuted,
        })
        .catch((err: Error) => console.log(`${TAG} status push failed (service worker restarting?):`, err.message));
    }
  }

  function startObserving(): void {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      pushStatusChange();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: adapter!.observedAttributes,
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log(`${TAG} onMessage: type=${message.type}`);
    if (message.type === 'get_status') {
      sendResponse(getStatus());
      return false;
    }
    if (message.type === 'toggle_mute') {
      toggleMute().then(sendResponse);
      return true;
    }
  });

  checkCallStatus();
  // Report the initial state: a new document (reload, or Meet sending the left-call page to
  // /home) would otherwise leave the previous document's active=true in place.
  chrome.runtime.sendMessage({ type: 'status_changed', active: isInCall, muted: isMuted }).catch(() => {});
  startObserving();
  setInterval(pushStatusChange, POLL_INTERVAL_MS);
}
