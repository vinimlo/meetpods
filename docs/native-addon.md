# Native Addon: Guia Tecnico

## Visao Geral

O addon nativo (`src/native/media_key_tap.cc`) e escrito em Objective-C++ e compilado com `node-gyp`. Usa N-API (via `node-addon-api`) para se comunicar com o processo Electron.

## Build

### Frameworks linkados

| Framework      | Uso                                                    |
| -------------- | ------------------------------------------------------ |
| CoreGraphics   | CGEventTap para interceptar teclas de midia            |
| CoreFoundation | CFRunLoop, CFNotificationCenter (Darwin notifications) |
| AppKit         | NSEvent globalMonitor                                  |
| AVFoundation   | AVAudioApplication (handler de mute dos AirPods)       |
| CoreAudio      | AudioObjectGetPropertyData (device ID do mic)          |
| AudioToolbox   | AudioUnit (AUHAL para audio input)                     |

### Configuracao em binding.gyp

```json
{
  "xcode_settings": {
    "OTHER_CFLAGS": ["-ObjC++"],
    "OTHER_LDFLAGS": [
      "-framework",
      "CoreGraphics",
      "-framework",
      "CoreFoundation",
      "-framework",
      "AppKit",
      "-framework",
      "AVFoundation",
      "-framework",
      "CoreAudio",
      "-framework",
      "AudioToolbox"
    ]
  }
}
```

A flag `-ObjC++` e essencial — sem ela, o compilador nao entende a sintaxe `[NSEvent ...]` e `@available(macOS 14.0, *)`.

### Compilacao

```bash
npm run build:native
# equivalente a: node-gyp rebuild --directory=src/native
```

O output fica em `src/native/build/Release/media_key_tap.node`.

## Exports N-API

| Export              | Assinatura JS                             | Descricao                          |
| ------------------- | ----------------------------------------- | ---------------------------------- |
| `start(callback)`   | `(key: string, keyDown: boolean) => void` | Inicia todos os listeners          |
| `stop()`            | `() => void`                              | Para e limpa todos os recursos     |
| `setConsume(bool)`  | `(consume: boolean) => void`              | Define se eventos sao consumidos   |
| `isActive()`        | `() => boolean`                           | Verifica se o event tap esta ativo |
| `startAudioInput()` | `() => boolean`                           | Inicia AUHAL (retorna true se ok)  |
| `stopAudioInput()`  | `() => void`                              | Para AUHAL                         |

## CGEventTap

### O que e

Um "tap" no sistema de eventos do macOS que permite interceptar e opcionalmente consumir eventos antes que cheguem aos apps de destino.

### Configuracao

```cpp
eventPort = CGEventTapCreate(
    kCGSessionEventTap,        // escopo: sessao do usuario (nao root)
    kCGHeadInsertEventTap,     // posicao: inicio da cadeia
    kCGEventTapOptionDefault,  // modo: pode consumir eventos
    CGEventMaskBit(NX_SYSDEFINED),  // filtro: so eventos de sistema
    eventTapCallback,
    nullptr
);
```

### Detalhes criticos

**Must run on main run loop:**

```cpp
CFRunLoopAddSource(CFRunLoopGetMain(), eventSource, kCFRunLoopCommonModes);
```

CGEventTap em threads de background NAO recebe eventos Bluetooth HID no macOS moderno. Isso foi um bug dificil de diagnosticar — funciona com teclado USB mas nao com Bluetooth.

**Consumo de eventos:**
O callback retorna `nullptr` para consumir o evento ou `event` para passar adiante. A decisao de consumir e controlada por `shouldConsumeEvent` (mutex-protected), que e atualizado pelo TypeScript via `setConsume()`.

**Timeout automatico:**
O macOS desativa event taps que ficam muito tempo sem responder. O callback trata `kCGEventTapDisabledByTimeout` re-habilitando o tap. Alem disso, um health check timer a cada 5s verifica e re-habilita se necessario.

### Parsing do evento

