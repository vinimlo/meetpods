# Stem Press Source — System Log Behind a Flag

## Problem

On macOS 27 the AirPods stem press no longer reaches third-party apps (see AGENTS.md §16):

- `com.apple.audioaccessoryd.MuteState` is no longer posted.
- `audiomxd` rejects every press for MeetPods with `audio app is not allowed to input mute (isOptedIn: 0, hasHandler: 1)` and plays the "rejected" chime. `isOptedIn` is set by AVFAudio only when a system feature flag is on, and it is off. No public API sets it.
- Checked on 27.0 (26A428, 2026-10-05) and again on 27.0.1 (26A434, 2026-10-08): same rejection.

The press still reaches the Mac. `bluetoothd` logs `Received Software Mute (control cmd 0x27)` on every press, including during a real Meet call where Chrome holds the mic and MeetPods is closed.

**Latency probe (2026-10-08).** A plain Node process spawning `log stream --style ndjson` with a `bluetoothd` predicate received 6 of 6 presses during a real Meet call, each 0–51 ms after the logged timestamp (5 of 6 within 3 ms). Fast enough to feel instant.

**Goal.** The stem press toggles Meet again on macOS 27, without losing the official path: if Apple turns the feature flag on, switching back must be one click, with the old code intact and still tested.

## Design

### The flag

- New setting `stemPressSource: 'system-log' | 'audio-api'` in `settings.json`.
- Default when the key is absent: `'system-log'` on macOS 27 or later, `'audio-api'` before (where the API works and also suppresses the rejected chime). The macOS version comes from `process.getSystemVersion()`. The value is written only when the user picks one.
- Tray submenu **AirPods Stem Press** with two radio items, **System Log** and **Audio API**. A change applies immediately, no restart.
- Exactly one source delivers stem presses at a time.

### What each source runs

|                                                  | `system-log`                | `audio-api` (current behavior)  |
| ------------------------------------------------ | --------------------------- | ------------------------------- |
| CGEventTap for play/pause keys (`addon.start()`) | yes                         | yes                             |
| `airpods_mute` events from the native addon      | ignored in main             | handled (state-aware)           |
| `setInputMuted` sync (`syncInputMuteState`)      | no                          | yes                             |
| AUHAL audio input (`syncAudioInput`)             | no                          | yes                             |
| `log stream` watcher                             | yes, while in a call        | no                              |
| Microphone permission request                    | no                          | yes                             |
| What a press means                               | toggle Meet's current state | `inputShouldBeMuted` from macOS |

The native addon does not change. `addon.start()` still registers the AVAudioApplication handler and the Darwin observer, but without AUHAL MeetPods is not recording, so the handler cannot fire. If Apple brings back only the Darwin notification, main drops the `airpods_mute` event in `system-log` mode, so a press never toggles twice.

### `StemLogWatcher` (`src/main/stem-log-watcher.ts`)

An `EventEmitter` with `start()`, `stop()` and one event, `stem-press`.

- `start()` (idempotent) spawns:
  `/usr/bin/log stream --style ndjson --predicate 'process == "bluetoothd" AND eventMessage CONTAINS "Received Software Mute"'`
- stdout is split into lines, keeping a partial line until its newline arrives. Each line is parsed as JSON. Lines that are not JSON (the `Filtering the log data using …` header) are skipped. A JSON line whose `eventMessage` lacks `Received Software Mute` is skipped too. Every remaining line emits `stem-press`.
- `stop()` cancels a pending restart and kills the child (SIGTERM). An exit after `stop()` does not restart.
- If the child exits or fails to spawn while the watcher should be running, it restarts after 1 s, then 2 s, 4 s, … capped at 30 s. The delay goes back to 1 s when a press is received.
- Logs use the tag `[MeetPods:stem-log]`, like the other modules.

### Wiring in `src/main/index.ts`

