import { app, systemPreferences } from 'electron';
import { MediaKeyManager } from './media-key';
import { ExtensionBridge, MeetStatus } from './native-msg';
import { MeetPodsTray, TrayState } from './tray';
import { loadSettings, saveSettings, type StemPressSource } from './settings';
import { StemLogWatcher } from './stem-log-watcher';
import { showVolumePopup } from './volume-popup';
import { showMuteHud, destroyMuteHud } from './mute-hud';

const TAG = '[MeetPods:main]';

app.dock?.hide();

let tray: MeetPodsTray;
let mediaKeys: MediaKeyManager;
let bridge: ExtensionBridge;
let enabled = true;
let lastMeetStatus: MeetStatus = { active: false, muted: false, tabId: null };
let audioInputActive = false;
let mediaKeysActive = false;
let syncedInputMuted: boolean | null = null;
let showMuteHudEnabled = true;
let pendingFeedback: { expectedMuted: boolean; timestamp: number; isAirpods: boolean } | null = null;
let stemPressSource: StemPressSource = 'audio-api';
// No side effects until start(): follows bluetoothd's log line when the source is system-log.
const stemWatcher = new StemLogWatcher();

const MEDIA_KEY_DEBOUNCE_MS = 500;
const PENDING_FEEDBACK_TIMEOUT_MS = 5000;
const AIRPODS_FEEDBACK_DELAY_MS = 300;

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
  const shouldBeActive = stemPressSource === 'audio-api' && enabled && lastMeetStatus.active;
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

// Keep macOS's per-app input-mute state equal to Meet's. macOS replays that state to the
// AVAudioApplication handler when the record session goes active; left at its default
// (unmuted), the replay reads as an AirPods "unmute" request and unmutes the call.
// Needs the handler registered (start()) — macOS rejects the call otherwise.
function syncInputMuteState(): void {
  if (stemPressSource !== 'audio-api' || !mediaKeysActive || !lastMeetStatus.active) {
    syncedInputMuted = null;
    return;
  }
  if (syncedInputMuted === lastMeetStatus.muted) return;
  mediaKeys.setInputMuted(lastMeetStatus.muted);
  syncedInputMuted = lastMeetStatus.muted;
}

function syncStemWatcher(): void {
  if (stemPressSource === 'system-log' && enabled && lastMeetStatus.active) {
    stemWatcher.start();
  } else {
    stemWatcher.stop();
  }
}

function updateTrayState(): void {
  const state: TrayState = !enabled || !lastMeetStatus.active ? 'idle' : lastMeetStatus.muted ? 'muted' : 'in-call';
  console.log(`${TAG} updateTrayState() → ${state}`);
  tray.setState(state);
  syncConsume();
  // Order matters: register the AVAudioApplication handler (start()), then store Meet's
  // mute state, then start audio input — so the replay on activation carries Meet's state.
  syncMediaKeys();
  syncInputMuteState();
  syncAudioInput();
  syncStemWatcher();
}

let lastMediaKeyHandledMs = 0;

// After an AirPods press, let the system's own response to the gesture finish (the
// audioaccessoryd routing transition, or macOS 27's "rejected" chime) before our sound.
function playToggleSound(muted: boolean, isAirpods: boolean): void {
  if (isAirpods) {
    setTimeout(() => mediaKeys.playFeedbackSound(muted), AIRPODS_FEEDBACK_DELAY_MS);
  } else {
    mediaKeys.playFeedbackSound(muted);
  }
}

