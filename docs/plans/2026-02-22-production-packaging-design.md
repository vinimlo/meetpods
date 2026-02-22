# MeetPods Production Packaging & Distribution Design

## Summary

Enable building MeetPods as a standalone .dmg installer so it can be installed in `/Applications` and launched like any Mac app — no `npm run start` needed.

## Decisions

- **Toolchain:** electron-builder (already configured, extend existing setup)
- **Signing:** Ad-hoc (`mac.identity: null`) — no Apple Developer account needed
- **Icon/Branding:** Separate design phase using frontend-design skill
- **Extension:** Bundled in app Resources; CWS-ready structure for future publishing

## Build Pipeline

```
npm run dist
  1. npm run build:ts        → TypeScript compilation
  2. npm run build:ext        → Chrome extension bundle
  3. electron-rebuild          → Rebuild native addon against Electron ABI
  4. electron-builder          → Package .app → .dmg
```

### Native Addon Rebuild

The critical gap: `media_key_tap.node` must be compiled against Electron's Node ABI, not the system Node ABI. Using `@electron/rebuild` to handle this in a `beforeBuild` hook.

## App Bundle Structure

```
MeetPods.app/Contents/
├── MacOS/MeetPods
├── Resources/
│   ├── app.asar
│   ├── native/media_key_tap.node  (Electron ABI)
│   ├── extension/                 (Chrome extension)
│   └── assets/                    (Icons, tray images)
└── Info.plist
```

## electron-builder.yml Changes

- Add `mac.identity: null` for ad-hoc signing
- Add `beforeBuild` hook for electron-rebuild
- Verify extraResources paths work with rebuilt native addon
- Add tray icon assets to extraResources

## First-Launch Flow

1. User drags MeetPods.app to /Applications
2. First launch: right-click → Open (bypasses Gatekeeper for unsigned apps)
3. macOS prompts for Accessibility permission
4. macOS prompts for Microphone permission
5. Tray icon appears, app is ready
6. User loads Chrome extension from app Resources (instructions shown)

## Extension CWS Readiness

- Proper manifest.json versioning synced with app version
- Complete icon set and metadata
- No code changes needed — metadata hygiene only

## Branding (Separate Phase)

- App icon: 1024x1024 PNG → .icns conversion
- Tray icons: 22x22 @1x/@2x, light/dark variants
- DMG background image (optional)
- Designed using /frontend-design skill