- `stemPressSource` is read from the settings at the start of the `whenReady` callback, before the microphone check.
- `ensureMicPermission()` (the current startup code, moved into a function) runs only for `audio-api`: at startup, and when the user switches to it.
- `syncInputMuteState()` and `syncAudioInput()` act only for `audio-api`. In `system-log` mode `syncInputMuteState()` resets `syncedInputMuted`, and `syncAudioInput()` stops AUHAL if it is running.
- New `syncStemWatcher()`: the watcher runs iff `stemPressSource === 'system-log' && enabled && lastMeetStatus.active`. `updateTrayState()` calls it last, after `syncAudioInput()`, keeping the existing order for the audio-api path.
- `mediaKeys.on('media-key')`: in `system-log` mode an `airpods_mute` event is logged and dropped.
- `stemWatcher.on('stem-press')` calls `handleMediaKey(true)`. `handleMediaKey` gains an `isAirpods` parameter (default `false`) that only selects the feedback timing already used for AirPods: the sound plays 300 ms after the toggle, and the `pendingFeedback` fallback keeps that delay.
- Tray change handler: set `stemPressSource`, `saveSettings({ stemPressSource })`, run `ensureMicPermission()` when switching to `audio-api`, then `updateTrayState()`. Switching mid-call therefore stops AUHAL and starts the watcher (or the reverse) in one pass.
- `before-quit` also calls `stemWatcher.stop()`.

### Tray (`src/main/tray.ts`)

`setStemPressSource(source)` and `setOnStemPressSourceChanged(handler)`, following the `setShowMuteHud` / `setOnShowMuteHudChanged` pattern. The submenu sits right after **Show Mute HUD**.

## Error Handling

| Situation                                          | Behavior                                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `log stream` exits or fails to spawn during a call | Restart with backoff (1 s → 30 s cap). Presses during the gap are lost, and the gap is in the app log.                                    |
| Apple changes the log text                         | No presses arrive, silently. Not detected automatically. AGENTS.md §16 documents the probe command, and the flag switches to `audio-api`. |
| One press logged twice                             | The existing 500 ms debounce in `handleMediaKey` absorbs it.                                                                              |
| Press with no call                                 | The watcher only runs during a call, and `handleMediaKey` checks the Meet state anyway.                                                   |
| Extension disconnected                             | Unchanged: `handleMediaKey` skips the press.                                                                                              |

## Testing

Unit (vitest, mocks in the style of the existing tests):

- `stem-log-watcher.test.ts` (new, `child_process` mocked): emits on a matching line; skips the header and non-matching JSON; joins a line split across two chunks; `start()` is idempotent; `stop()` kills and does not restart; unexpected exit restarts with growing delays and the 30 s cap (fake timers); a press resets the delay; a spawn `error` follows the same restart path.
- `settings.test.ts` (new): default `system-log` on 27.x, `audio-api` on 26.x; a saved value wins over the default.
- `tray.test.ts`: the submenu shows the current source, and clicking a radio item calls the handler.
- `index.test.ts`: the settings mock returns `audio-api` so every current test keeps covering the official path. New cases for `system-log`: AUHAL and `setInputMuted` never run; the watcher starts with a call and stops when it ends or when MeetPods is disabled; `stem-press` toggles Meet with the delayed sound; `airpods_mute` is ignored; no microphone request. Switching source mid-call in both directions; switching to `audio-api` requests the microphone when it is not granted. `before-quit` stops the watcher.
- Every new or changed line is covered. The global thresholds in `vitest.config.ts` already fail before this work (86.8% lines on 2026-10-08, from files this change does not touch), so the check is per file.

Manual, on the real machine:

1. From source with the fake Meet client: a press reaches the client as `toggle_mute`, and no `AUHAL` line appears in the app log.
2. Real Meet call: a press mutes and unmutes, the MeetPods sound follows the rejected chime, and the only mic indicator is Chrome's.
3. Switch the tray to **Audio API** mid-call: AUHAL starts and the press is rejected as before. Switch back: AUHAL stops and presses toggle again.
4. Packaged app (`.dmg` installed in `/Applications`): repeat step 2. This confirms the signed app bundle can run `/usr/bin/log`.

## Out of Scope

- Detecting automatically that Apple changed the log text, or that the feature flag came back.
- Silencing the rejected chime (not possible from a third-party app).
- Native addon changes.
- The pre-existing coverage gap and the Prettier warnings in extension files committed before this work.
- Version bump, GitHub release, publishing.