async function handleMediaKey(isAirpods = false): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastMediaKeyHandledMs;
  console.log(
    `${TAG} handleMediaKey() — entry (elapsed=${elapsed}ms, enabled=${enabled}, connected=${bridge?.isConnected}, meetActive=${lastMeetStatus.active}, meetMuted=${lastMeetStatus.muted})`,
  );
  if (elapsed < MEDIA_KEY_DEBOUNCE_MS) {
    console.log(`${TAG} handleMediaKey() — DEBOUNCED (${elapsed}ms < ${MEDIA_KEY_DEBOUNCE_MS}ms)`);
    return;
  }
  if (!enabled || !bridge.isConnected) {
    console.log(`${TAG} handleMediaKey() — SKIPPED (enabled=${enabled}, connected=${bridge?.isConnected})`);
    return;
  }

  lastMediaKeyHandledMs = now;

  if (!lastMeetStatus.active) {
    console.log(`${TAG} handleMediaKey() — meetActive=false, querying status...`);
    const status = await bridge.queryMeetStatus();
    lastMeetStatus = status;
    updateTrayState();
    if (!status.active) {
      console.log(`${TAG} handleMediaKey() — query returned active=false, aborting`);
      return;
    }
  }

  console.log(`${TAG} handleMediaKey() — toggling mute`);
  pendingFeedback = { expectedMuted: !lastMeetStatus.muted, timestamp: Date.now(), isAirpods };
  const result = await bridge.toggleMute();
  console.log(
    `${TAG} handleMediaKey() — result: success=${result.success}, muted=${result.muted}, error=${result.error}`,
  );

  if (result.success && result.muted !== undefined) {
    // Cleared already = the meet-status fallback gave the feedback (the push often lands
    // before this result; the 2s request timeout is shorter than the 5s fallback window).
    const feedbackAlreadyGiven = pendingFeedback === null;
    pendingFeedback = null;
    lastMeetStatus.muted = result.muted;
    updateTrayState();
    if (feedbackAlreadyGiven) return;
    tray.flash();
    playToggleSound(result.muted, isAirpods);
    if (showMuteHudEnabled) showMuteHud(result.muted);
  } else {
    console.log(
      `${TAG} handleMediaKey() — FAILED: no immediate feedback (success=${result.success}, muted=${result.muted}, error=${result.error}) — pendingFeedback kept for meet-status fallback`,
    );
  }
}

async function handleAirpodsMute(shouldBeMuted: boolean): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastMediaKeyHandledMs;
  console.log(
    `${TAG} handleAirpodsMute(shouldBeMuted=${shouldBeMuted}) — entry (elapsed=${elapsed}ms, enabled=${enabled}, connected=${bridge?.isConnected}, meetActive=${lastMeetStatus.active}, meetMuted=${lastMeetStatus.muted})`,
  );
  if (elapsed < MEDIA_KEY_DEBOUNCE_MS) {
    console.log(`${TAG} handleAirpodsMute() — DEBOUNCED (${elapsed}ms < ${MEDIA_KEY_DEBOUNCE_MS}ms)`);
    return;
  }
  if (!enabled || !bridge.isConnected) {
    console.log(`${TAG} handleAirpodsMute() — SKIPPED (enabled=${enabled}, connected=${bridge?.isConnected})`);
    return;
  }

  lastMediaKeyHandledMs = now;

  if (!lastMeetStatus.active) {
    console.log(`${TAG} handleAirpodsMute() — meetActive=false, querying status...`);
    const status = await bridge.queryMeetStatus();
    lastMeetStatus = status;
    updateTrayState();
    if (!status.active) {
      console.log(`${TAG} handleAirpodsMute() — query returned active=false, aborting`);
      return;
    }
  }

  // State-aware: only toggle if Meet's mute state differs from the desired state
  if (shouldBeMuted === lastMeetStatus.muted) {
    console.log(
      `${TAG} handleAirpodsMute() — NO-OP (shouldBeMuted=${shouldBeMuted} matches current muted=${lastMeetStatus.muted})`,
    );
    return;
  }

  console.log(`${TAG} handleAirpodsMute() — toggling mute (shouldBeMuted=${shouldBeMuted})`);
  pendingFeedback = { expectedMuted: shouldBeMuted, timestamp: Date.now(), isAirpods: true };
  const result = await bridge.toggleMute();
  console.log(
    `${TAG} handleAirpodsMute() — result: success=${result.success}, muted=${result.muted}, error=${result.error}`,
  );

  if (result.success && result.muted !== undefined) {
    const feedbackAlreadyGiven = pendingFeedback === null; // see handleMediaKey()
    pendingFeedback = null;
    lastMeetStatus.muted = result.muted;
    updateTrayState();
    if (feedbackAlreadyGiven) return;
    tray.flash();
    playToggleSound(result.muted, true);
    if (showMuteHudEnabled) showMuteHud(result.muted);
  } else {
    console.log(
      `${TAG} handleAirpodsMute() — FAILED: no immediate feedback (success=${result.success}, muted=${result.muted}, error=${result.error}) — pendingFeedback kept for meet-status fallback`,
    );
  }
}

