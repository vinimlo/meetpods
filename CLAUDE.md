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

| File | Purpose |
|------|---------|
| `src/main/index.ts` | Electron entry point, app lifecycle |
| `src/main/media-key.ts` | Native addon wrapper + event handling |
| `src/main/native-msg.ts` | WebSocket server (port 18432), extension bridge |
| `src/main/tray.ts` | Menu bar icon + context menu |
| `src/extension/background.ts` | Service worker, tab tracking |
| `src/extension/content.ts` | Meet DOM interaction, mute toggle |
| `src/native/media_key_tap.cc` | C++/ObjC++ — CGEventTap + Darwin + AUHAL |
| `electron-builder.yml` | Production packaging config |
| `Makefile` | Developer workflow targets |

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

## 11. Code Style

- TypeScript strict mode (`tsconfig.json`)
- Main process: CommonJS (`require`/`module.exports`)
- Chrome extension: ES2022 modules, bundled by esbuild
- Native addon: C++/ObjC++ with NAPI (`node-addon-api`)
