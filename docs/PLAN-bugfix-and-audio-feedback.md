# MeetPods — Plano de Execucao: Bug Auto-Mute + Audio Feedback

> Documento de planejamento para Claude Code executar de forma eficiente.

---

## Problema 1: Auto-Mute Periodico (Bug)

### Sintoma

O usuario esta em chamada com microfone aberto. A cada intervalo de tempo (< 1 minuto), o MeetPods automaticamente muta o microfone sem nenhuma acao do usuario.

### Analise de Causa Raiz

O MeetPods tem **4 fontes de eventos** que disparam mute toggle, todas convergindo para `fireMediaKeyCallback(true)` no addon nativo:

| Fonte | Arquivo | Linha |
|-------|---------|-------|
| CGEventTap (media key fisico) | `media_key_tap.cc` | 124-126 |
| NSEvent global monitor (fallback) | `media_key_tap.cc` | 389-406 |
| AVAudioApplication handler (AirPods) | `media_key_tap.cc` | 418-426 |
| Darwin notification (AirPods fallback) | `media_key_tap.cc` | 81-91, 438-445 |

**Hipotese principal: Darwin notification `com.apple.audioaccessoryd.MuteState` dispara espuriamente.**

Razoes:

1. **Esta notificacao e uma API privada** (nao documentada pela Apple). O `audioaccessoryd` pode enviar esta notificacao por diversas razoes alem do gesto de mute do AirPods:
   - Mudancas de roteamento de audio
   - Reconexoes Bluetooth
   - Ajustes de cancelamento de ruido ativo (ANC)
   - Atualizacoes de firmware do AirPods
   - Manutencao da conexao Bluetooth LE

2. **O codigo trata toda notificacao como um toggle** — nao verifica o estado real. A callback (`darwinMuteNotificationCallback`, linha 81-91) dispara `fireMediaKeyCallback(true)` incondicionalmente (apos dedup de 500ms). Se a notificacao dispara a cada ~30-60 segundos, o dedup de 500ms ja expirou e cada disparo gera um novo toggle.

3. **O AVAudioApplication handler tambem ignora o parametro `inputShouldBeMuted`** (linha 418-426). Ele recebe um booleano dizendo se o sistema QUER mutar, mas o codigo ignora e faz toggle cego.

4. **Restart do AUHAL pode gerar eventos**: O `defaultInputDeviceChanged` callback (linha 184-199) faz teardown + setup do AUHAL. Esse restart pode causar uma mudanca de sessao de audio que dispara o AVAudioApplication handler ou a Darwin notification.

**Hipotese secundaria: Multiplas conexoes WebSocket.**

Na `ExtensionBridge` (`native-msg.ts`), o metodo `broadcast()` envia para TODOS os clients conectados. Se houver mais de uma instancia da extensao conectada (ex: multiplas abas do Meet, ou extensao recarregada), o `toggleMute` pode ser enviado mais de uma vez. Porem isso e menos provavel como causa periodica.

### Estrategia de Correcao

A correcao deve ser feita em **3 camadas**:

#### Camada 1: Tornar o sistema state-aware (em vez de toggle cego)

**Problema fundamental**: O sistema trata todo evento como "toggle". Deveria ser "set state".

**Mudancas necessarias:**

**1a. Extensao — adicionar `setMute(muted: boolean)` alem de `toggleMute()`**

Arquivo: `src/extension/content.ts`

```typescript
// Nova funcao: setar estado especifico (nao toggle)
function setMute(targetMuted: boolean): Promise<{ success: boolean; muted?: boolean; error?: string }> {
  muteButton = findMuteButton();
  if (!muteButton) {
    return Promise.resolve({ success: false, error: 'Mute button not found' });
  }
  const currentlyMuted = muteButton.getAttribute('data-is-muted') === 'true';
  if (currentlyMuted === targetMuted) {
    // Ja esta no estado desejado — nao clicar
    return Promise.resolve({ success: true, muted: currentlyMuted });
  }
  // Estado diferente — clicar para mudar
  muteButton.click();
  return new Promise((resolve) => {
    setTimeout(() => {
      checkCallStatus();
      resolve({ success: true, muted: isMuted });
    }, POST_CLICK_DELAY_MS);
  });
}
```

Adicionar handler no `chrome.runtime.onMessage`:
```typescript
if (message.type === 'set_mute') {
  setMute(message.muted).then(sendResponse);
  return true;
}
```

