export {};

const TAG = '[MeetPods:content]';
const POST_CLICK_DELAY_MS = 100;
const POLL_INTERVAL_MS = 5000;

let isInCall = false;
let isMuted = false;
let muteButton: HTMLButtonElement | null = null;
let observer: MutationObserver | null = null;
let isToggling = false;

console.log(`${TAG} Content script loaded on ${window.location.href}`);

const MUTE_BUTTON_SELECTORS = [
  'button[data-is-muted][aria-label*="microphone" i]',
  'button[data-is-muted][aria-label*="microfone" i]',
  'button[data-is-muted][aria-label*="mikrofon" i]',
  '[data-tooltip*="microphone" i] button[data-is-muted]',
  '[data-tooltip*="microfone" i] button[data-is-muted]',
];

const CALL_INDICATORS = ['[data-call-ended]', 'button[data-is-muted]', '[data-meeting-title]'];

function findMuteButton(): HTMLButtonElement | null {
  for (const selector of MUTE_BUTTON_SELECTORS) {
    const btn = document.querySelector(selector) as HTMLButtonElement | null;
    if (btn) return btn;
  }
  return null;
}

function checkCallStatus(): void {
  const prevActive = isInCall;
  const prevMuted = isMuted;

  muteButton = findMuteButton();
  if (muteButton) {
    isInCall = true;
    isMuted = muteButton.getAttribute('data-is-muted') === 'true';
  } else {
    isInCall = CALL_INDICATORS.some((sel) => document.querySelector(sel) !== null);
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
  muteButton = findMuteButton();
  if (!muteButton) {
    console.log(`${TAG} toggleMute() — mute button NOT FOUND`);
    console.log(`${TAG} toggleMute() — DOM check: ${MUTE_BUTTON_SELECTORS.map((s) => `${s}=${!!document.querySelector(s)}`).join(', ')}`);
    return Promise.resolve({ success: false, error: 'Mute button not found' });
  }
  console.log(`${TAG} toggleMute() — clicking mute button (data-is-muted=${muteButton.getAttribute('data-is-muted')}, aria-label=${muteButton.getAttribute('aria-label')})`);
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
      chrome.runtime
        .sendMessage({ type: 'status_changed', active: isInCall, muted: isMuted })
        .catch(() => {});
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
    attributeFilter: ['data-is-muted', 'aria-label'],
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
startObserving();
setInterval(pushStatusChange, POLL_INTERVAL_MS);
