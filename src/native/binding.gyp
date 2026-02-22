{
  "targets": [
    {
      "target_name": "media_key_tap",
      "sources": ["media_key_tap.cc"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "xcode_settings": {
        "OTHER_CFLAGS": ["-ObjC++"],
        "OTHER_LDFLAGS": [
          "-framework", "CoreGraphics",
          "-framework", "CoreFoundation",
          "-framework", "AppKit",
          "-framework", "AVFoundation",
          "-framework", "CoreAudio",
          "-framework", "AudioToolbox"
        ]
      }
    }
  ]
}
