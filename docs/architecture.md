# Arquitetura do MeetPods

## Visao Geral

MeetPods e uma aplicacao de menu bar para macOS que permite usar o gesto de mute dos AirPods (pressionar e segurar a haste) para mutar/desmutar o microfone no Google Meet. Tambem intercepta teclas de midia (play/pause) para o mesmo proposito.

## Tres Camadas

```
┌────────────────────────────────────────────────────────────────────────┐
│                        macOS / Hardware                                │
│  AirPods stem press ──► audioaccessoryd ──► Darwin Notification        │
│  AirPods single press ──► Bluetooth AVRCP ──► NX_SYSDEFINED           │
└───────────────────────────────┬────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│              Camada 1: Native Addon (C++/ObjC++)                       │
│              src/native/media_key_tap.cc                                │
│                                                                        │
│  ┌─────────────┐  ┌───────────────┐  ┌──────────────────────────┐     │
│  │ CGEventTap   │  │ NSEvent       │  │ AVAudioApplication       │     │
│  │ (media keys) │  │ globalMonitor │  │ inputMuteStateChange     │     │
│  └──────┬───────┘  └──────┬────────┘  │ Handler (macOS 14+)     │     │
│         │                 │           └────────────┬─────────────┘     │
│         │                 │                        │                    │
│  ┌──────┴─────────────────┴───┐  ┌────────────────┴───────────────┐   │
│  │ Dedup: 200ms window        │  │ Darwin Notification Observer   │   │
│  │ (lastTapEventTimeMs)       │  │ com.apple.audioaccessoryd      │   │
│  └────────────┬───────────────┘  │ .MuteState                    │   │
│               │                  └────────────┬───────────────────┘   │
│               │  ┌──────────────────────────┐ │                       │
│               │  │ Dedup: 500ms bidirectional│ │                       │
│               │  │ (lastAirpodsMuteTimeMs)   │ │                       │
│               │  └──────────────────────────┘ │                       │
│               │                               │                       │
│  ┌────────────┴───────────────────────────────┴───────────────────┐   │
│  │              AUHAL Audio Unit                                   │   │
│  │  kAudioUnitSubType_HALOutput (input habilitado, output off)     │   │
│  │  Render callback descarta audio — satisfaz "active I/O"         │   │
│  │  Ligado/desligado dinamicamente conforme estado da chamada      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│               │                                                        │
│               ▼                                                        │
│     ThreadSafeFunction → callback JavaScript                           │
└───────────────────────────────┬────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│             Camada 2: Electron Main Process (TypeScript)                │
│             src/main/                                                   │
│                                                                        │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐          │
│  │ index.ts      │  │ media-key.ts   │  │ native-msg.ts    │          │
│  │ Orquestrador  │  │ Wrapper NAPI   │  │ WebSocket Server │          │
│  │ principal     │  │ do addon nativo│  │ (porta 18432)    │          │
│  └──────┬────────┘  └────────────────┘  └────────┬─────────┘          │
│         │                                         │                    │
│  ┌──────┴───────┐                                 │                    │
│  │ tray.ts      │                                 │                    │
│  │ Icone menu   │                                 │                    │
│  │ bar + menu   │                                 │                    │
│  └──────────────┘                                 │                    │
└───────────────────────────────────────────────────┬────────────────────┘
                                                    │
                                    WebSocket 127.0.0.1:18432
                                                    │
                                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│             Camada 3: Chrome Extension (Manifest V3)                   │
│             src/extension/                                             │
│                                                                        │
│  ┌───────────────┐  ┌─────────────┐  ┌──────────────────────┐        │
│  │ background.ts  │  │ content.ts  │  │ popup.html/popup.ts  │        │
│  │ Service Worker │  │ Injetado no │  │ UI de status         │        │
│  │ WebSocket ↔    │  │ Google Meet │  │                      │        │
│  │ Electron       │  │ DOM mute    │  │                      │        │
│  └───────┬────────┘  └──────┬──────┘  └──────────────────────┘        │
│          │                  │                                          │
│          └──────────────────┘                                          │
│          chrome.runtime.sendMessage                                    │
└────────────────────────────────────────────────────────────────────────┘
```

## Fluxo de Comunicacao

### Interceptacao de Media Key (play/pause simples)

