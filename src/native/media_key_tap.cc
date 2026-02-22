#include <napi.h>
#include <atomic>
#include <CoreGraphics/CoreGraphics.h>
#include <AppKit/AppKit.h>
#include <AVFoundation/AVFoundation.h>
#include <CoreAudio/CoreAudio.h>
#include <AudioToolbox/AudioToolbox.h>
#include <dispatch/dispatch.h>

#define NX_KEYTYPE_PLAY 16

// Named constants for dedup windows and health check interval
static const uint64_t kTapDedupWindowMs = 200;
static const uint64_t kMuteDedupWindowMs = 500;
static const uint64_t kHealthCheckIntervalSec = 5;

// Reusable property address for default input device queries
static const AudioObjectPropertyAddress kDefaultInputDeviceAddr = {
    kAudioHardwarePropertyDefaultInputDevice,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
};

static Napi::ThreadSafeFunction tsfn;
static bool tsfnStarted = false;
static CFMachPortRef eventPort = nullptr;
static CFRunLoopSourceRef eventSource = nullptr;
static std::atomic<bool> shouldConsumeEvent{false};
static id globalMonitor = nil;
static std::atomic<uint64_t> lastTapEventTimeMs{0};
static dispatch_source_t healthTimer = nullptr;
static std::atomic<uint64_t> lastAirpodsMuteTimeMs{0};
static const void *kDarwinObserver = &kDarwinObserver;

// AUHAL: lightweight audio input unit to satisfy macOS "active audio I/O" requirement.
// Without this, AVAudioApplication.setInputMuteStateChangeHandler never fires.
static AudioComponentInstance auHAL = nullptr;
static AudioBufferList *inputBufferList = nullptr;
static UInt32 inputBufferChannels = 0;
static bool deviceListenerInstalled = false;

static uint64_t currentTimeMs() {
    return (uint64_t)([[NSDate date] timeIntervalSince1970] * 1000.0);
}

// Helper: extract media key data from an NSEvent with subtype 8
struct MediaKeyData { int keyCode; bool keyDown; };
static MediaKeyData extractMediaKeyData(NSEvent *event) {
    int data1 = [event data1];
    int keyCode = (data1 & 0xFFFF0000) >> 16;
    int keyFlags = data1 & 0x0000FFFF;
    bool keyDown = ((keyFlags & 0xFF00) >> 8) == 0xA;
    return { keyCode, keyDown };
}

// Helper: check if an AirPods mute event is a duplicate within the dedup window
static bool isDuplicateAirpodsMute(uint64_t windowMs, const char *source) {
    uint64_t now = currentTimeMs();
    uint64_t lastMute = lastAirpodsMuteTimeMs.load();
    if (now - lastMute < windowMs) {
        fprintf(stderr, "[MeetPods:native] %s: skipping (handled %llums ago)\n", source, now - lastMute);
        return true;
    }
    lastAirpodsMuteTimeMs.store(now);
    return false;
}

static void fireMediaKeyCallback(bool keyDown) {
    auto* flag = new bool(keyDown);
    tsfn.NonBlockingCall(flag, [](Napi::Env env, Napi::Function jsCallback, bool* data) {
        jsCallback.Call({
            Napi::String::New(env, "play_pause"),
            Napi::Boolean::New(env, *data)
        });
        delete data;
    });
}

// Darwin notification callback for AirPods stem mute gesture
// Fires system-wide when audioaccessoryd processes AirPods mute — no mic permission needed
static void darwinMuteNotificationCallback(
    CFNotificationCenterRef center,
    void *observer,
    CFNotificationName name,
    const void *object,
    CFDictionaryRef userInfo
) {
    if (isDuplicateAirpodsMute(kMuteDedupWindowMs, "Darwin mute notification")) return;
    fprintf(stderr, "[MeetPods:native] Darwin notification: AirPods mute gesture detected\n");
    fireMediaKeyCallback(true);
}