**1b. Background script — adicionar rota `set_mute`**

Arquivo: `src/extension/background.ts`

Adicionar novo case no `ws.onmessage`:
```typescript
case 'set_mute': {
  const result = await sendToMeetTab('setMute', 'set_mute', { success: false, error: 'No Meet tab' });
  // Propagar o muted target para o content script
  ws!.send(JSON.stringify({ type: 'mute_set', ...result, requestId: message.requestId }));
  break;
}
```

E na funcao `sendToMeetTab`, passar dados extras:
```typescript
// Para set_mute, incluir o campo muted na mensagem
case 'set_mute':
  const tabId = getBestMeetTab();
  if (!tabId) return fallback;
  const response = await chrome.tabs.sendMessage(tabId, { type: 'set_mute', muted: message.muted });
  return { ...response, tabId };
```

Nota: a funcao `sendToMeetTab` precisa ser refatorada levemente para suportar passar dados extras na mensagem ao content script, ou criar uma funcao dedicada para `set_mute`.

**1c. Bridge — adicionar metodo `setMute(muted: boolean)`**

Arquivo: `src/main/native-msg.ts`

```typescript
setMute(muted: boolean): Promise<MuteResult> {
  // Send muted state along with the request
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      this.removeListener('mute-set', handler);
      resolve({ success: false, error: 'Timeout' });
    }, REQUEST_TIMEOUT_MS);

    const handler = (result: MuteResult & { requestId?: string }) => {
      if (result.requestId && result.requestId !== requestId) {
        this.once('mute-set', handler);
        return;
      }
      clearTimeout(timeout);
      resolve(result);
    };
    this.once('mute-set', handler);

    this.send({ type: 'set_mute', muted, requestId });
  });
}
```

E adicionar o handler de mensagem:
```typescript
case 'mute_set':
  this.emit('mute-set', message as MuteResult);
  break;
```

**1d. Addon nativo — diferenciar evento de media key vs AirPods mute**

Arquivo: `src/native/media_key_tap.cc`

Em vez de sempre chamar `fireMediaKeyCallback(true)`, criar dois callbacks distintos:

```cpp
// Callback existente para media keys (toggle)
static void fireMediaKeyCallback(bool keyDown) { ... }

// Novo callback para AirPods mute (state-aware)
static void fireAirpodsMuteCallback(bool shouldBeMuted) {
    auto* flag = new bool(shouldBeMuted);
    tsfn.NonBlockingCall(flag, [](Napi::Env env, Napi::Function jsCallback, bool* data) {
        jsCallback.Call({
            Napi::String::New(env, "airpods_mute"),
            Napi::Boolean::New(env, *data)  // true = mute, false = unmute
        });
        delete data;
    });
}
```

Atualizar o AVAudioApplication handler:
```objc
[audioApp setInputMuteStateChangeHandler:^BOOL(BOOL inputShouldBeMuted) {
    if (!isDuplicateAirpodsMute(kMuteDedupWindowMs, "AVAudioApplication")) {
        fireAirpodsMuteCallback((bool)inputShouldBeMuted);
    }
    return YES;
} error:&error];
```

**Nota sobre Darwin notification**: A Darwin notification NAO carrega payload (nao sabemos se e mute ou unmute). Opcoes:
- **Opcao A (recomendada)**: Quando AVAudioApplication esta registrado com sucesso (macOS 14+), REMOVER o observer Darwin. Ele so serve como fallback para macOS < 14. Isso elimina a fonte principal de disparos espurios.
- **Opcao B**: Manter o Darwin apenas se AVAudioApplication falhou no registro. Adicionar flag `avAudioHandlerActive` para controlar.

**1e. Electron main — handler para `airpods_mute`**

Arquivo: `src/main/index.ts`

