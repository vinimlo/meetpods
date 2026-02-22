# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in MeetPods, please report it responsibly:

1. **Do not** open a public issue
2. Email **vinimelo@riseup.net** with details
3. Include steps to reproduce if possible

You should receive a response within 48 hours.

## Security Model

### WebSocket Server

MeetPods runs a WebSocket server on `127.0.0.1:18432` for communication between the Electron app and the Chrome extension.

- **Localhost only**: The server binds to `127.0.0.1`, not `0.0.0.0`. It is not reachable from other machines on the network.
- **No authentication**: Since the server is localhost-only, it relies on the OS network stack for isolation. Any local process can connect to it.

### Permissions

- **Accessibility** (macOS): Required for CGEventTap to intercept media key events. This is the same permission used by Karabiner, Hammerspoon, and BetterTouchTool.
- **Microphone** (macOS): Required for AVAudioApplication + AUHAL to suppress the "Cannot Control Mic" notification when using AirPods mute gesture.

### Native Addon

The native addon (`src/native/media_key_tap.cc`) uses macOS private APIs:

- `com.apple.audioaccessoryd.MuteState` Darwin notification — may change in future macOS versions
- `AVAudioApplication.setInputMuteStateChangeHandler` — official Apple API (macOS 14+)

### Chrome Extension

The extension requires:

- `tabs` permission — to detect Google Meet tabs
- Host permission for `meet.google.com` — to inject the content script

The extension does not collect, store, or transmit any user data.
