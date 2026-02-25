# MeetPods — Project Memory

> macOS-only (CoreGraphics + CoreAudio). Requires Node 22+.

## 1. Build & Run

**Quick start (recommended):**

```bash
make setup             # First-time: install deps + full build
make dev               # Launch app (fast — skips native rebuild)
make test              # Run tests
make install           # Build .dmg, open installer
make help              # Show all targets
```

**npm equivalents:**

```bash
npm run build          # Full build (native + TypeScript)
npm run build:native   # Rebuild C++/ObjC++ native addon only
npm run build:ts       # Rebuild TypeScript only
npm run build:ext      # Build Chrome extension (esbuild)
npm test               # Run tests
npm run dev            # Dev mode (watch + rebuild)
npm run build && npx electron .   # Run app locally
```

The Chrome extension must be built first (`npm run build:ext`) then loaded from `dist/extension/` via `chrome://extensions` (Developer mode → Load unpacked).

## 1b. Production Build

```bash
npm run dist             # Full pipeline: build + rebuild native + package .dmg
```

The .dmg is output to `dist/MeetPods-<version>-arm64.dmg`. Open it, drag to Applications, right-click → Open on first launch (ad-hoc signed, not notarized).

**Native Addon ABI:** The native addon must be compiled against Electron's Node ABI for production. `npm run rebuild:electron` handles this. Running `npm run build:native` afterward will revert to system Node ABI (for dev mode via `npm run dev`).

## 1c. Testing

```bash
npm test               # Run tests (vitest)
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report
```

- **Framework:** vitest + @vitest/coverage-v8
- **Thresholds:** 100% lines, 100% functions, 95% branches, 99% statements
- **Coverage scope:** `src/main/**` + `src/extension/**` (native addon excluded)
- Tests colocated: `src/main/__tests__/*.test.ts`, `src/__tests__/extension/*.test.ts`

## 2. Architecture

Three-layer communication:

```
Native (C++/ObjC++ NAPI) ↔ Electron (TypeScript) ↔ Chrome Extension (JS/WebSocket)
```

- **Native addon** (`src/native/media_key_tap.cc`): ObjC++ compiled with `node-gyp`, linked to CoreGraphics, CoreFoundation, AppKit, AVFoundation, CoreAudio, AudioToolbox
- **Electron main process** (`src/main/`): TypeScript — manages tray, media key lifecycle, extension bridge
- **Chrome extension** (`src/extension/`): Detects Google Meet call state, toggles mute via DOM injection

## 2b. Key Files

| File                          | Purpose                                         |
| ----------------------------- | ----------------------------------------------- |
| `src/main/index.ts`           | Electron entry point, app lifecycle             |
| `src/main/media-key.ts`       | Native addon wrapper + event handling           |
| `src/main/native-msg.ts`      | WebSocket server (port 18432), extension bridge |
| `src/main/tray.ts`            | Menu bar icon + context menu                    |
| `src/extension/background.ts` | Service worker, tab tracking                    |
| `src/extension/content.ts`    | Meet DOM interaction, mute toggle               |
| `src/native/media_key_tap.cc` | C++/ObjC++ — CGEventTap + Darwin + AUHAL        |
| `electron-builder.yml`        | Production packaging config                     |
| `Makefile`                    | Developer workflow targets                      |

## 3. AirPods Event Architecture on macOS

**Single press (play/pause):**
Bluetooth AVRCP → `NX_SYSDEFINED` subtype 8, keyCode 16 → caught by `CGEventTap` and `NSEvent globalMonitor`

**Press-and-hold (mute gesture):**
Bluetooth proprietary → `audioaccessoryd` daemon → completely separate path, NEVER touches CGEventTap

These are fundamentally different event systems — this is the #1 gotcha when working with AirPods on macOS.

## 4. Darwin Notification for AirPods Mute

- `com.apple.audioaccessoryd.MuteState` — system-wide Darwin notification from `CFNotificationCenterGetDarwinNotifyCenter()`
- Fires whenever AirPods stem mute gesture occurs
- No mic permission needed, no audio session needed
- Private API (Apple can change it), but used by PodsMute and similar tools
- Does NOT suppress the "Cannot Control Mic" notification

## 5. AVAudioApplication.setInputMuteStateChangeHandler

