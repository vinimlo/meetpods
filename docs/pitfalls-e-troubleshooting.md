# Pitfalls e Troubleshooting

Registro de todos os problemas encontrados durante o desenvolvimento, suas causas raiz e solucoes. Este documento e especialmente util para debugging futuro.

## Pitfalls Criticos

### 1. CGEventTap em background thread nao recebe eventos Bluetooth

**Sintoma:** Media keys do teclado USB funcionam, mas AirPods nao geram nenhum evento.

**Causa:** CGEventTap adicionado a um run loop de background thread nao recebe eventos `NX_SYSDEFINED` originados de dispositivos Bluetooth no macOS moderno.

**Solucao:**
```cpp
// CORRETO: main run loop
CFRunLoopAddSource(CFRunLoopGetMain(), eventSource, kCFRunLoopCommonModes);

// ERRADO: background thread run loop
CFRunLoopAddSource(CFRunLoopGetCurrent(), eventSource, kCFRunLoopCommonModes);
```

---

### 2. AVAudioApplication handler registra mas nunca dispara

**Sintoma:** `setInputMuteStateChangeHandler` retorna sucesso (BOOL YES, sem erro), mas o callback nunca e executado quando o usuario pressiona o stem dos AirPods.

**Causa:** O handler so e invocado quando o app tem **audio I/O ativo**. Registrar o handler sozinho nao e suficiente.

**Solucao:** Criar um AUHAL audio unit que puxa dados do microfone (e descarta). Ver `setupAUHAL()` em `media_key_tap.cc`.

**Evidencia:** Header `AVAudioApplication.h` da Apple:
> "this notification will only be dispatched for state changes when there is an active record session"

---

### 3. macOS desativa event tap por timeout

**Sintoma:** Media keys param de funcionar apos algum tempo sem uso.

**Causa:** macOS automaticamente desativa event taps que ficam "stuck" ou nao respondem rapido o suficiente.

**Solucao (duas camadas):**
1. No callback, tratar `kCGEventTapDisabledByTimeout`:
```cpp
if (type == kCGEventTapDisabledByTimeout) {
    CGEventTapEnable(eventPort, true);
    return event;
}
```

2. Health check timer a cada 5 segundos:
```cpp
if (eventPort && !CGEventTapIsEnabled(eventPort)) {
    CGEventTapEnable(eventPort, true);
}
```

---

### 4. Notificacao "Cannot Control Mic" nao pode ser filtrada

**Sintoma:** A notificacao aparece mesmo com o handler registrado.

**Causa:** A notificacao e gerada pelo `audioaccessoryd` e nao e uma `UNNotification` que pode ser interceptada ou escondida. A unica maneira de suprimi-la e ter o handler do `AVAudioApplication` ativo e retornando `YES`, com audio I/O ativo.

**Solucao:** AUHAL + AVAudioApplication handler retornando YES (todo o pipeline completo).

---

### 5. Double-toggle de mute (muta e desmuta instantaneamente)

**Sintoma:** Ao pressionar o stem dos AirPods, o Meet muta e imediatamente desmuta (ou vice-versa).

**Causa:** Multiplas fontes de eventos disparam para o mesmo gesto:
- CGEventTap + NSEvent para media keys
- AVAudioApplication + Darwin notification para AirPods mute

**Solucao:** Deduplicacao baseada em timestamps atomicos:
- 200ms window para CGEventTap + NSEvent
- 500ms window bidirecional para AVAudioApplication + Darwin

---

### 6. Press-and-hold dos AirPods nao gera NX_SYSDEFINED

**Sintoma:** Toque simples funciona, mas press-and-hold nao gera nenhum evento no CGEventTap.

**Causa:** Press-and-hold e um gesto de mute proprietario que segue um caminho completamente diferente no macOS (Bluetooth proprietary → audioaccessoryd). Nao e um media key.

**Solucao:** Usar Darwin notification e/ou AVAudioApplication handler, que sao os unicos caminhos para detectar esse gesto.

---

### 7. NSEvent monitor nao pode consumir eventos