static CGEventRef eventTapCallback(
    CGEventTapProxy proxy,
    CGEventType type,
    CGEventRef event,
    void* userInfo
) {
    if (type == kCGEventTapDisabledByTimeout) {
        fprintf(stderr, "[MeetPods:native] Event tap disabled by timeout, re-enabling\n");
        if (eventPort) {
            CGEventTapEnable(eventPort, true);
        }
        return event;
    }

    if (type != NX_SYSDEFINED) {
        return event;
    }

    NSEvent* nsEvent = [NSEvent eventWithCGEvent:event];
    if ([nsEvent subtype] != 8) {
        return event;
    }

    auto [keyCode, keyDown] = extractMediaKeyData(nsEvent);

    if (keyCode != NX_KEYTYPE_PLAY) {
        return event;
    }

    fprintf(stderr, "[MeetPods:native] Play/Pause key event (CGEventTap) — keyDown=%d\n", keyDown);

    if (keyDown) {
        lastTapEventTimeMs.store(currentTimeMs());
        fireMediaKeyCallback(keyDown);
    }

    if (shouldConsumeEvent.load(std::memory_order_relaxed)) {
        fprintf(stderr, "[MeetPods:native] CONSUMING event (returning nullptr)\n");
        return nullptr;
    }
    fprintf(stderr, "[MeetPods:native] PASSING THROUGH event (shouldConsume=false)\n");
    return event;
}

// ── AUHAL helpers ──────────────────────────────────────────────────────

static AudioDeviceID getDefaultInputDeviceID() {
    AudioDeviceID deviceID = kAudioObjectUnknown;
    UInt32 size = sizeof(deviceID);
    OSStatus err = AudioObjectGetPropertyData(kAudioObjectSystemObject, &kDefaultInputDeviceAddr, 0, nullptr, &size, &deviceID);
    if (err != noErr) {
        fprintf(stderr, "[MeetPods:native] AUHAL: failed to get default input device (err=%d)\n", (int)err);
        return kAudioObjectUnknown;
    }
    return deviceID;
}

static OSStatus auhalInputCallback(
    void *inRefCon,
    AudioUnitRenderActionFlags *ioActionFlags,
    const AudioTimeStamp *inTimeStamp,
    UInt32 inBusNumber,
    UInt32 inNumberFrames,
    AudioBufferList *ioData
) {
    // Pull audio data from the input device and discard it.
    // This render call is what makes macOS consider us an active recording app.
    if (auHAL && inputBufferList) {
        for (UInt32 i = 0; i < inputBufferList->mNumberBuffers; i++) {
            inputBufferList->mBuffers[i].mDataByteSize = inNumberFrames * sizeof(Float32);
        }
        AudioUnitRender(auHAL, ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames, inputBufferList);
    }
    return noErr;
}

static void freeInputBuffers() {
    if (inputBufferList) {
        for (UInt32 i = 0; i < inputBufferChannels; i++) {
            free(inputBufferList->mBuffers[i].mData);
        }
        free(inputBufferList);
        inputBufferList = nullptr;
    }
    inputBufferChannels = 0;
}

// Forward declarations
static bool setupAUHAL();
static void teardownAUHAL();

static OSStatus defaultInputDeviceChanged(
    AudioObjectID inObjectID,
    UInt32 inNumberAddresses,
    const AudioObjectPropertyAddress inAddresses[],
    void *inClientData
) {
    fprintf(stderr, "[MeetPods:native] AUHAL: default input device changed — restarting audio input\n");
    // Teardown and re-setup on the main queue to avoid threading issues
    dispatch_async(dispatch_get_main_queue(), ^{
        if (auHAL) {
            teardownAUHAL();
            setupAUHAL();
        }
    });
    return noErr;
}

static void installDeviceChangeListener() {
    if (deviceListenerInstalled) return;
    OSStatus err = AudioObjectAddPropertyListener(
        kAudioObjectSystemObject, &kDefaultInputDeviceAddr, defaultInputDeviceChanged, nullptr
    );
    if (err == noErr) {
        deviceListenerInstalled = true;
        fprintf(stderr, "[MeetPods:native] AUHAL: device change listener installed\n");
    } else {
        fprintf(stderr, "[MeetPods:native] AUHAL: failed to install device change listener (err=%d)\n", (int)err);
    }
}

static void removeDeviceChangeListener() {
    if (!deviceListenerInstalled) return;
    AudioObjectRemovePropertyListener(
        kAudioObjectSystemObject, &kDefaultInputDeviceAddr, defaultInputDeviceChanged, nullptr
    );
    deviceListenerInstalled = false;
    fprintf(stderr, "[MeetPods:native] AUHAL: device change listener removed\n");
}

