# Design Decisions

A record of architectural decisions made during MeetPods development, with context on alternatives considered and reasons for each choice.

## 1. WebSocket instead of Chrome Native Messaging

**Choice:** Local WebSocket server on port 18432 (127.0.0.1)

**Discarded alternative:** Chrome Native Messaging (stdio)

**Reason:** Native Messaging requires Chrome to launch a separate binary via stdin/stdout. Since MeetPods already runs as an Electron app, this would require an additional IPC layer between the Native Messaging binary and Electron. WebSocket is more direct — the extension connects straight to the Electron process.

**Trade-off:** WebSocket requires a fixed port (18432). If another application uses the same port, there will be a conflict. In practice, this is rare.

## 2. DOM click instead of keyboard shortcut

**Choice:** Content script calls `.click()` on the mute button directly in the Google Meet DOM.

**Discarded alternative:** Send `Cmd+D` (Meet's keyboard shortcut for toggling mute).

**Reason:** Sending `Cmd+D` requires focus on the Chrome window, which would steal focus from whatever app the user is currently using. DOM click works in the background without affecting any window.

**Trade-off:** Dependency on Google Meet's DOM structure. If Google changes selectors/attributes, the content script needs to be updated.

## 3. Synchronous event consumption with async flag management

**Problem:** CGEventTap decides synchronously whether to consume an event (returns nullptr or event). But checking whether there's an active Meet call requires async communication (query via WebSocket).

**Choice:** A `shouldConsumeEvent` flag (mutex-protected) that is kept updated asynchronously. When `enabled && connected && meetActive`, the flag is true and events are consumed.

**Discarded alternative:** Always consume and programmatically emit play/pause when there's no call.

**Reason:** The alternative would be more complex and could cause issues with other media apps. Better to let the event pass through naturally when not in a call.

## 4. CGEventTap + NSEvent fallback (dual capture)

**Choice:** Use CGEventTap as primary source and NSEvent global monitor as fallback, with 200ms deduplication.

**Reason:** CGEventTap can miss Bluetooth HID events under certain rare conditions on macOS. NSEvent globalMonitor is more reliable for Bluetooth but cannot consume events. The combination covers both scenarios.

## 5. Dynamic AUHAL (tied to call state) vs. permanent AUHAL

**Choice:** Enable AUHAL only when there's an active Meet call; disable when there isn't.

**Discarded alternative:** Keep AUHAL always active to simplify the code.

**Reason:** Active AUHAL = permanent orange microphone indicator in the macOS menu bar. This is confusing and concerning for users. By enabling it only during calls, the indicator appears only when Chrome is already showing one (because of Meet).

**Trade-off:** More complex lifecycle management code. But the UX is much better.

## 6. Darwin notification as fallback (not sole source)

**Choice:** Use both Darwin notification (`com.apple.audioaccessoryd.MuteState`) AND AVAudioApplication handler, with bidirectional deduplication.

**Considered alternative:** Use only Darwin notification.

**Reason:** Darwin notification does not suppress the "Cannot Control Mic" notification. Only the AVAudioApplication handler with active audio I/O does that. But Darwin notification works without microphone permission, so it serves as a graceful fallback when the user doesn't grant mic access.

## 7. Deduplication with atomic timestamps (not mutexes)

**Choice:** `std::atomic<uint64_t>` for dedup timestamps.

**Alternative:** Mutexes to protect deduplication logic.

**Reason:** The accesses are simple load/store operations. Atomics are lighter (no locks, no contention) and sufficient for this usage pattern. Mutexes would be overkill for operations that don't need critical sections.

## 8. Periodic 10s poll + MutationObserver

**Choice:** Electron polls every 10s to check Meet state, and the content script uses MutationObserver for push-based updates.

**Reason:** MutationObserver is the primary and most responsive source. The 10s poll is a safety net against:

- MutationObserver missing a mutation
- Chrome service worker being suspended and waking up
- Meet tab being reloaded

## 9. Multi-language selectors for the mute button

**Choice:** Multiple CSS selectors for different languages (English, Portuguese, German).

**Alternative:** Use only `data-is-muted` without `aria-label` filtering.

**Reason:** `button[data-is-muted]` alone could match other buttons (camera mute, for example). Filtering by aria-label ensures we find the CORRECT microphone button. Multiple languages ensure coverage for Brazilian and other international users.

## 10. Tray app (no main window)

**Choice:** App lives solely in the menu bar. Dock icon hidden via `app.dock?.hide()`.

**Reason:** MeetPods is a background utility. It doesn't need a window. The menu bar is sufficient to show status (3 icon states) and provide control (context menu with toggle and quit).

## 11. Fixed port 18432

**Choice:** WebSocket server on port 18432, hardcoded.

**Alternative:** Dynamic port with discovery.

**Reason:** The Chrome extension needs to know the port in advance. With a dynamic port, a discovery mechanism would be needed (file on disk, another protocol). A fixed port is simple and works. 18432 was chosen because it's high enough to not conflict with common services.

## 12. node-addon-api (N-API) instead of NAN

**Choice:** `node-addon-api` (C++ wrapper over N-API).

**Reason:** N-API is ABI-stable — the compiled addon works across different Node.js versions without recompilation. NAN requires recompilation per version. Since Electron embeds its own Node version, ABI stability simplifies distribution.
