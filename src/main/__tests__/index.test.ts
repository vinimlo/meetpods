import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks (available inside vi.mock factories) ──────────────
const { mockApp, mockSystemPreferences, mockMediaKeysInstance, mockBridgeInstance, mockTrayInstance } = vi.hoisted(
  () => ({
    mockApp: {
      dock: { hide: vi.fn() },
      whenReady: vi.fn(),
      on: vi.fn(),
      quit: vi.fn(),
    },
    mockSystemPreferences: {
      isTrustedAccessibilityClient: vi.fn().mockReturnValue(true),
      getMediaAccessStatus: vi.fn().mockReturnValue('granted'),
      askForMediaAccess: vi.fn().mockResolvedValue(true),
    },
    mockMediaKeysInstance: {
      start: vi.fn().mockReturnValue(true),
      stop: vi.fn(),
      setConsume: vi.fn(),
      startAudioInput: vi.fn().mockReturnValue(true),
      stopAudioInput: vi.fn(),
      playFeedbackSound: vi.fn(),
      setFeedbackVolume: vi.fn(),
      on: vi.fn(),
      emit: vi.fn(),
    },
    mockBridgeInstance: {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      on: vi.fn(),
      isConnected: true,
      queryMeetStatus: vi.fn().mockResolvedValue({ active: true, muted: false, tabId: 1 }),
      toggleMute: vi.fn().mockResolvedValue({ success: true, muted: true }),
      send: vi.fn(),
    },
    mockTrayInstance: {
      setState: vi.fn(),
      flash: vi.fn(),
      destroy: vi.fn(),
      getBounds: vi.fn().mockReturnValue({ x: 100, y: 0, width: 22, height: 22 }),
      setOnVolumeClick: vi.fn(),
      setOnTestSound: vi.fn(),
      setVolume: vi.fn(),
      setShowMuteHud: vi.fn(),
      setOnShowMuteHudChanged: vi.fn(),
    },
  }),
);

// ── Mock: electron ──────────────────────────────────────────────────
vi.mock('electron', () => ({
  app: mockApp,
  systemPreferences: mockSystemPreferences,
}));

// ── Mock: media-key (regular function for `new` compatibility) ───────
vi.mock('../media-key', () => ({
  MediaKeyManager: function MediaKeyManager() {
    return mockMediaKeysInstance;
  },
}));

// ── Mock: native-msg ─────────────────────────────────────────────────
vi.mock('../native-msg', () => ({
  ExtensionBridge: function ExtensionBridge() {
    return mockBridgeInstance;
  },
}));

// ── Mock: tray ──────────────────────────────────────────────────────
vi.mock('../tray', () => ({
  MeetPodsTray: function MeetPodsTray(cb: any) {
    (mockTrayInstance as any)._toggleCb = cb;
    return mockTrayInstance;
  },
}));

// ── Mock: settings ──────────────────────────────────────────────────
vi.mock('../settings', () => ({
  loadSettings: vi.fn().mockReturnValue({ feedbackVolume: 0.4, showMuteHud: true }),
  saveSettings: vi.fn(),
}));

// ── Mock: volume-popup ──────────────────────────────────────────────
vi.mock('../volume-popup', () => ({
  showVolumePopup: vi.fn(),
}));

// ── Mock: mute-hud ──────────────────────────────────────────────────
const { mockShowMuteHud, mockDestroyMuteHud } = vi.hoisted(() => ({
  mockShowMuteHud: vi.fn(),
  mockDestroyMuteHud: vi.fn(),
}));

vi.mock('../mute-hud', () => ({
  showMuteHud: mockShowMuteHud,
  destroyMuteHud: mockDestroyMuteHud,
}));

