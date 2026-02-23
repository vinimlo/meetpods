# References and Resources

## Reference Projects

### AirMute

- **URL:** https://github.com/CominAtYou/AirMute
- **Relevance:** Project that inspired the AUHAL implementation. Uses the same pattern: AUHAL audio unit + AVAudioApplication handler to control Discord mute via AirPods gesture.
- **Key learning:** Showed that AUHAL is the lightest way to satisfy AVAudioApplication's "active audio I/O" requirement.

### PodsMute

- **URL:** https://github.com/cyanicr/podsmute
- **Relevance:** Uses Darwin notification (`com.apple.audioaccessoryd.MuteState`) as the primary detection mechanism.
- **Key learning:** Confirmed the existence and reliability of Darwin notification as a detection channel for the mute gesture.

## Apple Documentation

### AVAudioApplication.h (Header)

- **Location:** Xcode → AVFoundation.framework → Headers → AVAudioApplication.h
- **Critical quote:**
  > "this notification will only be dispatched for state changes when there is an active record session"
- **Impact:** This comment explains why the handler never fires without active audio I/O.

### WWDC23 Session 10233

- **Title:** "Enhance your app's audio experience with AirPods"
- **URL:** https://developer.apple.com/wwdc23/10233
- **Relevant content:**
  - How to use `setInputMuteStateChangeHandler`
  - Active audio session requirement
  - Best practices for apps that support AirPods mute gesture

### Core Audio Overview

- **URL:** https://developer.apple.com/documentation/coreaudio
- **Relevance:** Reference for AudioUnit, AUHAL, and AudioObject APIs

### CGEventTap

- **URL:** https://developer.apple.com/documentation/coregraphics/cgeventtapcreate(_:_:_:_:_:_:)
- **Relevance:** Official documentation for the API used to intercept media keys

## macOS APIs Used

| API                                                 | Framework      | Documentation                                                                                                   |
| --------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| `CGEventTapCreate`                                  | CoreGraphics   | [Apple Docs](https://developer.apple.com/documentation/coregraphics/1454426-cgeventtapcreate)                   |
| `NSEvent addGlobalMonitorForEventsMatchingMask:`    | AppKit         | [Apple Docs](https://developer.apple.com/documentation/appkit/nsevent/1535472-addglobalmonitorforeventsmatchin) |
| `AVAudioApplication.setInputMuteStateChangeHandler` | AVFoundation   | [Apple Docs](https://developer.apple.com/documentation/avfaudio/avaudioapplication)                             |
| `CFNotificationCenterGetDarwinNotifyCenter`         | CoreFoundation | [Apple Docs](https://developer.apple.com/documentation/corefoundation/1542572-cfnotificationcentergetdarwinno)  |
| `AudioComponentFindNext`                            | AudioToolbox   | [Apple Docs](https://developer.apple.com/documentation/audiotoolbox/1440649-audiocomponentfindnext)             |
| `AudioUnitSetProperty`                              | AudioToolbox   | [Apple Docs](https://developer.apple.com/documentation/audiotoolbox/1440371-audiounitsetproperty)               |
| `AudioObjectGetPropertyData`                        | CoreAudio      | [Apple Docs](https://developer.apple.com/documentation/coreaudio/1422524-audioobjectgetpropertydata)            |

## Chrome Extension APIs Used

| API                        | Usage                                          |
| -------------------------- | ---------------------------------------------- |
| `chrome.tabs.query`        | Find Google Meet tabs                          |
| `chrome.tabs.onUpdated`    | Detect opening/closing of Meet tabs            |
| `chrome.tabs.sendMessage`  | Communicate with content script                |
| `chrome.runtime.onMessage` | Receive messages from content script and popup |
| `MutationObserver`         | Detect DOM changes in Meet (mute toggle)       |

## Key Concepts

### NX_SYSDEFINED

- macOS event type for special keys (media, brightness, volume)
- Subtype 8 = media keys
- keyCode 16 = play/pause (NX_KEYTYPE_PLAY)
- Format: data1 bits 16–31 = keyCode, bits 8–15 = flags (0xA = keyDown)

### AVRCP (Audio/Video Remote Control Profile)

- Bluetooth protocol for media control
- How AirPods send play/pause to the Mac
- Generates NX_SYSDEFINED on macOS

### audioaccessoryd

- macOS daemon that manages audio accessories (AirPods, etc.)
- Processes proprietary gestures (press-and-hold for mute)
- Emits Darwin notifications
- Generates the "Cannot Control Mic" notification

### N-API / node-addon-api

- Stable API for native Node.js addons
- ABI-stable: works across Node.js versions without recompilation
- `node-addon-api` is the C++ wrapper over the C-level N-API
- `ThreadSafeFunction` allows calling JS from any C++ thread
