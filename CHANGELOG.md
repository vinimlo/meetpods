# Changelog

All notable changes to MeetPods will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-02-22

Initial release — toggle Google Meet mute via AirPods media keys on macOS.

### Added

- Native C++/ObjC++ addon using CGEventTap to intercept media keys (play/pause)
- NSEvent global monitor as fallback for Bluetooth HID events
- AVAudioApplication mute state handler for AirPods press-and-hold gesture (macOS 14+)
- Darwin notification listener (`com.apple.audioaccessoryd.MuteState`) as fallback without mic permission
- AUHAL audio unit for satisfying active audio I/O requirement (dynamic start/stop tied to call state)
- Bidirectional deduplication (200ms for CGEventTap/NSEvent, 500ms for AVAudioApplication/Darwin)
- Health check timer to re-enable event taps disabled by macOS timeout
- Chrome extension (Manifest V3) with content script for Google Meet DOM mute toggle
- Multi-language mute button selectors (English, Portuguese, German)
- WebSocket bridge (127.0.0.1:18432) between Electron and Chrome extension
- Background service worker with automatic reconnection
- MutationObserver + 10s polling for Meet call state detection
- Menu bar tray app with three icon states (disconnected, muted, unmuted)
- Smart media key lifecycle — only intercepts keys when extension is connected and Meet call is active
- Production packaging with DMG installer via electron-builder
- CI/CD with GitHub Actions (build, test, lint on macOS)
- Release workflow with automatic GitHub Release on version tags
- Comprehensive test suite with full coverage (vitest)
- Architecture documentation, troubleshooting guide, and design decision records