```cpp
NSEvent* nsEvent = [NSEvent eventWithCGEvent:event];
if ([nsEvent subtype] != 8) return event;  // subtype 8 = media key

int data1 = [nsEvent data1];
int keyCode = (data1 & 0xFFFF0000) >> 16;   // bits 16-31
int keyFlags = data1 & 0x0000FFFF;           // bits 0-15
bool keyDown = ((keyFlags & 0xFF00) >> 8) == 0xA;  // 0xA = key down
```

Codigos relevantes:

- `NX_KEYTYPE_PLAY` (16): Play/Pause
- `NX_KEYTYPE_NEXT` (17): Proxima faixa
- `NX_KEYTYPE_PREVIOUS` (18): Faixa anterior

## NSEvent Global Monitor

### Por que um fallback?

CGEventTap pode perder alguns eventos Bluetooth HID em certas condicoes. O NSEvent global monitor serve como rede de seguranca:

```objc
globalMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskSystemDefined
    handler:^(NSEvent *event) {
        // mesma logica de parsing, mas com dedup de 200ms
    }
];
```

**Diferenca chave:** NSEvent monitor NAO pode consumir eventos (e read-only). So o CGEventTap pode.

## AVAudioApplication Handler

### Registrado em `Start()`

```objc
if (@available(macOS 14.0, *)) {
    AVAudioApplication *audioApp = AVAudioApplication.sharedInstance;
    [audioApp setInputMuteStateChangeHandler:^BOOL(BOOL inputShouldBeMuted) {
        // dedup bidirecional com Darwin notification
        // retorna YES para suprimir notificacao
        return YES;
    } error:&error];
}
```

### Removido em `Stop()`

```objc
[AVAudioApplication.sharedInstance setInputMuteStateChangeHandler:nil error:nil];
```

## AUHAL Audio Unit

### Objetivo

Criar uma sessao de gravacao minima para que o macOS reconheca o app como tendo "active audio I/O". Isso faz o handler do AVAudioApplication disparar quando o gesto de mute ocorre.

### Implementacao resumida

1. Obtem device ID do microfone padrao via `AudioObjectGetPropertyData`
2. Cria audio unit `kAudioUnitSubType_HALOutput`
3. Enable input (bus 1), disable output (bus 0)
4. Define o device de input
5. Le formato do stream para saber numero de canais
6. Aloca buffers para os canais
7. Registra render callback via `kAudioOutputUnitProperty_SetInputCallback`
8. Initialize + Start

O render callback simplesmente chama `AudioUnitRender()` para puxar os dados e nao faz nada com eles.

### Cleanup

`teardownAUHAL()` faz na ordem:

1. `AudioOutputUnitStop`
2. `AudioUnitUninitialize`
3. `AudioComponentInstanceDispose`
4. Free de todos os buffers

## ThreadSafeFunction

Toda comunicacao do C++ para JavaScript usa `Napi::ThreadSafeFunction`. Isso e necessario porque os callbacks (CGEventTap, Darwin notification, AVAudioApplication) acontecem em threads diferentes:

```cpp
tsfn = Napi::ThreadSafeFunction::New(env, jsCallback, "MediaKeyCallback", 0, 1);

// Em qualquer thread:
tsfn.NonBlockingCall(eventData, [](Napi::Env env, Napi::Function jsCallback, MediaKeyEvent* data) {
    jsCallback.Call({
        Napi::String::New(env, "play_pause"),
        Napi::Boolean::New(env, data->keyDown)
    });
    delete data;
});
```

O `NonBlockingCall` e seguro para chamar de qualquer thread e enfileira a execucao no event loop do Node.js.

## Variaveis Atomicas

| Variavel                | Tipo               | Uso                                     |
| ----------------------- | ------------------ | --------------------------------------- |
| `lastTapEventTimeMs`    | `atomic<uint64_t>` | Dedup entre CGEventTap e NSEvent        |
| `lastAirpodsMuteTimeMs` | `atomic<uint64_t>` | Dedup entre AVAudioApplication e Darwin |

Usamos atomics ao inves de mutexes porque os acessos sao simples load/store e nao precisamos de ordering complexo. Sao usados por multiplas threads simultaneamente (main thread, event tap thread, Darwin notification thread).