```typescript
mediaKeys.on('media-key', async (event) => {
  if (event.key === 'play_pause') {
    await handleMediaKey(); // toggle como antes
  } else if (event.key === 'airpods_mute') {
    await handleAirpodsMute(event.muted); // state-aware
  }
});

async function handleAirpodsMute(shouldBeMuted: boolean): Promise<void> {
  const now = Date.now();
  if (now - lastMediaKeyHandledMs < MEDIA_KEY_DEBOUNCE_MS) return;
  if (!enabled || !bridge.isConnected) return;

  lastMediaKeyHandledMs = now;

  if (!lastMeetStatus.active) {
    const status = await bridge.queryMeetStatus();
    lastMeetStatus = status;
    updateTrayState();
    if (!status.active) return;
  }

  // Verificar se ja esta no estado desejado
  if (lastMeetStatus.muted === shouldBeMuted) {
    console.log(`${TAG} handleAirpodsMute() — already ${shouldBeMuted ? 'muted' : 'unmuted'}, skipping`);
    return;
  }

  console.log(`${TAG} handleAirpodsMute() — setting mute to ${shouldBeMuted}`);
  const result = await bridge.setMute(shouldBeMuted);

  if (result.success && result.muted !== undefined) {
    lastMeetStatus.muted = result.muted;
    updateTrayState();
    tray.flash();
  }
}
```

#### Camada 2: Condicionar Darwin notification ao estado do AVAudioApplication

Arquivo: `src/native/media_key_tap.cc`

Adicionar flag:
```cpp
static bool avAudioHandlerActive = false;
```

No registro do AVAudioApplication (se retornar ok):
```cpp
if (ok) {
    avAudioHandlerActive = true;
    // ...
}
```

No Darwin notification callback:
```cpp
static void darwinMuteNotificationCallback(...) {
    // Se AVAudioApplication esta ativo, ignorar Darwin (redundante e menos preciso)
    if (avAudioHandlerActive) {
        fprintf(stderr, "[MeetPods:native] Darwin notification: skipping (AVAudioApplication is active)\n");
        return;
    }
    if (isDuplicateAirpodsMute(kMuteDedupWindowMs, "Darwin mute notification")) return;
    fprintf(stderr, "[MeetPods:native] Darwin notification: AirPods mute gesture detected\n");
    fireMediaKeyCallback(true);  // toggle (sem info de estado)
}
```

#### Camada 3: Logging diagnostico (para validar a correcao)

Antes de aplicar a correcao completa, adicionar logging temporal para confirmar a hipotese:

Arquivo: `src/native/media_key_tap.cc`

No Darwin notification callback, logar timestamp detalhado:
```cpp
fprintf(stderr, "[MeetPods:native] Darwin notification fired at %llu (delta from last: %llums)\n",
        currentTimeMs(), currentTimeMs() - lastAirpodsMuteTimeMs.load());
```

No AVAudioApplication handler:
```cpp
fprintf(stderr, "[MeetPods:native] AVAudioApplication fired: inputShouldBeMuted=%d at %llu\n",
        inputShouldBeMuted, currentTimeMs());
```

### Ordem de Implementacao (Bug)

1. **Primeiro**: Adicionar logging diagnostico extra (Camada 3) — rapido, sem mudanca de comportamento
2. **Segundo**: Condicionar Darwin ao AVAudioApplication (Camada 2) — mudanca minima, alta chance de resolver
3. **Terceiro**: Implementar sistema state-aware completo (Camada 1) — mudanca maior, fix definitivo

**A Camada 2 sozinha provavelmente resolve o bug** se o usuario esta no macOS 14+. A Camada 1 e o fix completo e correto arquiteturalmente.

### Arquivos a modificar (Bug)

| Arquivo | Mudanca |
|---------|---------|
| `src/native/media_key_tap.cc` | Flag `avAudioHandlerActive`, condicionar Darwin, novo callback `airpods_mute`, logging |
| `src/main/media-key.ts` | Emitir evento `airpods_mute` separado do `play_pause` |
| `src/main/index.ts` | Handler `handleAirpodsMute()`, usar `bridge.setMute()` |
| `src/main/native-msg.ts` | Metodo `setMute(muted)`, handler `mute-set` |
| `src/extension/background.ts` | Rota `set_mute` no WebSocket, propagacao para content script |
| `src/extension/content.ts` | Funcao `setMute(targetMuted)`, handler `set_mute` |

### Testes a atualizar

| Arquivo de teste | O que atualizar |
|-----------------|-----------------|
| `src/main/__tests__/index.test.ts` | Testes para `handleAirpodsMute`, skip quando ja no estado desejado |
| `src/__tests__/extension/content.test.ts` | Testes para `setMute()`: ja no estado, estado diferente, botao nao encontrado |
| `src/__tests__/extension/background.test.ts` | Testes para rota `set_mute` |
| `src/main/__tests__/native-msg.test.ts` | Testes para `setMute()` e evento `mute-set` |