describe('MeetPods main orchestration', () => {
  let readyCallback: () => Promise<void>;
  let appOnHandlers: Record<string, Function>;
  let bridgeOnHandlers: Record<string, Function>;
  let mediaKeyOnHandlers: Record<string, Function>;

  function getTrayToggle(): (enabled: boolean) => void {
    return (mockTrayInstance as any)._toggleCb;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    appOnHandlers = {};
    bridgeOnHandlers = {};
    mediaKeyOnHandlers = {};

    // Reset mock state
    mockBridgeInstance.isConnected = true;
    mockBridgeInstance.queryMeetStatus.mockResolvedValue({ active: true, muted: false, tabId: 1 });
    mockBridgeInstance.toggleMute.mockResolvedValue({ success: true, muted: true });
    mockMediaKeysInstance.start.mockReturnValue(true);
    mockMediaKeysInstance.startAudioInput.mockReturnValue(true);
    mockSystemPreferences.isTrustedAccessibilityClient.mockReturnValue(true);
    mockSystemPreferences.getMediaAccessStatus.mockReturnValue('granted');

    // Capture app.whenReady().then() callback
    mockApp.whenReady.mockReturnValue({
      then: vi.fn().mockImplementation((cb: any) => {
        readyCallback = cb;
      }),
    });

    // Capture app.on() handlers
    mockApp.on.mockImplementation((event: string, handler: Function) => {
      appOnHandlers[event] = handler;
    });

    // Capture bridge.on() handlers
    mockBridgeInstance.on.mockImplementation((event: string, handler: Function) => {
      bridgeOnHandlers[event] = handler;
    });

    // Capture mediaKeys.on() handlers
    mockMediaKeysInstance.on.mockImplementation((event: string, handler: Function) => {
      mediaKeyOnHandlers[event] = handler;
    });

    // Import the module (triggers side effects)
    vi.resetModules();
    await import('../index');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls app.dock.hide() at import time', () => {
    expect(mockApp.dock.hide).toHaveBeenCalled();
  });

  it('registers before-quit and window-all-closed handlers', () => {
    expect(appOnHandlers['before-quit']).toBeDefined();
    expect(appOnHandlers['window-all-closed']).toBeDefined();
  });

  describe('after app.whenReady()', () => {
    beforeEach(async () => {
      await readyCallback();
    });

    it('skips mic permission request when already granted', () => {
      expect(mockSystemPreferences.askForMediaAccess).not.toHaveBeenCalled();
    });

    it('requests mic permission when not granted', async () => {
      vi.clearAllMocks();
      mockSystemPreferences.getMediaAccessStatus.mockReturnValue('not-determined');
      mockSystemPreferences.isTrustedAccessibilityClient.mockReturnValue(true);

      mockApp.whenReady.mockReturnValue({
        then: vi.fn().mockImplementation((cb: any) => {
          readyCallback = cb;
        }),
      });
      mockApp.on.mockImplementation((event: string, handler: Function) => {
        appOnHandlers[event] = handler;
      });
      mockBridgeInstance.on.mockImplementation((event: string, handler: Function) => {
        bridgeOnHandlers[event] = handler;
      });
      mockMediaKeysInstance.on.mockImplementation((event: string, handler: Function) => {
        mediaKeyOnHandlers[event] = handler;
      });

      vi.resetModules();
      await import('../index');
      await readyCallback();

      expect(mockSystemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone');
    });

    it('handles denied mic permission', async () => {
      vi.clearAllMocks();
      mockSystemPreferences.getMediaAccessStatus.mockReturnValue('not-determined');
      mockSystemPreferences.askForMediaAccess.mockResolvedValue(false);
      mockSystemPreferences.isTrustedAccessibilityClient.mockReturnValue(true);

      mockApp.whenReady.mockReturnValue({
        then: vi.fn().mockImplementation((cb: any) => {
          readyCallback = cb;
        }),
      });
      mockApp.on.mockImplementation((event: string, handler: Function) => {
        appOnHandlers[event] = handler;
      });
      mockBridgeInstance.on.mockImplementation((event: string, handler: Function) => {
        bridgeOnHandlers[event] = handler;
      });
      mockMediaKeysInstance.on.mockImplementation((event: string, handler: Function) => {
        mediaKeyOnHandlers[event] = handler;
      });

      vi.resetModules();
      await import('../index');
      await readyCallback();

      expect(mockSystemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone');
    });

    it('does not start media keys eagerly at app ready', () => {
      expect(mockMediaKeysInstance.start).not.toHaveBeenCalled();
    });

    it('wires Test Sound to playFeedbackSound directly', () => {
      expect(mockTrayInstance.setOnTestSound).toHaveBeenCalledWith(expect.any(Function));
      const handler = mockTrayInstance.setOnTestSound.mock.calls[0][0];
      handler();
      expect(mockMediaKeysInstance.playFeedbackSound).toHaveBeenCalledWith(true);
    });

    it('does not start media keys when accessibility is not trusted', async () => {
      vi.clearAllMocks();
      mockSystemPreferences.isTrustedAccessibilityClient.mockReturnValue(false);
      mockSystemPreferences.getMediaAccessStatus.mockReturnValue('granted');

      mockApp.whenReady.mockReturnValue({
        then: vi.fn().mockImplementation((cb: any) => {
          readyCallback = cb;
        }),
      });
      mockApp.on.mockImplementation((event: string, handler: Function) => {
        appOnHandlers[event] = handler;
      });
      mockBridgeInstance.on.mockImplementation((event: string, handler: Function) => {
        bridgeOnHandlers[event] = handler;
      });
      mockMediaKeysInstance.on.mockImplementation((event: string, handler: Function) => {
        mediaKeyOnHandlers[event] = handler;
      });

      vi.resetModules();
      await import('../index');
      await readyCallback();

      expect(mockMediaKeysInstance.start).not.toHaveBeenCalled();
    });

    describe('bridge events', () => {
      it('queries status on connected', async () => {
        await bridgeOnHandlers['connected']();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.queryMeetStatus).toHaveBeenCalled();
        expect(mockTrayInstance.setState).toHaveBeenCalled();
      });

      it('resets state on disconnected', () => {
        bridgeOnHandlers['disconnected']();
        expect(mockTrayInstance.setState).toHaveBeenCalledWith('idle');
      });

      it('updates tray on meet-status push', () => {
        bridgeOnHandlers['meet-status']({ active: true, muted: true, tabId: 1 });
        expect(mockTrayInstance.setState).toHaveBeenCalledWith('muted');
      });

      it('sets in-call state when active and not muted', () => {
        bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
        expect(mockTrayInstance.setState).toHaveBeenCalledWith('in-call');
      });

      describe('reactive lifecycle', () => {
        it('starts media keys when call becomes active', () => {
          mockMediaKeysInstance.start.mockClear();
          bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
          expect(mockMediaKeysInstance.start).toHaveBeenCalled();
        });

        it('stops media keys when call becomes inactive', () => {
          bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
          mockMediaKeysInstance.stop.mockClear();
          bridgeOnHandlers['meet-status']({ active: false, muted: false, tabId: null });
          expect(mockMediaKeysInstance.stop).toHaveBeenCalled();
        });

        it('does not start media keys when disabled', () => {
          getTrayToggle()(false);
          mockMediaKeysInstance.start.mockClear();
          bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
          expect(mockMediaKeysInstance.start).not.toHaveBeenCalled();
        });

        it('stops media keys on bridge disconnect during active call', () => {
          bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
          mockMediaKeysInstance.stop.mockClear();
          bridgeOnHandlers['disconnected']();
          expect(mockMediaKeysInstance.stop).toHaveBeenCalled();
        });

        it('queries status once on reconnect and starts if active', async () => {
          mockBridgeInstance.queryMeetStatus.mockResolvedValue({ active: true, muted: false, tabId: 1 });
          mockMediaKeysInstance.start.mockClear();
          await bridgeOnHandlers['connected']();
          await vi.advanceTimersByTimeAsync(0);
          expect(mockBridgeInstance.queryMeetStatus).toHaveBeenCalled();
          expect(mockMediaKeysInstance.start).toHaveBeenCalled();
        });

        it('does not start media keys when accessibility is denied during active call', () => {
          mockSystemPreferences.isTrustedAccessibilityClient.mockReturnValue(false);
          mockMediaKeysInstance.start.mockClear();
          bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
          expect(mockMediaKeysInstance.start).not.toHaveBeenCalled();
        });
      });
    });

    describe('media key events', () => {
      it('handles play_pause key', async () => {
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.toggleMute).toHaveBeenCalled();
      });

      it('handles airpods_mute when state differs', async () => {
        // lastMeetStatus.muted defaults to false, shouldBeMuted=true → should toggle
        mockBridgeInstance.toggleMute.mockResolvedValue({ success: true, muted: true });
        await mediaKeyOnHandlers['media-key']({ key: 'airpods_mute', shouldBeMuted: true });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.toggleMute).toHaveBeenCalled();
        expect(mockShowMuteHud).toHaveBeenCalledWith(true);
        // AirPods path delays feedback sound by 300ms to let audioaccessoryd finish routing
        vi.advanceTimersByTime(300);
        expect(mockMediaKeysInstance.playFeedbackSound).toHaveBeenCalledWith(true);
      });

      it('no-ops airpods_mute when state matches', async () => {
        // Set state to muted
        bridgeOnHandlers['meet-status']({ active: true, muted: true, tabId: 1 });
        mockBridgeInstance.toggleMute.mockClear();

        vi.advanceTimersByTime(600);
        // shouldBeMuted=true matches muted=true → no-op
        await mediaKeyOnHandlers['media-key']({ key: 'airpods_mute', shouldBeMuted: true });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.toggleMute).not.toHaveBeenCalled();
      });

      it('toggles airpods_mute when unmuting and state is muted', async () => {
        bridgeOnHandlers['meet-status']({ active: true, muted: true, tabId: 1 });
        mockBridgeInstance.toggleMute.mockClear();
        mockBridgeInstance.toggleMute.mockResolvedValue({ success: true, muted: false });

        vi.advanceTimersByTime(600);
        await mediaKeyOnHandlers['media-key']({ key: 'airpods_mute', shouldBeMuted: false });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.toggleMute).toHaveBeenCalled();
        expect(mockTrayInstance.flash).toHaveBeenCalled();
        // AirPods path delays feedback sound by 300ms to let audioaccessoryd finish routing
        vi.advanceTimersByTime(300);
        expect(mockMediaKeysInstance.playFeedbackSound).toHaveBeenCalledWith(false);
      });

      it('airpods_mute early returns when disabled', async () => {
        getTrayToggle()(false);
        mockBridgeInstance.toggleMute.mockClear();

        vi.advanceTimersByTime(600);
        await mediaKeyOnHandlers['media-key']({ key: 'airpods_mute', shouldBeMuted: true });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.toggleMute).not.toHaveBeenCalled();
      });

      it('airpods_mute early returns when not connected', async () => {
        mockBridgeInstance.isConnected = false;
        mockBridgeInstance.toggleMute.mockClear();

        vi.advanceTimersByTime(600);
        await mediaKeyOnHandlers['media-key']({ key: 'airpods_mute', shouldBeMuted: true });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.toggleMute).not.toHaveBeenCalled();
      });

      it('airpods_mute queries status when meet is not active', async () => {
        bridgeOnHandlers['meet-status']({ active: false, muted: false, tabId: null });
        mockBridgeInstance.queryMeetStatus.mockResolvedValue({ active: true, muted: false, tabId: 1 });
        mockBridgeInstance.toggleMute.mockClear();

        vi.advanceTimersByTime(600);
        await mediaKeyOnHandlers['media-key']({ key: 'airpods_mute', shouldBeMuted: true });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.queryMeetStatus).toHaveBeenCalled();
        expect(mockBridgeInstance.toggleMute).toHaveBeenCalled();
      });

      it('ignores non-play_pause keys', async () => {
        await mediaKeyOnHandlers['media-key']({ key: 'next_track' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.toggleMute).not.toHaveBeenCalled();
      });

      it('debounces within 500ms', async () => {
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        mockBridgeInstance.toggleMute.mockClear();
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.toggleMute).not.toHaveBeenCalled();
      });

      it('updates state on successful toggle', async () => {
        mockBridgeInstance.toggleMute.mockResolvedValue({ success: true, muted: true });
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTrayInstance.flash).toHaveBeenCalled();
        expect(mockTrayInstance.setState).toHaveBeenCalledWith('muted');
        expect(mockMediaKeysInstance.playFeedbackSound).toHaveBeenCalledWith(true);
        expect(mockShowMuteHud).toHaveBeenCalledWith(true);
      });

      it('plays unmuted sound on successful unmute', async () => {
        mockBridgeInstance.toggleMute.mockResolvedValue({ success: true, muted: false });
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockMediaKeysInstance.playFeedbackSound).toHaveBeenCalledWith(false);
      });

      it('does not flash or show HUD when muted is undefined', async () => {
        mockBridgeInstance.toggleMute.mockResolvedValue({ success: true });
        mockTrayInstance.flash.mockClear();
        mockShowMuteHud.mockClear();

        vi.advanceTimersByTime(600);
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTrayInstance.flash).not.toHaveBeenCalled();
        expect(mockShowMuteHud).not.toHaveBeenCalled();
      });

      it('early returns when disabled', async () => {
        getTrayToggle()(false);

        vi.advanceTimersByTime(600);
        mockBridgeInstance.toggleMute.mockClear();

        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.toggleMute).not.toHaveBeenCalled();
      });

      it('early returns when not connected', async () => {
        mockBridgeInstance.isConnected = false;

        vi.advanceTimersByTime(600);
        mockBridgeInstance.toggleMute.mockClear();

        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.toggleMute).not.toHaveBeenCalled();
      });

      it('queries status first when meet is not active', async () => {
        bridgeOnHandlers['meet-status']({ active: false, muted: false, tabId: null });
        mockBridgeInstance.queryMeetStatus.mockResolvedValue({ active: true, muted: false, tabId: 1 });

        vi.advanceTimersByTime(600);
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.queryMeetStatus).toHaveBeenCalled();
        expect(mockBridgeInstance.toggleMute).toHaveBeenCalled();
      });

      it('returns early when query confirms meet is not active', async () => {
        bridgeOnHandlers['meet-status']({ active: false, muted: false, tabId: null });
        mockBridgeInstance.queryMeetStatus.mockResolvedValue({ active: false, muted: false, tabId: null });
        mockBridgeInstance.toggleMute.mockClear();

        vi.advanceTimersByTime(600);
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockBridgeInstance.toggleMute).not.toHaveBeenCalled();
      });
    });

    describe('media key error handler', () => {
      it('logs error without crashing', () => {
        mediaKeyOnHandlers['error'](new Error('tap died'));
        // Should not throw — just logs
      });
    });

    describe('tray toggle callback', () => {
      it('starts media keys when enabled and call is active', () => {
        // First set meet status to active
        bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
        // Disable then re-enable
        getTrayToggle()(false);
        mockMediaKeysInstance.start.mockClear();
        getTrayToggle()(true);
        expect(mockMediaKeysInstance.start).toHaveBeenCalled();
      });

      it('stops media keys when disabled', () => {
        // First make call active so media keys are running
        bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
        mockMediaKeysInstance.stop.mockClear();
        getTrayToggle()(false);
        expect(mockMediaKeysInstance.stop).toHaveBeenCalled();
      });

      it('updates tray state after toggle', () => {
        mockTrayInstance.setState.mockClear();
        getTrayToggle()(false);
        expect(mockTrayInstance.setState).toHaveBeenCalledWith('idle');
      });
    });

    describe('syncConsume()', () => {
      it('sets consume true when enabled, connected, and active', () => {
        bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
        expect(mockMediaKeysInstance.setConsume).toHaveBeenCalledWith(true);
      });

      it('sets consume false when disabled', () => {
        getTrayToggle()(false);
        expect(mockMediaKeysInstance.setConsume).toHaveBeenCalledWith(false);
      });

      it('sets consume false when disconnected', () => {
        mockBridgeInstance.isConnected = false;
        bridgeOnHandlers['disconnected']();
        expect(mockMediaKeysInstance.setConsume).toHaveBeenCalledWith(false);
      });
    });

    describe('syncAudioInput()', () => {
      it('starts audio when enabled and active', () => {
        mockMediaKeysInstance.startAudioInput.mockClear();
        bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
        expect(mockMediaKeysInstance.startAudioInput).toHaveBeenCalled();
      });

      it('stops audio when disabled', () => {
        bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
        mockMediaKeysInstance.stopAudioInput.mockClear();

        getTrayToggle()(false);
        expect(mockMediaKeysInstance.stopAudioInput).toHaveBeenCalled();
      });

      it('stops audio when meet becomes inactive', () => {
        bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
        mockMediaKeysInstance.stopAudioInput.mockClear();

        bridgeOnHandlers['meet-status']({ active: false, muted: false, tabId: null });
        expect(mockMediaKeysInstance.stopAudioInput).toHaveBeenCalled();
      });

      it('does not re-start audio when already active', () => {
        // First call starts audio
        bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
        mockMediaKeysInstance.startAudioInput.mockClear();

        // Second call with same state should not start again
        bridgeOnHandlers['meet-status']({ active: true, muted: true, tabId: 1 });
        expect(mockMediaKeysInstance.startAudioInput).not.toHaveBeenCalled();
      });

      it('does not stop audio when already inactive', () => {
        // Start with inactive state
        bridgeOnHandlers['meet-status']({ active: false, muted: false, tabId: null });
        mockMediaKeysInstance.stopAudioInput.mockClear();

        // Another inactive update should not call stop
        bridgeOnHandlers['disconnected']();
        expect(mockMediaKeysInstance.stopAudioInput).not.toHaveBeenCalled();
      });
    });

    describe('pendingFeedback fallback', () => {
      it('fires feedback from meet-status push when toggleMute times out', async () => {
        // toggleMute returns failure (timeout) — pendingFeedback stays set
        mockBridgeInstance.toggleMute.mockResolvedValue({ success: false, error: 'Timeout' });
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        // toggleMute failed → no feedback yet
        expect(mockTrayInstance.flash).not.toHaveBeenCalled();
        expect(mockMediaKeysInstance.playFeedbackSound).not.toHaveBeenCalled();
        expect(mockShowMuteHud).not.toHaveBeenCalled();

        // Now the meet-status push arrives (mute state changed from false→true)
        mockTrayInstance.flash.mockClear();
        bridgeOnHandlers['meet-status']({ active: true, muted: true, tabId: 1 });

        expect(mockTrayInstance.flash).toHaveBeenCalled();
        expect(mockMediaKeysInstance.playFeedbackSound).toHaveBeenCalledWith(true);
        expect(mockShowMuteHud).toHaveBeenCalledWith(true);
      });

      it('does not double-fire when toggleMute succeeds and meet-status follows', async () => {
        // toggleMute succeeds → feedback fires immediately, pendingFeedback cleared
        mockBridgeInstance.toggleMute.mockResolvedValue({ success: true, muted: true });
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockTrayInstance.flash).toHaveBeenCalledTimes(1);
        expect(mockMediaKeysInstance.playFeedbackSound).toHaveBeenCalledTimes(1);

        // meet-status push arrives after — should NOT fire feedback again
        mockTrayInstance.flash.mockClear();
        mockMediaKeysInstance.playFeedbackSound.mockClear();
        mockShowMuteHud.mockClear();
        bridgeOnHandlers['meet-status']({ active: true, muted: true, tabId: 1 });

        expect(mockTrayInstance.flash).not.toHaveBeenCalled();
        expect(mockMediaKeysInstance.playFeedbackSound).not.toHaveBeenCalled();
        expect(mockShowMuteHud).not.toHaveBeenCalled();
      });

      it('ignores stale pendingFeedback after timeout window', async () => {
        mockBridgeInstance.toggleMute.mockResolvedValue({ success: false, error: 'Timeout' });
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        // Advance past the 5s pending feedback window
        vi.advanceTimersByTime(6000);

        mockTrayInstance.flash.mockClear();
        mockMediaKeysInstance.playFeedbackSound.mockClear();
        mockShowMuteHud.mockClear();
        bridgeOnHandlers['meet-status']({ active: true, muted: true, tabId: 1 });

        expect(mockTrayInstance.flash).not.toHaveBeenCalled();
        expect(mockMediaKeysInstance.playFeedbackSound).not.toHaveBeenCalled();
        expect(mockShowMuteHud).not.toHaveBeenCalled();
      });

      it('fires feedback with AirPods delay when fallback is from airpods_mute', async () => {
        mockBridgeInstance.toggleMute.mockResolvedValue({ success: false, error: 'Timeout' });
        await mediaKeyOnHandlers['media-key']({ key: 'airpods_mute', shouldBeMuted: true });
        await vi.advanceTimersByTimeAsync(0);

        // meet-status push arrives
        mockTrayInstance.flash.mockClear();
        bridgeOnHandlers['meet-status']({ active: true, muted: true, tabId: 1 });

        expect(mockTrayInstance.flash).toHaveBeenCalled();
        expect(mockShowMuteHud).toHaveBeenCalledWith(true);
        // AirPods: sound is delayed by 300ms
        expect(mockMediaKeysInstance.playFeedbackSound).not.toHaveBeenCalled();
        vi.advanceTimersByTime(300);
        expect(mockMediaKeysInstance.playFeedbackSound).toHaveBeenCalledWith(true);
      });

      it('does not fire fallback when mute state did not change', async () => {
        mockBridgeInstance.toggleMute.mockResolvedValue({ success: false, error: 'Timeout' });
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        // meet-status push arrives but muted is still false (same as before)
        mockTrayInstance.flash.mockClear();
        mockShowMuteHud.mockClear();
        bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });

        expect(mockTrayInstance.flash).not.toHaveBeenCalled();
        expect(mockShowMuteHud).not.toHaveBeenCalled();
      });
    });

    describe('mute HUD', () => {
      it('shows HUD on successful media key toggle', async () => {
        mockBridgeInstance.toggleMute.mockResolvedValue({ success: true, muted: true });
        mockShowMuteHud.mockClear();
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockShowMuteHud).toHaveBeenCalledWith(true);
      });

      it('does not show HUD when disabled via tray', async () => {
        // Get the showMuteHudChanged handler and disable HUD
        const hudChangedHandler = mockTrayInstance.setOnShowMuteHudChanged.mock.calls[0][0];
        hudChangedHandler(false);

        mockShowMuteHud.mockClear();
        vi.advanceTimersByTime(600);
        mockBridgeInstance.toggleMute.mockResolvedValue({ success: true, muted: true });
        await mediaKeyOnHandlers['media-key']({ key: 'play_pause' });
        await vi.advanceTimersByTimeAsync(0);

        expect(mockShowMuteHud).not.toHaveBeenCalled();
      });

      it('persists showMuteHud setting when toggled via tray', async () => {
        const { saveSettings } = await import('../settings');
        const hudChangedHandler = mockTrayInstance.setOnShowMuteHudChanged.mock.calls[0][0];
        vi.mocked(saveSettings).mockClear();

        hudChangedHandler(false);
        expect(saveSettings).toHaveBeenCalledWith({ showMuteHud: false });
      });

      it('loads showMuteHud from settings and applies to tray', () => {
        expect(mockTrayInstance.setShowMuteHud).toHaveBeenCalledWith(true);
        expect(mockTrayInstance.setOnShowMuteHudChanged).toHaveBeenCalledWith(expect.any(Function));
      });
    });

    describe('before-quit', () => {
      it('stops all services and destroys HUD', () => {
        appOnHandlers['before-quit']();
        expect(mockMediaKeysInstance.stop).toHaveBeenCalled();
        expect(mockBridgeInstance.stop).toHaveBeenCalled();
        expect(mockTrayInstance.destroy).toHaveBeenCalled();
        expect(mockDestroyMuteHud).toHaveBeenCalled();
      });
    });

    describe('window-all-closed', () => {
      it('does not quit (tray app)', () => {
        appOnHandlers['window-all-closed']();
        expect(mockApp.quit).not.toHaveBeenCalled();
      });
    });
  });
});