static bool setupAUHAL() {
    if (auHAL) {
        fprintf(stderr, "[MeetPods:native] AUHAL: already active\n");
        return true;
    }

    AudioDeviceID inputDevice = getDefaultInputDeviceID();
    if (inputDevice == kAudioObjectUnknown) {
        fprintf(stderr, "[MeetPods:native] AUHAL: no input device available\n");
        return false;
    }

    AudioComponentDescription desc = {};
    desc.componentType = kAudioUnitType_Output;
    desc.componentSubType = kAudioUnitSubType_HALOutput;
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;

    AudioComponent comp = AudioComponentFindNext(nullptr, &desc);
    if (!comp) {
        fprintf(stderr, "[MeetPods:native] AUHAL: AudioComponentFindNext failed\n");
        return false;
    }

    OSStatus err = AudioComponentInstanceNew(comp, &auHAL);
    if (err != noErr) {
        fprintf(stderr, "[MeetPods:native] AUHAL: AudioComponentInstanceNew failed (err=%d)\n", (int)err);
        auHAL = nullptr;
        return false;
    }

    // Enable input (bus 1), disable output (bus 0)
    UInt32 enableIO = 1;
    UInt32 disableIO = 0;
    err = AudioUnitSetProperty(auHAL, kAudioOutputUnitProperty_EnableIO,
                               kAudioUnitScope_Input, 1, &enableIO, sizeof(enableIO));
    if (err != noErr) { fprintf(stderr, "[MeetPods:native] AUHAL: enable input failed (err=%d)\n", (int)err); goto cleanup; }

    err = AudioUnitSetProperty(auHAL, kAudioOutputUnitProperty_EnableIO,
                               kAudioUnitScope_Output, 0, &disableIO, sizeof(disableIO));
    if (err != noErr) { fprintf(stderr, "[MeetPods:native] AUHAL: disable output failed (err=%d)\n", (int)err); goto cleanup; }

    err = AudioUnitSetProperty(auHAL, kAudioOutputUnitProperty_CurrentDevice,
                               kAudioUnitScope_Global, 0, &inputDevice, sizeof(inputDevice));
    if (err != noErr) { fprintf(stderr, "[MeetPods:native] AUHAL: set input device failed (err=%d)\n", (int)err); goto cleanup; }

    {
        AudioStreamBasicDescription streamFormat = {};
        UInt32 formatSize = sizeof(streamFormat);
        err = AudioUnitGetProperty(auHAL, kAudioUnitProperty_StreamFormat,
                                   kAudioUnitScope_Output, 1, &streamFormat, &formatSize);
        if (err != noErr) { fprintf(stderr, "[MeetPods:native] AUHAL: get stream format failed (err=%d)\n", (int)err); goto cleanup; }

        inputBufferChannels = streamFormat.mChannelsPerFrame;
        if (inputBufferChannels == 0) inputBufferChannels = 1;
    }

    {
        // Allocate input buffer list
        UInt32 bufferListSize = offsetof(AudioBufferList, mBuffers) + sizeof(AudioBuffer) * inputBufferChannels;
        inputBufferList = (AudioBufferList *)calloc(1, bufferListSize);
        inputBufferList->mNumberBuffers = inputBufferChannels;

        UInt32 maxFrames = 0;
        UInt32 maxFramesSize = sizeof(maxFrames);
        AudioUnitGetProperty(auHAL, kAudioUnitProperty_MaximumFramesPerSlice,
                             kAudioUnitScope_Global, 0, &maxFrames, &maxFramesSize);
        if (maxFrames == 0) maxFrames = 4096;

        for (UInt32 i = 0; i < inputBufferChannels; i++) {
            inputBufferList->mBuffers[i].mNumberChannels = 1;
            inputBufferList->mBuffers[i].mDataByteSize = maxFrames * sizeof(Float32);
            inputBufferList->mBuffers[i].mData = calloc(maxFrames, sizeof(Float32));
        }
    }

    {
        AURenderCallbackStruct callbackStruct = {};
        callbackStruct.inputProc = auhalInputCallback;
        callbackStruct.inputProcRefCon = nullptr;
        err = AudioUnitSetProperty(auHAL, kAudioOutputUnitProperty_SetInputCallback,
                                   kAudioUnitScope_Global, 0, &callbackStruct, sizeof(callbackStruct));
        if (err != noErr) { fprintf(stderr, "[MeetPods:native] AUHAL: set input callback failed (err=%d)\n", (int)err); goto cleanup; }
    }

    err = AudioUnitInitialize(auHAL);
    if (err != noErr) { fprintf(stderr, "[MeetPods:native] AUHAL: AudioUnitInitialize failed (err=%d)\n", (int)err); goto cleanup; }

    err = AudioOutputUnitStart(auHAL);
    if (err != noErr) {
        fprintf(stderr, "[MeetPods:native] AUHAL: AudioOutputUnitStart failed (err=%d)\n", (int)err);
        AudioUnitUninitialize(auHAL);
        goto cleanup;
    }

    fprintf(stderr, "[MeetPods:native] AUHAL: audio input started (channels=%u)\n", (unsigned)inputBufferChannels);
    installDeviceChangeListener();
    return true;

cleanup:
    freeInputBuffers();
    AudioComponentInstanceDispose(auHAL);
    auHAL = nullptr;
    return false;
}