---

## Problema 2: Audio Feedback para Mute/Unmute

### Requisito

Tocar sons distintos ao mutar e desmutar, para que o usuario saiba o estado sem olhar a tela.

### Abordagem Escolhida: Tons programaticos via AudioToolbox (nativo)

**Por que esta abordagem:**
- AudioToolbox ja esta linkado no addon nativo (binding.gyp)
- Sem dependencia de arquivos de som externos
- Latencia minima (gerado em memoria)
- Dois tons distintos: tom alto curto (unmute/mic ON) e tom baixo duplo (mute/mic OFF)
- Padrao similar ao AirPods Pro: tom ascendente = ativado, tom descendente = desativado

**Alternativa descartada:**
- `shell.beep()` do Electron: som unico, sem diferenciacao mute/unmute
- Arquivos WAV bundled: adiciona complexidade de build e tamanho do app
- `NSSound` com sons do sistema: limitado, sem controle de tom

### Implementacao

#### 2a. Funcao de geracao de tom no addon nativo

Arquivo: `src/native/media_key_tap.cc`

Adicionar funcao para gerar e tocar um tom curto:

```cpp
#include <cmath>

static void playTone(float frequency, float durationMs, float volume = 0.3f) {
    // Gerar tom senoidal em memoria e tocar via AudioQueue
    const float sampleRate = 44100.0f;
    const int numSamples = (int)(sampleRate * durationMs / 1000.0f);

    AudioStreamBasicDescription format = {};
    format.mSampleRate = sampleRate;
    format.mFormatID = kAudioFormatLinearPCM;
    format.mFormatFlags = kLinearPCMFormatFlagIsFloat | kLinearPCMFormatFlagIsPacked;
    format.mBitsPerChannel = 32;
    format.mChannelsPerFrame = 1;
    format.mBytesPerFrame = sizeof(Float32);
    format.mFramesPerPacket = 1;
    format.mBytesPerPacket = sizeof(Float32);

    // Alocar buffer com samples
    Float32 *samples = (Float32 *)calloc(numSamples, sizeof(Float32));
    for (int i = 0; i < numSamples; i++) {
        float t = (float)i / sampleRate;
        float envelope = 1.0f;
        // Fade in/out para evitar clicks (10ms cada)
        int fadeFrames = (int)(sampleRate * 0.01f);
        if (i < fadeFrames) envelope = (float)i / fadeFrames;
        if (i > numSamples - fadeFrames) envelope = (float)(numSamples - i) / fadeFrames;
        samples[i] = volume * envelope * sinf(2.0f * M_PI * frequency * t);
    }

    // Tocar via AudioQueue (dispatch async para nao bloquear)
    // ... (implementacao AudioQueue)

    free(samples);
}
```

**Padrao sonoro:**
- **Unmute (mic ON)**: Tom unico ascendente — 880Hz por 100ms (tom agudo, confiante)
- **Mute (mic OFF)**: Dois tons curtos descendentes — 440Hz por 80ms + pausa 50ms + 330Hz por 80ms (tom grave duplo, "desligando")

#### 2b. Exportar funcao para Node.js

Arquivo: `src/native/media_key_tap.cc`

```cpp
// Expor para JS
Napi::Value PlayFeedbackSound(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Boolean (isMuted) required").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    bool isMuted = info[0].As<Napi::Boolean>().Value();

    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_HIGH, 0), ^{
        if (isMuted) {
            playTone(440.0f, 80.0f, 0.3f);   // Tom grave
            usleep(50000);                      // 50ms pausa
            playTone(330.0f, 80.0f, 0.3f);   // Tom mais grave
        } else {
            playTone(880.0f, 100.0f, 0.3f);  // Tom agudo unico
        }
    });

    return env.Undefined();
}
```

Registrar no `Init`:
```cpp
exports.Set("playFeedbackSound", Napi::Function::New(env, PlayFeedbackSound));
```

**Nota sobre implementacao de audio**: Usar `AudioQueueNewOutput` + `AudioQueueEnqueueBuffer` + `AudioQueueStart` para reproduzir o tom, OU usar `NSSound` com dados em memoria. A abordagem mais simples e robusta e usar `AVAudioPlayer` com dados PCM em memoria via `NSData`.