```
1. AirPods stem press (toque simples)
2. Bluetooth AVRCP → macOS gera NX_SYSDEFINED (subtype 8, keyCode 16)
3. CGEventTap captura o evento
   └─ NSEvent globalMonitor serve como fallback (dedup 200ms)
4. ThreadSafeFunction envia para JS: fireMediaKeyCallback(16, true)
5. MediaKeyManager emite evento 'media-key'
6. index.ts:handleMediaKey() recebe
7. ExtensionBridge envia {type: 'toggle_mute'} via WebSocket
8. background.js recebe e repassa via chrome.tabs.sendMessage
9. content.js encontra o botao de mute e faz .click()
10. content.js responde com {success: true, muted: <novo estado>}
11. Resposta volta pela cadeia ate index.ts atualizar tray
```

### Gesto de Mute dos AirPods (press-and-hold)

```
1. AirPods stem press-and-hold (gesto de mute)
2. Bluetooth proprietary → audioaccessoryd daemon
3. DOIS caminhos paralelos:
   a) Darwin Notification: com.apple.audioaccessoryd.MuteState
   b) AVAudioApplication.inputMuteStateChangeHandler (se AUHAL ativo)
4. Dedup bidirecional (500ms) — o primeiro que chegar ganha
5. fireMediaKeyCallback(16, true) — mesmo caminho do media key
6. ... restante identico ao fluxo acima
```

### Supressao da Notificacao "Cannot Control Mic"

```
1. Usuario entra em chamada Meet → status active=true
2. syncAudioInput() → setupAUHAL()
3. AUHAL comeca a puxar audio do microfone (e descartar)
4. macOS reconhece MeetPods como app com audio I/O ativo
5. Usuario faz gesto de mute nos AirPods
6. AVAudioApplication handler dispara (porque ha I/O ativo)
7. Handler retorna YES → notificacao SUPRIMIDA
8. Usuario sai da chamada → status active=false
9. syncAudioInput() → teardownAUHAL()
10. Indicador de microfone desaparece
```

## Componentes por Arquivo

### `src/native/media_key_tap.cc`

| Funcao                                   | Responsabilidade                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `eventTapCallback()`                     | Intercepta NX_SYSDEFINED via CGEventTap                                           |
| `darwinMuteNotificationCallback()`       | Recebe Darwin notification do audioaccessoryd                                     |
| `auhalInputCallback()`                   | Render callback — chama AudioUnitRender e descarta                                |
| `setupAUHAL()` / `teardownAUHAL()`       | Gerencia ciclo de vida do audio unit                                              |
| `Start()`                                | Registra CGEventTap, NSEvent monitor, AVAudioApplication handler, Darwin observer |
| `Stop()`                                 | Limpa todos os recursos                                                           |
| `SetConsume()`                           | Controla se eventos sao consumidos ou passados adiante                            |
| `StartAudioInput()` / `StopAudioInput()` | N-API exports para controle do AUHAL                                              |

### `src/main/index.ts`

| Funcao              | Responsabilidade                              |
| ------------------- | --------------------------------------------- |
| `shouldConsume()`   | Decide se media keys devem ser consumidos     |
| `syncConsume()`     | Atualiza o estado de consumo no addon nativo  |
| `syncAudioInput()`  | Liga/desliga AUHAL conforme estado da chamada |
| `updateTrayState()` | Atualiza icone do tray e sincroniza tudo      |
| `handleMediaKey()`  | Logica principal: query + toggle mute         |

### `src/main/media-key.ts`

Wrapper TypeScript sobre o addon nativo. Herda de `EventEmitter` e emite:

- `media-key`: quando uma tecla de midia e pressionada
- `status`: quando o listener inicia/para
- `error`: em caso de falha

### `src/main/native-msg.ts`

Servidor WebSocket na porta 18432 (127.0.0.1 apenas). Gerencia:

- Conexoes de clientes (extensao Chrome)
- Broadcast de mensagens
- Request/response com timeout de 2s para `queryMeetStatus` e `toggleMute`

### `src/main/tray.ts`

Gerencia icone no menu bar com 3 estados visuais:

- `idle`: microfone cinza (sem chamada)
- `in-call`: microfone com ondas (na chamada, mic ligado)
- `muted`: microfone com risco (na chamada, mutado)

### `src/extension/background.ts`

Service Worker que:

- Mantem WebSocket com Electron
- Rastreia tabs do Google Meet (Map por tabId)
- Roteia mensagens entre Electron ↔ content script
- Reconecta automaticamente a cada 5s se desconectar

### `src/extension/content.ts`

Injetado em paginas do Google Meet:

- Busca botao de mute via seletores CSS (suporte multi-idioma)
- MutationObserver para detectar mudancas de estado
- Faz `.click()` no botao de mute quando solicitado
- Poll de seguranca a cada 5s

### `src/extension/popup.html` + `popup.ts`

UI da extensao mostrando status em tempo real:

- Electron App: Connected / Offline
- Google Meet: In call / No call
- Microphone: Mic ON / Muted
