import { app, systemPreferences } from 'electron';
import { MediaKeyManager } from './media-key';
import { ExtensionBridge, MeetStatus } from './native-msg';
import { MeetPodsTray, TrayState } from './tray';
import { loadSettings, saveSettings } from './settings';
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
let showMuteHudEnabled = true;
let pendingFeedback: { expectedMuted: boolean; timestamp: number; isAirpods: boolean } | null = null;

const MEDIA_KEY_DEBOUNCE_MS = 500;
const PENDING_FEEDBACK_TIMEOUT_MS = 5000;

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
  pendingFeedback = { expectedMuted: !lastMeetStatus.muted, timestamp: Date.now(), isAirpods: false };
  const result = await bridge.toggleMute();
  console.log(`${TAG} handleMediaKey() — result: success=${result.success}, muted=${result.muted}, error=${result.error}`);

  if (result.success && result.muted !== undefined) {
    pendingFeedback = null;
    lastMeetStatus.muted = result.muted;
    updateTrayState();
    tray.flash();
    mediaKeys.playFeedbackSound(result.muted);
    if (showMuteHudEnabled) showMuteHud(result.muted);
  } else {
    console.log(`${TAG} handleMediaKey() — FAILED: no immediate feedback (success=${result.success}, muted=${result.muted}, error=${result.error}) — pendingFeedback kept for meet-status fallback`);
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
  console.log(`${TAG} handleAirpodsMute() — result: success=${result.success}, muted=${result.muted}, error=${result.error}`);

  if (result.success && result.muted !== undefined) {
    pendingFeedback = null;
    lastMeetStatus.muted = result.muted;
    updateTrayState();
    tray.flash();
    // Delay: let audioaccessoryd finish routing transition after AirPods mute gesture
    setTimeout(() => mediaKeys.playFeedbackSound(result.muted!), 300);
    if (showMuteHudEnabled) showMuteHud(result.muted);
  } else {
    console.log(`${TAG} handleAirpodsMute() — FAILED: no immediate feedback (success=${result.success}, muted=${result.muted}, error=${result.error}) — pendingFeedback kept for meet-status fallback`);
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
        if (isAirpods) {
          setTimeout(() => mediaKeys.playFeedbackSound(status.muted), 300);
        } else {
          mediaKeys.playFeedbackSound(status.muted);
        }
        if (showMuteHudEnabled) showMuteHud(status.muted);
      } else {
        console.log(`${TAG} pendingFeedback expired (elapsed=${elapsed}ms) — ignoring`);
        pendingFeedback = null;
      }
    }
  });

  mediaKeys = new MediaKeyManager();

  // Load saved settings and apply them
  const settings = loadSettings();
  const savedVolume = Math.max(0, Math.min(1, settings.feedbackVolume));
  mediaKeys.setFeedbackVolume(savedVolume);
  tray.setVolume(savedVolume * 100);

  showMuteHudEnabled = settings.showMuteHud;
  tray.setShowMuteHud(showMuteHudEnabled);
  tray.setOnShowMuteHudChanged((show) => {
    showMuteHudEnabled = show;
    saveSettings({ showMuteHud: show });
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
  destroyMuteHud();
});