- Official Apple API (macOS 14+/Sonoma) — the ONLY way to suppress the notification
- **Critical requirement**: only fires when the app has active audio I/O (from Apple's `AVAudioApplication.h` header)
- Just registering the handler is NOT enough — must be actively pulling audio from input device
- When handler returns `YES` → notification suppressed, app controls mute state
- Requires mic permission (`NSMicrophoneUsageDescription` in Info.plist + user grant)

## 6. AUHAL Pattern for Audio Input Activation

- Lightest way to satisfy the "active audio I/O" requirement
- `kAudioUnitSubType_HALOutput` with input bus enabled, output bus disabled
- Render callback calls `AudioUnitRender()` and discards data — zero processing overhead
- Start/stop dynamically tied to call state to avoid permanent mic indicator dot
- Same approach used by [AirMute](https://github.com/CominAtYou/AirMute)
- Requires `CoreAudio` and `AudioToolbox` frameworks

## 7. Deduplication Strategy

Multiple event sources can fire for the same gesture:

- **CGEventTap + NSEvent**: 200ms dedup window via `lastTapEventTimeMs` atomic
- **AVAudioApplication + Darwin notification**: 500ms bidirectional dedup via `lastAirpodsMuteTimeMs` atomic
- Whichever fires first claims the event; the second skips

## 8. Permissions Required

- **Accessibility** (`NSAccessibilityUsageDescription`): for CGEventTap to intercept media keys
- **Microphone** (`NSMicrophoneUsageDescription`): for AVAudioApplication + AUHAL to work
- Electron's stock Info.plist already has `NSMicrophoneUsageDescription`; `electron-builder.yml` adds it for production builds

## 9. Reference Projects

- [AirMute](https://github.com/CominAtYou/AirMute) — AUHAL + AVAudioApplication (Discord mute via AirPods)
- [PodsMute](https://github.com/cyanicr/podsmute) — Darwin notification + CoreAudio property listener
- WWDC23 Session 10233 "Enhance your app's audio experience with AirPods"

## 10. Common Pitfalls

- CGEventTap on background threads won't receive Bluetooth HID events — must use main run loop
- `AVAudioApplication.setInputMuteStateChangeHandler` silently succeeds but never fires without active audio I/O
- macOS can disable event taps after timeout — health check timer re-enables them
- The "Cannot Control Mic" notification is generated by `audioaccessoryd` and cannot be filtered or hidden — only AVAudioApplication returning `YES` suppresses it
- Setting `avAudioHandlerActive` at registration time (not AUHAL start) creates a dead zone — Darwin fallback is gated off but AVAudioApplication can't fire without active audio I/O
- In the content script, calling `chrome.runtime.sendMessage()` before `sendResponse()` invalidates the response port — see Section 13

## 11. Code Style

- TypeScript strict mode (`tsconfig.json`)
- Main process: CommonJS (`require`/`module.exports`)
- Chrome extension: ES2022 modules, bundled by esbuild
- Native addon: C++/ObjC++ with NAPI (`node-addon-api`)

## 12. AVAudioApplication Registration vs Activation

The native addon uses a two-flag pattern to coordinate the AVAudioApplication handler with the Darwin notification fallback:

- **`avAudioHandlerRegistered`** — set to `true` in `Start()` after calling `setInputMuteStateChangeHandler`. The handler is registered but cannot fire yet (no active audio I/O).
- **`avAudioHandlerActive`** — set to `true` only when AUHAL audio input is started (`StartAudioInput()`). At this point the handler CAN fire because the app is actively pulling audio from the input device.

The Darwin notification (`com.apple.audioaccessoryd.MuteState`) serves as a **fallback only when `avAudioHandlerActive` is false** — i.e., when no call is active and AUHAL isn't running. Once AUHAL starts, the AVAudioApplication handler takes over and also suppresses the "Cannot Control Mic" notification.

**Critical bug this prevents:** Setting `avAudioHandlerActive = true` at registration time (in `Start()`) creates a dead zone where neither path fires — the Darwin fallback is gated off, but AVAudioApplication can't fire without active audio I/O from AUHAL.

## 13. Chrome MV3 sendResponse Port Invalidation

When a content script's `onMessage` handler returns `true` (signaling an async response), Chrome MV3 keeps the message port open for `sendResponse()`. However, calling `chrome.runtime.sendMessage()` from the **same content script** before `sendResponse()` fires can invalidate the pending response port, causing the caller to receive `undefined` instead of the actual response.

**How this manifested in MeetPods:**

1. Background sends `toggle_mute` → content script's `onMessage` handler returns `true` (async)
2. `toggleMute()` calls `muteButton.click()`
3. The DOM mutation from the click fires the `MutationObserver` **synchronously** (inline with the click)
4. Observer calls `pushStatusChange()` → `chrome.runtime.sendMessage({ type: 'status_changed', ... })`
5. This `sendMessage()` invalidates the still-pending `sendResponse` port
6. The 100ms `setTimeout` fires, calls `sendResponse({ success: true, muted })` — but the port is dead
7. Background receives `undefined` → Electron never gets the toggle result → no HUD overlay, no audio feedback

**The fix — `isToggling` flag:**

```
isToggling = true;         // suppress observer pushes
muteButton.click();        // MutationObserver fires synchronously, but pushStatusChange() returns early
// ... 100ms later in setTimeout:
checkCallStatus();
isToggling = false;
sendResponse({ success, muted });   // port is still valid — no intervening sendMessage
// deferred push after sendResponse (see Section 14)
```

The flag prevents any `chrome.runtime.sendMessage()` call between the click and the `sendResponse()`, keeping the response port alive.

## 14. Deferred Push Pattern (isToggling + explicit sendMessage)

Suppressing `pushStatusChange()` during the toggle window (Section 13) introduces a secondary problem: the MutationObserver-triggered push was the **only** mechanism that would notify Electron of the mute state change from a toggle. Without it:

- The `sendResponse` goes back to the background script (which forwards to Electron), but only as the toggle **result** — not as a proactive status push
- The 5s poll interval (`setInterval(pushStatusChange, POLL_INTERVAL_MS)`) won't detect a change because `checkCallStatus()` already updated `isInCall`/`isMuted` inside the `setTimeout` callback — by the time the poll runs, prev and current state match

**Correct pattern — deferred push after sendResponse:**

```typescript
setTimeout(() => {
  checkCallStatus();
  isToggling = false;
  resolve({ success: true, muted: isMuted });   // sendResponse fires here (port closes)
  // Deferred push: safe because sendResponse already closed its port
  chrome.runtime.sendMessage({ type: 'status_changed', active: isInCall, muted: isMuted })
    .catch(() => {});
}, POST_CLICK_DELAY_MS);
```

Key points:
- `resolve()` triggers `sendResponse()` which closes the message port
- The subsequent `sendMessage()` opens a **new, independent** port — no conflict
- This ensures Electron receives both the toggle result (via `sendResponse`) AND the status update (via `sendMessage`)
- The `.catch(() => {})` silently handles the case where the service worker is restarting