function checkAccessibilityPermission(): boolean {
  const trusted = systemPreferences.isTrustedAccessibilityClient(true);
  console.log(`${TAG} Accessibility permission: ${trusted ? 'GRANTED' : 'NOT GRANTED'}`);
  return trusted;
}

// The Audio API source records the mic so AVAudioApplication can hand it the gesture.
async function ensureMicPermission(): Promise<void> {
  const micStatus = systemPreferences.getMediaAccessStatus('microphone');
  console.log(`${TAG} Microphone permission: ${micStatus}`);
  if (micStatus === 'granted') return;
  console.log(`${TAG} Requesting microphone access for AirPods mute gesture support...`);
  const micGranted = await systemPreferences.askForMediaAccess('microphone');
  console.log(
    `${TAG} Microphone access ${micGranted ? 'GRANTED' : 'DENIED'} — ${micGranted ? 'AVAudioApplication will suppress notifications' : 'using Darwin notification fallback'}`,
  );
}

app.whenReady().then(async () => {
  console.log(`${TAG} App ready, initializing...`);

  const settings = loadSettings();
  stemPressSource = settings.stemPressSource;
  console.log(`${TAG} AirPods stem press source: ${stemPressSource}`);
  if (stemPressSource === 'audio-api') await ensureMicPermission();

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
    const prevMuted = lastMeetStatus.muted;
    lastMeetStatus = status;
    updateTrayState();

    // Fallback: if toggleMute() response was lost, fire feedback from the push
    if (pendingFeedback && status.muted !== prevMuted) {
      const elapsed = Date.now() - pendingFeedback.timestamp;
      if (elapsed < PENDING_FEEDBACK_TIMEOUT_MS) {
        console.log(`${TAG} pendingFeedback fallback fired (elapsed=${elapsed}ms, muted=${status.muted})`);
        const isAirpods = pendingFeedback.isAirpods;
        pendingFeedback = null;
        tray.flash();
        playToggleSound(status.muted, isAirpods);
        if (showMuteHudEnabled) showMuteHud(status.muted);
      } else {
        console.log(`${TAG} pendingFeedback expired (elapsed=${elapsed}ms) — ignoring`);
        pendingFeedback = null;
      }
    }
  });

  mediaKeys = new MediaKeyManager();

  // Apply saved settings
  const savedVolume = Math.max(0, Math.min(1, settings.feedbackVolume));
  mediaKeys.setFeedbackVolume(savedVolume);
  tray.setVolume(savedVolume * 100);

  showMuteHudEnabled = settings.showMuteHud;
  tray.setShowMuteHud(showMuteHudEnabled);
  tray.setOnShowMuteHudChanged((show) => {
    showMuteHudEnabled = show;
    saveSettings({ showMuteHud: show });
  });

  tray.setStemPressSource(stemPressSource);
  tray.setOnStemPressSourceChanged(async (source) => {
    console.log(`${TAG} AirPods stem press source → ${source}`);
    stemPressSource = source;
    saveSettings({ stemPressSource: source });
    if (source === 'audio-api') await ensureMicPermission();
    updateTrayState();
  });

  tray.setOnTestSound(() => {
    console.log(`${TAG} Test Sound clicked — playing feedback sound directly`);
    mediaKeys.playFeedbackSound(true);
  });

  tray.setOnVolumeClick(() => {
    const currentSettings = loadSettings();
    showVolumePopup(tray.getBounds(), currentSettings.feedbackVolume, (newVolume) => {
      mediaKeys.setFeedbackVolume(newVolume);
      tray.setVolume(newVolume * 100);
      saveSettings({ feedbackVolume: newVolume });
    });
  });

  mediaKeys.on('media-key', async (event) => {
    console.log(`${TAG} media-key event received: ${event.key}`);
    if (event.key === 'play_pause') {
      await handleMediaKey();
    } else if (event.key === 'airpods_mute') {
      if (stemPressSource === 'system-log') {
        console.log(`${TAG} airpods_mute ignored — the stem press comes from the system log`);
        return;
      }
      await handleAirpodsMute(event.shouldBeMuted);
    }
  });

  mediaKeys.on('error', (err) => {
    console.error(`${TAG} Media key error:`, err);
  });

  stemWatcher.on('stem-press', async () => {
    console.log(`${TAG} stem-press event received`);
    await handleMediaKey(true);
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
  stemWatcher.stop();
  bridge?.stop();
  tray?.destroy();
  destroyMuteHud();
});
