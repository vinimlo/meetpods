# Setup and Development

## Prerequisites

| Requirement              | Minimum version | Note                                              |
| ------------------------ | --------------- | ------------------------------------------------- |
| macOS                    | 12 (Monterey)   | CGEventTap requires modern macOS                  |
| macOS (for AirPods mute) | 14 (Sonoma)     | AVAudioApplication available from macOS 14 onward |
| Node.js                  | 22+             | Required for N-API and node-gyp                   |
| Xcode CLT                | Any recent      | `xcode-select --install`                          |
| Google Chrome            | Any recent      | For the extension                                 |

## Installation

```bash
git clone <repo-url> meetpods
cd meetpods
npm install
```

## Commands

### Build

```bash
npm run build          # Full build (TypeScript + native)
npm run build:ts       # TypeScript only → dist/
npm run build:native   # Native addon only → src/native/build/Release/
```

### Run

```bash
npm start              # Full build + start Electron
npm run dev            # Build TS + start Electron (skips native rebuild)
npm run build && npx electron .   # Build and run separately
```

### Tests

```bash
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode
```

### Distribution

```bash
npm run dist           # Generate .dmg via electron-builder
```

### Icon generation

```bash
node scripts/generate-icons.js           # Tray icons (SVG → PNG @1x/@2x)
node scripts/generate-extension-icons.js  # Chrome extension icons
```

### Makefile

```bash
make build             # Alias for npm run build
make start             # Build + run
make dev               # Build TS + run
make test              # Tests
make clean             # Remove dist/ and src/native/build/
```

## Chrome Extension Installation

1. Open `chrome://extensions/`
2. Enable **Developer Mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `dist/extension/` folder

The extension will appear in the Chrome toolbar. Click its icon to see real-time status.

**Important:** The extension reconnects to Electron automatically. If you restart the Electron app, the extension reconnects within 5 seconds.

## macOS Permissions

### Accessibility (required)

On first launch, macOS will prompt for Accessibility permission. This is required for CGEventTap to intercept media keys.

If denied, the app cannot capture media keys. To grant later:
**System Settings → Privacy & Security → Accessibility → MeetPods ✓**

### Microphone (required to suppress AirPods notification)

On first launch, macOS will also prompt for Microphone permission. This is required for:

- `AVAudioApplication.setInputMuteStateChangeHandler` to work
- AUHAL to open audio input

If denied, the app still works via Darwin notification fallback, but the "Cannot Control Mic with AirPods Pro" notification will appear.

To grant later:
**System Settings → Privacy & Security → Microphone → MeetPods ✓**

## Folder Structure

```
meetpods/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # Main orchestrator
│   │   ├── media-key.ts         # Native addon wrapper
│   │   ├── native-msg.ts        # WebSocket server (bridge)
│   │   ├── tray.ts              # Menu bar icon and context menu
│   │   └── __tests__/           # Unit tests (vitest)
│   │       ├── integration.test.ts
│   │       └── media-key.test.ts
│   ├── native/                  # Native C++/ObjC++ addon
│   │   ├── media_key_tap.cc     # Main implementation
│   │   └── binding.gyp          # node-gyp configuration
│   └── extension/               # Chrome Extension (Manifest V3)
│       ├── manifest.json        # Permissions and configuration
│       ├── background.ts        # Service Worker (WebSocket ↔ tabs)
│       ├── content.ts           # Injected into Google Meet (DOM)
│       ├── popup.html           # Popup UI
│       ├── popup.ts             # Popup logic
│       └── icons/               # Extension icons
├── assets/                      # Tray icons (SVG + PNG @1x/@2x)
├── scripts/                     # Icon generation scripts
├── dist/                        # Compiled TypeScript output
├── docs/                        # Documentation
├── CLAUDE.md                    # Project memory (for AI)
├── package.json
├── tsconfig.json
├── electron-builder.yml         # electron-builder configuration
└── Makefile
```

## TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/native", "src/extension", "node_modules", "dist"]
}
```

- `src/native` and `src/extension` are excluded because they are not compiled by the main TypeScript config
- Output goes to `dist/main/` preserving the folder structure

## Electron Builder Configuration

```yaml
appId: com.meetpods.app
productName: MeetPods
mac:
  category: public.app-category.productivity
  target: dmg
  extendInfo:
    NSAccessibilityUsageDescription: '...'
    NSMicrophoneUsageDescription: '...'
extraResources:
  - from: src/native/build/Release/media_key_tap.node
    to: native/media_key_tap.node
  - from: dist/extension/
    to: extension/
```

Key points:

- `extendInfo` adds permission keys to the packaged app's Info.plist
- `extraResources` copies the native addon and Chrome extension into the final package
- The native addon is loaded from `process.resourcesPath` in production and from the build path in development

## Troubleshooting

### "Failed to create event tap"

- Accessibility permission not granted
- Fix: System Settings → Privacy & Security → Accessibility

### Native addon not found

- You need to run `npm run build:native` before running
- In production, the addon is copied to `resources/native/`

### Extension doesn't connect to Electron

- Make sure Electron is running (icon in the menu bar)
- The extension retries connection every 5s automatically
- Check service worker logs at chrome://extensions → MeetPods → service worker

### "Cannot Control Mic with AirPods Pro" still appears

- Check that microphone permission is granted to MeetPods
- Check logs for "AUHAL: audio input started" when joining a call
- Check logs for "AVAudioApplication mic mute handler registered" at startup

### Media keys don't work with Bluetooth

- CGEventTap MUST be on the main run loop (already configured this way)
- NSEvent fallback serves as a safety net
- Check logs to see if events are arriving