**Alternativa simplificada**: Se AudioQueue for muito complexo, usar `NSSound` com um beep do sistema e variar o comportamento:
- Mute: `[[NSSound soundNamed:@"Tink"] play]` (tom sutil)
- Unmute: `[[NSSound soundNamed:@"Pop"] play]` (tom positivo)

Estes sons do sistema (`Tink`, `Pop`, `Purr`, `Funk`, `Glass`) ja estao presentes em todo macOS. **Esta alternativa e significativamente mais simples e recomendada como primeira implementacao.**

#### 2c. Wrapper TypeScript

Arquivo: `src/main/media-key.ts`

```typescript
playFeedbackSound(isMuted: boolean): void {
  try {
    this.addon.playFeedbackSound(isMuted);
  } catch (err) {
    console.error(`${TAG} playFeedbackSound() failed:`, err);
  }
}
```

Atualizar interface `NativeAddon`:
```typescript
interface NativeAddon {
  // ... existentes
  playFeedbackSound(isMuted: boolean): void;
}
```

#### 2d. Chamar no toggle bem-sucedido

Arquivo: `src/main/index.ts`

Na `handleMediaKey()` (e `handleAirpodsMute()` se implementada):

```typescript
if (result.success && result.muted !== undefined) {
  lastMeetStatus.muted = result.muted;
  updateTrayState();
  tray.flash();
  mediaKeys.playFeedbackSound(result.muted);  // <-- NOVO
}
```

### Arquivos a modificar (Audio Feedback)

| Arquivo | Mudanca |
|---------|---------|
| `src/native/media_key_tap.cc` | Funcao `PlayFeedbackSound`, logica de geracao de tom ou uso de `NSSound` |
| `src/main/media-key.ts` | Metodo `playFeedbackSound()`, interface `NativeAddon` |
| `src/main/index.ts` | Chamar `mediaKeys.playFeedbackSound(result.muted)` apos toggle |

### Testes (Audio Feedback)

| Arquivo de teste | O que atualizar |
|-----------------|-----------------|
| `src/main/__tests__/index.test.ts` | Verificar que `playFeedbackSound` e chamado apos toggle bem-sucedido, com o valor correto de `muted` |
| `src/main/__tests__/media-key.test.ts` | Mock do addon, verificar chamada |

---

## Ordem de Execucao Completa

### Fase 1: Diagnostico (confirmar hipotese do bug)

1. Adicionar logging detalhado ao Darwin notification e AVAudioApplication handlers com timestamps
2. Build e testar — verificar nos logs se Darwin notification esta disparando espuriamente

### Fase 2: Fix minimo do bug (Camada 2)

3. Adicionar flag `avAudioHandlerActive`
4. Condicionar Darwin notification callback a `!avAudioHandlerActive`
5. Atualizar testes existentes
6. Build e testar

### Fase 3: Audio feedback (independente do bug)

7. Implementar `PlayFeedbackSound` no addon nativo (comecar com `NSSound` do sistema)
8. Adicionar wrapper em `media-key.ts`
9. Chamar em `index.ts` apos toggle
10. Atualizar testes
11. Build e testar audio

### Fase 4: Fix completo state-aware (Camada 1)

12. Adicionar `fireAirpodsMuteCallback` no addon nativo
13. Diferenciar eventos em `media-key.ts`
14. Adicionar `setMute()` em `content.ts`, `background.ts`, `native-msg.ts`
15. Adicionar `handleAirpodsMute()` em `index.ts`
16. Atualizar todos os testes
17. Build e teste completo
18. Rodar `npm test` e garantir thresholds de coverage

### Fase 5: Validacao

19. `npm run build` sem erros
20. `npm test` com todos testes passando e coverage dentro dos thresholds
21. Teste manual: conectar AirPods, entrar em chamada, verificar que nao muta sozinho
22. Teste manual: pressionar media key, verificar sons distintos

---

## Notas Tecnicas Importantes

- **Coverage thresholds**: 100% lines, 100% functions, 95% branches, 99% statements (escopo: `src/main/**` + `src/extension/**`)
- **O addon nativo nao tem cobertura de teste** — nao precisa
- **TypeScript strict mode** esta ativo
- **Main process usa CommonJS** (`require`/`module.exports`)
- **Chrome extension usa ES2022 modules** (bundled por esbuild)
- **Framework de teste**: vitest + @vitest/coverage-v8
- **Build do addon**: `npm run build:native` (node-gyp)
- **Build da extensao**: `npm run build:ext` (esbuild)