**Sintoma:** Eventos interceptados pelo NSEvent fallback passam para outros apps (Spotify pausa/resume).

**Causa:** `addGlobalMonitorForEventsMatchingMask:` e read-only — nao pode modificar ou consumir eventos. So o CGEventTap pode.

**Impacto:** Se o CGEventTap captura o evento, ele e consumido. Se so o NSEvent captura, o evento chega a outros apps. Na pratica, isso raramente e problema porque o CGEventTap e a fonte primaria.

---

## Troubleshooting por Log

O MeetPods usa tags em todos os logs para facilitar filtragem:

| Tag | Componente |
|-----|-----------|
| `[MeetPods:native]` | Addon C++/ObjC++ |
| `[MeetPods:media-key]` | Wrapper TypeScript do addon |
| `[MeetPods:bridge]` | WebSocket server |
| `[MeetPods:main]` | Orquestrador principal (index.ts) |
| `[MeetPods:bg]` | Background service worker |
| `[MeetPods:content]` | Content script no Meet |

### Logs esperados na inicializacao

```
[MeetPods:main] App ready, initializing...
[MeetPods:main] Accessibility permission: GRANTED
[MeetPods:main] Microphone permission: granted
[MeetPods:native] Event tap created successfully
[MeetPods:native] Event tap added to MAIN run loop and enabled
[MeetPods:native] NSEvent global monitor installed as fallback
[MeetPods:native] AVAudioApplication mic mute handler registered (AirPods support)
[MeetPods:native] Darwin notification observer installed for AirPods mute gesture
[MeetPods:native] Health check timer started (every 5s)
[MeetPods:media-key] Media key listener started successfully
[MeetPods:bridge] WebSocket server listening on 127.0.0.1:18432
```

### Logs esperados ao entrar em chamada

```
[MeetPods:bridge] Client connected (total: 1)
[MeetPods:main] meet-status push: active=true, muted=false
[MeetPods:main] syncAudioInput() → started (ok=true)
[MeetPods:native] AUHAL: audio input started (channels=1)
```

### Logs esperados ao usar AirPods stem (press-and-hold)

**Cenario ideal (AVAudioApplication + dedup):**
```
[MeetPods:native] AirPods mic mute event (AVAudioApplication) — inputShouldBeMuted=1
[MeetPods:native] Darwin mute notification: skipping (handled 23ms ago)
[MeetPods:main] media-key event received: play_pause
[MeetPods:main] handleMediaKey() — toggling mute...
```

**Cenario fallback (sem mic permission):**
```
[MeetPods:native] Darwin notification: AirPods mute gesture detected
[MeetPods:main] media-key event received: play_pause
[MeetPods:main] handleMediaKey() — toggling mute...
```

### Logs esperados ao sair da chamada

```
[MeetPods:main] meet-status push: active=false, muted=false
[MeetPods:main] syncAudioInput() → stopped
[MeetPods:native] AUHAL: stopping audio input
[MeetPods:native] AUHAL: audio input stopped
```

## Checklist de Diagnostico

Se algo nao funciona, siga esta ordem:

1. **Permissao de Acessibilidade?**
   - Log: `Accessibility permission: GRANTED` ou `NOT GRANTED`

2. **Event tap criado?**
   - Log: `Event tap created successfully` ou `FAILED to create event tap`

3. **Extensao conectada?**
   - Log: `Client connected (total: N)`

4. **Meet detectado?**
   - Log: `meet-status push: active=true`

5. **AUHAL ativo?** (para AirPods mute gesture)
   - Log: `AUHAL: audio input started`

6. **Permissao de microfone?**
   - Log: `Microphone permission: granted` ou `denied`

7. **Eventos chegando?**
   - Media key: `Play/Pause key event (CGEventTap)`
   - AirPods mute: `AirPods mic mute event (AVAudioApplication)` ou `Darwin notification: AirPods mute gesture detected`

8. **Toggle executado?**
   - Log: `handleMediaKey() — toggling mute...`
   - Log: `toggle result: success=true, muted=<estado>`
