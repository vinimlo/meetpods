# MeetPods

**Toggle Google Meet mute with your AirPods.**

When you press the AirPods stem on your iPhone, it mutes/unmutes calls. On macOS, that doesn't work — the button just plays/pauses music. MeetPods fixes this.

Press your AirPods stem (or any media key) during a Google Meet call, and MeetPods toggles your microphone. Outside of calls, media keys work normally.

## How it works

```
AirPods stem press
  → macOS media key event (NX_SYSDEFINED)
  → MeetPods intercepts via CGEventTap
  → Queries Chrome Extension: "Is there an active Meet call?"
  → Yes → Toggle mute button in Meet, consume the event
  → No  → Pass through (play/pause music as usual)
```

Three components work together:

| Component | Role |
|-----------|------|
| **Electron app** | Menu bar app that intercepts media keys and orchestrates everything |
| **Native addon** | C++ module using macOS CGEventTap to capture media key events |
| **Chrome Extension** | Detects active Meet calls and clicks the mute button in the DOM |

The Electron app and Chrome Extension communicate via a local WebSocket on `127.0.0.1:18432`.

## Requirements

- macOS 12+ (Monterey or later)
- Google Chrome
- Node.js 22+
- Xcode Command Line Tools (for building the native addon)

## Setup

### 1. Clone and install

```bash
git clone <repo-url> meetpods
cd meetpods
npm install
```

Or with Docker:

```bash
docker compose run --rm meetpods npm install
```

### 2. Build the native addon

The native addon must be built on macOS (it uses CoreGraphics and AppKit frameworks):

```bash
npm run build:native
```

### 3. Build TypeScript

```bash
npm run build:ts
```

### 4. Install the Chrome Extension

1. Open `chrome://extensions/` in Google Chrome
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `dist/extension/` directory

### 5. Run

```bash
npm start
```

MeetPods will appear in your menu bar. macOS will ask for **Accessibility permission** on first launch — this is required to intercept media key events.

## Menu bar states

| Icon | State |
|------|-------|
| Gray microphone | No active call |
| Filled microphone + signal arcs | In call, mic ON |
| Microphone with strikethrough | In call, muted |

The icon briefly flashes when you toggle mute to confirm the action.

## Chrome Extension popup

Click the MeetPods extension icon in Chrome to see real-time status:

- **Electron App** — connected or offline
- **Google Meet** — in call or no call
- **Microphone** — mic on or muted

## Development

### Project structure

```
meetpods/
├── src/
│   ├── main/                # Electron main process (TypeScript)
│   │   ├── index.ts         # Entry point, orchestration
│   │   ├── media-key.ts     # Native addon wrapper
│   │   ├── native-msg.ts    # WebSocket bridge to extension
│   │   └── tray.ts          # Menu bar icon and context menu
│   ├── native/              # C++ native addon
│   │   ├── media_key_tap.cc # CGEventTap implementation
│   │   └── binding.gyp      # Build configuration
│   └── extension/           # Chrome Extension (Manifest V3)
│       ├── manifest.json
│       ├── background.ts    # Service worker, tab tracking, WebSocket
│       ├── content.ts       # Meet DOM interaction, mute control
│       ├── popup.html       # Extension popup UI
│       └── popup.ts         # Popup status logic
├── assets/                  # Tray icons (SVG sources + PNG @1x/@2x)
├── scripts/                 # Icon generation scripts
└── docs/plans/              # Design and implementation docs
```

### Scripts

```bash
npm run build:ts      # Compile TypeScript
npm run build:native  # Build C++ addon
npm run build         # Both
npm start             # Build + run
npm run dev           # Quick run (TypeScript only, skip native rebuild)
npm test              # Run tests
npm run test:watch    # Watch mode
npm run dist          # Package as .dmg
```

### Running tests

```bash
npm test
```

Or with Docker:

```bash
docker compose run --rm meetpods npm test
```

### Regenerating icons

If you modify the SVG sources in `assets/` or `src/extension/icons/`:

```bash
node scripts/generate-icons.js           # Tray icons
node scripts/generate-extension-icons.js  # Extension icons
```

Requires the `sharp` package (included in devDependencies).

## Architecture decisions

**WebSocket instead of Chrome Native Messaging** — Native Messaging requires Chrome to launch a separate binary via stdio, which would need its own IPC to the running Electron app. A local WebSocket server is simpler and achieves the same result.

**DOM click instead of keyboard shortcut** — Clicking the mute button directly in the Meet DOM is more reliable than sending `Cmd+D`, and works without stealing window focus. This is critical since the user is typically in another app during calls.

**Event consumption timing** — CGEventTap decides synchronously whether to consume events, but querying Meet status is async. A `shouldConsumeEvent` flag bridges this gap: it defaults to `false` (pass through) and is set to `true` only after confirming an active call.

## Permissions

MeetPods requires **Accessibility** permission on macOS to intercept media key events. This is the same permission used by apps like Karabiner, Hammerspoon, and BetterTouchTool.

The Chrome Extension requires:
- `tabs` — to detect which tabs have Google Meet open
- Host permission for `meet.google.com` — to inject the content script

## Limitations

- Only works with Google Meet (by design — focused solution)
- The native addon must be compiled on macOS (uses macOS-specific frameworks)
- Cannot be distributed via the Mac App Store (Accessibility permission is not allowed in sandboxed apps)
- Google Meet may change their DOM structure, requiring content script updates

## License

MIT
