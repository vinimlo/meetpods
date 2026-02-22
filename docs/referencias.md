# Referencias e Recursos

## Projetos de Referencia

### AirMute
- **URL:** https://github.com/CominAtYou/AirMute
- **Relevancia:** Projeto que inspirou a implementacao do AUHAL. Usa o mesmo padrao: AUHAL audio unit + AVAudioApplication handler para controlar mute do Discord via gesto dos AirPods.
- **Aprendizado chave:** Mostrou que AUHAL e a maneira mais leve de satisfazer o requisito de "active audio I/O" do AVAudioApplication.

### PodsMute
- **URL:** https://github.com/cyanicr/podsmute
- **Relevancia:** Usa Darwin notification (`com.apple.audioaccessoryd.MuteState`) como mecanismo principal de deteccao.
- **Aprendizado chave:** Confirmou a existencia e confiabilidade da Darwin notification como canal de deteccao do gesto de mute.

## Documentacao Apple

### AVAudioApplication.h (Header)
- **Localizacao:** Xcode → AVFoundation.framework → Headers → AVAudioApplication.h
- **Citacao critica:**
  > "this notification will only be dispatched for state changes when there is an active record session"
- **Impacto:** Este comentario explica por que o handler nunca dispara sem audio I/O ativo.

### WWDC23 Session 10233
- **Titulo:** "Enhance your app's audio experience with AirPods"
- **URL:** https://developer.apple.com/wwdc23/10233
- **Conteudo relevante:**
  - Como usar `setInputMuteStateChangeHandler`
  - Requisito de audio session ativa
  - Best practices para apps que suportam AirPods mute gesture

### Core Audio Overview
- **URL:** https://developer.apple.com/documentation/coreaudio
- **Relevancia:** Referencia para AudioUnit, AUHAL, AudioObject APIs

### CGEventTap
- **URL:** https://developer.apple.com/documentation/coregraphics/cgeventtapcreate(_:_:_:_:_:_:)
- **Relevancia:** Documentacao oficial do API usado para interceptar media keys

## APIs macOS Utilizadas

| API | Framework | Documentacao |
|-----|-----------|-------------|
| `CGEventTapCreate` | CoreGraphics | [Apple Docs](https://developer.apple.com/documentation/coregraphics/1454426-cgeventtapcreate) |
| `NSEvent addGlobalMonitorForEventsMatchingMask:` | AppKit | [Apple Docs](https://developer.apple.com/documentation/appkit/nsevent/1535472-addglobalmonitorforeventsmatchin) |
| `AVAudioApplication.setInputMuteStateChangeHandler` | AVFoundation | [Apple Docs](https://developer.apple.com/documentation/avfaudio/avaudioapplication) |
| `CFNotificationCenterGetDarwinNotifyCenter` | CoreFoundation | [Apple Docs](https://developer.apple.com/documentation/corefoundation/1542572-cfnotificationcentergetdarwinno) |
| `AudioComponentFindNext` | AudioToolbox | [Apple Docs](https://developer.apple.com/documentation/audiotoolbox/1440649-audiocomponentfindnext) |
| `AudioUnitSetProperty` | AudioToolbox | [Apple Docs](https://developer.apple.com/documentation/audiotoolbox/1440371-audiounitsetproperty) |
| `AudioObjectGetPropertyData` | CoreAudio | [Apple Docs](https://developer.apple.com/documentation/coreaudio/1422524-audioobjectgetpropertydata) |

## APIs Chrome Extension Utilizadas

| API | Uso |
|-----|-----|
| `chrome.tabs.query` | Buscar tabs do Google Meet |
| `chrome.tabs.onUpdated` | Detectar abertura/fechamento de tabs Meet |
| `chrome.tabs.sendMessage` | Comunicar com content script |
| `chrome.runtime.onMessage` | Receber mensagens do content script e popup |
| `MutationObserver` | Detectar mudancas no DOM do Meet (mute toggle) |

## Conceitos Chave

### NX_SYSDEFINED
- Tipo de evento macOS para teclas especiais (media, brilho, volume)
- Subtype 8 = media keys
- keyCode 16 = play/pause (NX_KEYTYPE_PLAY)
- Formato: data1 bits 16-31 = keyCode, bits 8-15 = flags (0xA = keyDown)

### AVRCP (Audio/Video Remote Control Profile)
- Protocolo Bluetooth para controle de media
- Como AirPods enviam play/pause para o Mac
- Gera NX_SYSDEFINED no macOS

### audioaccessoryd
- Daemon do macOS que gerencia acessorios de audio (AirPods, etc)
- Processa gestos proprietarios (press-and-hold para mute)
- Emite Darwin notifications
- Gera a notificacao "Cannot Control Mic"

### N-API / node-addon-api
- API estavel para addons nativos do Node.js
- ABI-stable: funciona entre versoes do Node sem recompilar
- `node-addon-api` e o wrapper C++ sobre o C-level N-API
- `ThreadSafeFunction` permite chamar JS de qualquer thread C++
