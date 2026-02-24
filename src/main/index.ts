import { app, systemPreferences } from 'electron';
import { MediaKeyManager } from './media-key';
import { ExtensionBridge, MeetStatus } from './native-msg';
import { MeetPodsTray, TrayState } from './tray';

const TAG = '[MeetPods:main]';

app.dock?.hide();

let tray: MeetPodsTray;
let mediaKeys: MediaKeyManager;
let bridge: ExtensionBridge;
let enabled = true;
let lastMeetStatus: MeetStatus = { active: false, muted: false, tabId: null };
let audioInputActive = false;
let mediaKeysActive = false;

const MEDIA_KEY_DEBOUNCE_MS = 500;

function shouldConsume(): boolean {
  return enabled && bridge?.isConnected && lastMeetStatus.active;
}

function syncConsume(): void {
  const value = shouldConsume();
  console.log(
    `${TAG} syncConsume() → ${value} (enabled=${enabled}, connected=${bridge?.isConnected}, meetActive=${lastMeetStatus.active})`,
  );
  mediaKeys?.setConsume(value);
}

function syncAudioInput(): void {
  const shouldBeActive = enabled && lastMeetStatus.active;
  if (shouldBeActive && !audioInputActive) {
    audioInputActive = mediaKeys?.startAudioInput() ?? false;
    console.log(`${TAG} syncAudioInput() → started (ok=${audioInputActive})`);
  } else if (!shouldBeActive && audioInputActive) {
    mediaKeys?.stopAudioInput();
    audioInputActive = false;
    console.log(`${TAG} syncAudioInput() → stopped`);
  }
}

function syncMediaKeys(): void {
  const shouldBeRunning = enabled && lastMeetStatus.active;
  if (shouldBeRunning && !mediaKeysActive) {
    if (checkAccessibilityPermission()) {
      mediaKeysActive = mediaKeys.start();
    }
  } else if (!shouldBeRunning && mediaKeysActive) {
    mediaKeys.stop();
    mediaKeysActive = false;
  }
}

function updateTrayState(): void {
  const state: TrayState = !enabled || !lastMeetStatus.active ? 'idle' : lastMeetStatus.muted ? 'muted' : 'in-call';
  console.log(`${TAG} updateTrayState() → ${state}`);
  tray.setState(state);
  syncConsume();
  syncAudioInput();
  syncMediaKeys();
}

let lastMediaKeyHandledMs = 0;

async function handleMediaKey(): Promise<void> {
  const now = Date.now();
  if (now - lastMediaKeyHandledMs < MEDIA_KEY_DEBOUNCE_MS) return;
  if (!enabled || !bridge.isConnected) return;

  lastMediaKeyHandledMs = now;

  if (!lastMeetStatus.active) {
    const status = await bridge.queryMeetStatus();
    lastMeetStatus = status;
    updateTrayState();
    if (!status.active) return;
  }

  console.log(`${TAG} handleMediaKey() — toggling mute`);
  const result = await bridge.toggleMute();
  console.log(`${TAG} handleMediaKey() — result: success=${result.success}, muted=${result.muted}`);

  if (result.success && result.muted !== undefined) {
    lastMeetStatus.muted = result.muted;
    updateTrayState();
    tray.flash();
    mediaKeys.playFeedbackSound(result.muted);
  }
}

async function handleAirpodsMute(shouldBeMuted: boolean): Promise<void> {
  const now = Date.now();
  if (now - lastMediaKeyHandledMs < MEDIA_KEY_DEBOUNCE_MS) return;
  if (!enabled || !bridge.isConnected) return;

  lastMediaKeyHandledMs = now;

  if (!lastMeetStatus.active) {
    const status = await bridge.queryMeetStatus();
    lastMeetStatus = status;
    updateTrayState();
    if (!status.active) return;
  }

  // State-aware: only toggle if Meet's mute state differs from the desired state
  if (shouldBeMuted === lastMeetStatus.muted) {
    console.log(
      `${TAG} handleAirpodsMute() — no-op (shouldBeMuted=${shouldBeMuted} matches current muted=${lastMeetStatus.muted})`,
    );
    return;
  }

  console.log(`${TAG} handleAirpodsMute() — toggling mute (shouldBeMuted=${shouldBeMuted})`);
  const result = await bridge.toggleMute();
  console.log(`${TAG} handleAirpodsMute() — result: success=${result.success}, muted=${result.muted}`);

  if (result.success && result.muted !== undefined) {
    lastMeetStatus.muted = result.muted;
    updateTrayState();
    tray.flash();
    mediaKeys.playFeedbackSound(result.muted);
  }
}

function checkAccessibilityPermission(): boolean {
  const trusted = systemPreferences.isTrustedAccessibilityClient(true);
  console.log(`${TAG} Accessibility permission: ${trusted ? 'GRANTED' : 'NOT GRANTED'}`);
  return trusted;
}

app.whenReady().then(async () => {
  console.log(`${TAG} App ready, initializing...`);

  // Request microphone permission for AirPods mute gesture support.
  // AVAudioApplication.setInputMuteStateChangeHandler needs mic access to suppress
  // the "Cannot Control Mic with AirPods" notification. Even without it, the Darwin
  // notification fallback in the native addon will still detect the gesture.
  const micStatus = systemPreferences.getMediaAccessStatus('microphone');
  console.log(`${TAG} Microphone permission: ${micStatus}`);
  if (micStatus !== 'granted') {
    console.log(`${TAG} Requesting microphone access for AirPods mute gesture support...`);
    const micGranted = await systemPreferences.askForMediaAccess('microphone');
    console.log(
      `${TAG} Microphone access ${micGranted ? 'GRANTED' : 'DENIED'} — ${micGranted ? 'AVAudioApplication will suppress notifications' : 'using Darwin notification fallback'}`,
    );
  }

  tray = new MeetPodsTray((newEnabled) => {
    console.log(`${TAG} Tray toggle: enabled=${newEnabled}`);
    enabled = newEnabled;
    updateTrayState();
  });

  bridge = new ExtensionBridge();
  await bridge.start();
  console.log(`${TAG} Bridge started`);

  bridge.on('connected', () => {
    console.log(`${TAG} Extension connected — querying initial Meet status...`);
    bridge.queryMeetStatus().then((status) => {
      console.log(`${TAG} Initial Meet status: active=${status.active}, muted=${status.muted}`);
      lastMeetStatus = status;
      updateTrayState();
    });
  });

  bridge.on('disconnected', () => {
    console.log(`${TAG} Extension disconnected — resetting state`);
    lastMeetStatus = { active: false, muted: false, tabId: null };
    updateTrayState();
  });

  bridge.on('meet-status', (status: MeetStatus) => {
    console.log(`${TAG} meet-status push: active=${status.active}, muted=${status.muted}`);
    lastMeetStatus = status;
    updateTrayState();
  });

  mediaKeys = new MediaKeyManager();

  mediaKeys.on('media-key', async (event) => {
    console.log(`${TAG} media-key event received: ${event.key}`);
    if (event.key === 'play_pause') {
      await handleMediaKey();
    } else if (event.key === 'airpods_mute') {
      await handleAirpodsMute(event.shouldBeMuted);
    }
  });

  mediaKeys.on('error', (err) => {
    console.error(`${TAG} Media key error:`, err);
  });
});

app.on('window-all-closed', () => {
  // Keep running as tray app — don't quit when no windows
});

app.on('before-quit', () => {
  console.log(`${TAG} Shutting down...`);
  audioInputActive = false;
  mediaKeysActive = false;
  mediaKeys?.stop();
  bridge?.stop();
  tray?.destroy();
});