static void teardownAUHAL() {
    if (!auHAL) return;

    fprintf(stderr, "[MeetPods:native] AUHAL: stopping audio input\n");
    removeDeviceChangeListener();

    AudioOutputUnitStop(auHAL);
    AudioUnitUninitialize(auHAL);
    AudioComponentInstanceDispose(auHAL);
    auHAL = nullptr;
    freeInputBuffers();

    fprintf(stderr, "[MeetPods:native] AUHAL: audio input stopped\n");
}

Napi::Value StartAudioInput(const Napi::CallbackInfo& info) {
    bool ok = setupAUHAL();
    return Napi::Boolean::New(info.Env(), ok);
}

Napi::Value StopAudioInput(const Napi::CallbackInfo& info) {
    teardownAUHAL();
    return info.Env().Undefined();
}

Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    tsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "MediaKeyCallback", 0, 1);
    tsfnStarted = true;

    eventPort = CGEventTapCreate(
        kCGSessionEventTap,
        kCGHeadInsertEventTap,
        kCGEventTapOptionDefault,
        CGEventMaskBit(NX_SYSDEFINED),
        eventTapCallback,
        nullptr
    );

    if (!eventPort) {
        fprintf(stderr, "[MeetPods:native] FAILED to create event tap — Accessibility permission missing?\n");
        Napi::Error::New(env, "Failed to create event tap. Is Accessibility permission granted?").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    fprintf(stderr, "[MeetPods:native] Event tap created successfully\n");
    eventSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventPort, 0);

    // Use MAIN run loop — critical for receiving Bluetooth HID events (AirPods)
    // Background threads don't receive NX_SYSDEFINED from Bluetooth on modern macOS
    CFRunLoopAddSource(CFRunLoopGetMain(), eventSource, kCFRunLoopCommonModes);
    CGEventTapEnable(eventPort, true);
    fprintf(stderr, "[MeetPods:native] Event tap added to MAIN run loop and enabled\n");

    // NSEvent global monitor as fallback for Bluetooth media keys
    // CGEventTap may miss some Bluetooth HID events; this catches them
    globalMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskSystemDefined
        handler:^(NSEvent *event) {
            if ([event subtype] != 8) return;

            auto [keyCode, keyDown] = extractMediaKeyData(event);
            if (keyCode != NX_KEYTYPE_PLAY || !keyDown) return;

            // Deduplicate: skip if CGEventTap already handled this within the tap dedup window
            uint64_t now = currentTimeMs();
            uint64_t lastTap = lastTapEventTimeMs.load();
            if (now - lastTap < kTapDedupWindowMs) {
                fprintf(stderr, "[MeetPods:native] NSEvent fallback: skipping (CGEventTap handled %llums ago)\n",
                        now - lastTap);
                return;
            }

            fprintf(stderr, "[MeetPods:native] Play/Pause key event (NSEvent fallback) — keyDown=%d\n", keyDown);
            fireMediaKeyCallback(keyDown);
        }
    ];
    fprintf(stderr, "[MeetPods:native] NSEvent global monitor installed as fallback\n");

    // AVAudioApplication: handle AirPods Pro mic mute stem press (macOS 14+)
    // AirPods stem press sends a "mic mute" command, NOT a media key.
    // Without this handler, macOS shows "Cannot Control Mic with AirPods Pro".
    // Requires mic permission AND active audio input to receive callbacks.
    if (@available(macOS 14.0, *)) {
        AVAudioApplication *audioApp = AVAudioApplication.sharedInstance;
        NSError *error = nil;
        BOOL ok = [audioApp setInputMuteStateChangeHandler:^BOOL(BOOL inputShouldBeMuted) {
            fprintf(stderr, "[MeetPods:native] AirPods mic mute event (AVAudioApplication) — inputShouldBeMuted=%d\n",
                    inputShouldBeMuted);

            if (!isDuplicateAirpodsMute(kMuteDedupWindowMs, "AVAudioApplication")) {
                fireMediaKeyCallback(true);
            }
            return YES;  // Accept = suppresses "Cannot Control Mic" notification
        } error:&error];
        if (ok) {
            fprintf(stderr, "[MeetPods:native] AVAudioApplication mic mute handler registered (AirPods support)\n");
        } else {
            fprintf(stderr, "[MeetPods:native] AVAudioApplication handler FAILED: %s\n",
                    error ? [[error localizedDescription] UTF8String] : "unknown error");
        }
    }

    // Darwin notification: reliable fallback for AirPods mute gesture
    // Works WITHOUT mic permission — fires system-wide when audioaccessoryd processes mute.
    // If AVAudioApplication handler also fires, bidirectional dedup prevents double-toggle.
    CFNotificationCenterAddObserver(
        CFNotificationCenterGetDarwinNotifyCenter(),
        kDarwinObserver,
        darwinMuteNotificationCallback,
        CFSTR("com.apple.audioaccessoryd.MuteState"),
        nullptr,
        CFNotificationSuspensionBehaviorDeliverImmediately
    );
    fprintf(stderr, "[MeetPods:native] Darwin notification observer installed for AirPods mute gesture\n");

    // Health check: re-enable event tap if macOS disables it
    healthTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(healthTimer,
        dispatch_time(DISPATCH_TIME_NOW, kHealthCheckIntervalSec * NSEC_PER_SEC),
        kHealthCheckIntervalSec * NSEC_PER_SEC,
        1 * NSEC_PER_SEC);
    dispatch_source_set_event_handler(healthTimer, ^{
        if (eventPort && !CGEventTapIsEnabled(eventPort)) {
            fprintf(stderr, "[MeetPods:native] Health check: event tap was disabled, re-enabling\n");
            CGEventTapEnable(eventPort, true);
        }
    });
    dispatch_resume(healthTimer);
    fprintf(stderr, "[MeetPods:native] Health check timer started (every %llus)\n", kHealthCheckIntervalSec);

    return Napi::Boolean::New(env, true);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
    fprintf(stderr, "[MeetPods:native] Stopping event tap\n");

    // Stop AUHAL audio input if active
    teardownAUHAL();

    // Stop health check timer
    if (healthTimer) {
        dispatch_source_cancel(healthTimer);
        healthTimer = nullptr;
    }

    // Remove Darwin notification observer
    CFNotificationCenterRemoveObserver(
        CFNotificationCenterGetDarwinNotifyCenter(),
        kDarwinObserver,
        CFSTR("com.apple.audioaccessoryd.MuteState"),
        nullptr
    );

    // Unregister AirPods mic mute handler
    if (@available(macOS 14.0, *)) {
        [AVAudioApplication.sharedInstance setInputMuteStateChangeHandler:nil error:nil];
    }

    // Remove NSEvent global monitor
    if (globalMonitor) {
        [NSEvent removeMonitor:globalMonitor];
        globalMonitor = nil;
    }

    // Remove event tap from main run loop and clean up
    if (eventSource) {
        CFRunLoopRemoveSource(CFRunLoopGetMain(), eventSource, kCFRunLoopCommonModes);
        CFRelease(eventSource);
        eventSource = nullptr;
    }
    if (eventPort) {
        CGEventTapEnable(eventPort, false);
        CFRelease(eventPort);
        eventPort = nullptr;
    }

    if (tsfnStarted) {
        tsfn.Release();
        tsfnStarted = false;
    }
    fprintf(stderr, "[MeetPods:native] Event tap stopped and cleaned up\n");
    return info.Env().Undefined();
}

Napi::Value SetConsume(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Boolean required").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    bool consume = info[0].As<Napi::Boolean>().Value();
    shouldConsumeEvent.store(consume, std::memory_order_relaxed);
    fprintf(stderr, "[MeetPods:native] SetConsume(%s)\n", consume ? "true" : "false");
    return env.Undefined();
}

Napi::Value IsActive(const Napi::CallbackInfo& info) {
    bool active = eventPort != nullptr && CGEventTapIsEnabled(eventPort);
    return Napi::Boolean::New(info.Env(), active);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("start", Napi::Function::New(env, Start));
    exports.Set("stop", Napi::Function::New(env, Stop));
    exports.Set("setConsume", Napi::Function::New(env, SetConsume));
    exports.Set("isActive", Napi::Function::New(env, IsActive));
    exports.Set("startAudioInput", Napi::Function::New(env, StartAudioInput));
    exports.Set("stopAudioInput", Napi::Function::New(env, StopAudioInput));
    return exports;
}

NODE_API_MODULE(media_key_tap, Init)
