# AirPods no macOS: Deep Dive Tecnico

Este documento registra todo o aprendizado sobre como eventos de AirPods funcionam no macOS, incluindo armadilhas, APIs privadas e a unica maneira de suprimir a notificacao "Cannot Control Mic".

## Dois Sistemas de Eventos Completamente Diferentes

Este e o aprendizado #1 do projeto — a maior armadilha ao trabalhar com AirPods no macOS.

### Toque simples (play/pause)

```
AirPods stem → Bluetooth AVRCP → macOS HID subsystem → NX_SYSDEFINED
```

- Gera um evento `NX_SYSDEFINED` com subtype 8 e keyCode 16 (`NX_KEYTYPE_PLAY`)
- E o mesmo evento que qualquer teclado/fone envia ao pressionar play/pause
- Capturado por `CGEventTap` e `NSEvent addGlobalMonitorForEventsMatchingMask:`
- Funciona com qualquer Bluetooth headset, nao apenas AirPods

### Press-and-hold (gesto de mute)

```
AirPods stem (segurar) → Bluetooth proprietary → audioaccessoryd daemon
```

- Caminho completamente separado — **NUNCA** gera NX_SYSDEFINED
- Nao passa pelo HID subsystem padrao
- Nao e capturado por CGEventTap, NSEvent, ou qualquer listener de tecla de midia
- E um comando proprietario da Apple processado pelo daemon `audioaccessoryd`
- Somente pode ser detectado via:
  1. Darwin Notification (`com.apple.audioaccessoryd.MuteState`)
  2. `AVAudioApplication.setInputMuteStateChangeHandler` (macOS 14+)

## Darwin Notification: `com.apple.audioaccessoryd.MuteState`

### O que e

Notificacao system-wide emitida pelo `audioaccessoryd` quando o gesto de mute dos AirPods ocorre. Usa o `CFNotificationCenterGetDarwinNotifyCenter()`, que e um IPC leve baseado em Mach ports.

### Como usar

```objc
CFNotificationCenterAddObserver(
    CFNotificationCenterGetDarwinNotifyCenter(),
    kObserver,                    // seu ponteiro de contexto
    myCallback,                   // funcao C de callback
    CFSTR("com.apple.audioaccessoryd.MuteState"),
    nullptr,
    CFNotificationSuspensionBehaviorDeliverImmediately
);
```

### Caracteristicas

| Propriedade | Valor |
|------------|-------|
| Permissao de microfone | NAO necessaria |
| Audio session ativa | NAO necessaria |
| Confiabilidade | Alta — dispara sempre que o gesto ocorre |
| Tipo de API | Privada (Apple pode mudar a qualquer momento) |
| Payload/dados | Nenhum — so notifica que aconteceu, sem detalhes |
| Suprime notificacao | NAO |

### Limitacoes

- Nao informa o estado desejado (mute/unmute) — apenas que o gesto ocorreu
- Nao carrega nenhum dado no `userInfo`
- Sendo API privada, pode quebrar em atualizacoes do macOS
- **Nao suprime** a notificacao "Cannot Control Mic with AirPods Pro"

### Projetos que usam

- [PodsMute](https://github.com/cyanicr/podsmute) — Darwin notification + CoreAudio property listener

## AVAudioApplication.setInputMuteStateChangeHandler

### O que e

API oficial da Apple introduzida no macOS 14 (Sonoma) / iOS 17. E a unica maneira suportada de:
1. Detectar o gesto de mute dos AirPods
2. **Suprimir** a notificacao "Cannot Control Mic"

### Como funciona

```objc
if (@available(macOS 14.0, *)) {
    AVAudioApplication *audioApp = AVAudioApplication.sharedInstance;
    NSError *error = nil;
    BOOL ok = [audioApp setInputMuteStateChangeHandler:^BOOL(BOOL inputShouldBeMuted) {
        // inputShouldBeMuted: true = usuario quer mutar, false = quer desmutar
        // Retornar YES = "eu trato" → notificacao SUPRIMIDA
        // Retornar NO = "eu nao trato" → notificacao APARECE
        return YES;
    } error:&error];
}
```

### O Requisito Critico: Audio I/O Ativo

**Registrar o handler NAO E SUFICIENTE.** O handler so e invocado quando o app tem audio I/O ativo.

Do header `AVAudioApplication.h` da Apple:
> "this notification will only be dispatched for state changes when there is an active record session"

Na pratica, isso significa que o app precisa estar **ativamente puxando dados do microfone**. Sem isso:
- O handler registra com sucesso (sem erro)
- Mas **nunca e chamado**
- A notificacao "Cannot Control Mic" aparece normalmente

### Permissoes

- Requer `NSMicrophoneUsageDescription` no Info.plist
- Requer consentimento do usuario (dialog do sistema)
- Sem permissao de mic, o handler falha silenciosamente

## AUHAL: A Solucao para Audio I/O Ativo

### O que e AUHAL

AUHAL = Audio Unit Hardware Abstraction Layer. E a forma mais leve de abrir uma sessao de gravacao no Core Audio do macOS. Usamos `kAudioUnitSubType_HALOutput` (nome confuso — ele lida com input E output).

### Configuracao

```
AudioComponentDescription:
  componentType:         kAudioUnitType_Output
  componentSubType:      kAudioUnitSubType_HALOutput
  componentManufacturer: kAudioUnitManufacturer_Apple

Configuracao:
  Bus 1 (input):  HABILITADO  — puxa dados do microfone
  Bus 0 (output): DESABILITADO — nao reproduz nada

Callback:
  kAudioOutputUnitProperty_SetInputCallback
  → chama AudioUnitRender() e descarta os dados
```

### Por que dinamico (ligado a chamada)

Se o AUHAL ficasse ativo o tempo todo, o indicador laranja de microfone apareceria permanentemente no menu bar do macOS. Ao ligar somente durante chamadas:
- O indicador aparece quando Chrome ja mostra um (por causa do Meet)
- Desaparece quando a chamada termina
- Experiencia transparente para o usuario

### Ciclo de vida

```
Usuario entra na chamada Meet
  → index.ts detecta status active=true
  → syncAudioInput() chama mediaKeys.startAudioInput()
  → native addon: setupAUHAL()
  → AUHAL inicia e puxa audio do mic

Usuario sai da chamada
  → index.ts detecta status active=false
  → syncAudioInput() chama mediaKeys.stopAudioInput()
  → native addon: teardownAUHAL()
  → AUHAL para, indicador de mic desaparece
```

### Tratamento de erros no setupAUHAL

A funcao `setupAUHAL()` e idempotente (retorna early se ja ativo) e faz cleanup em cada ponto de falha:

1. Verifica dispositivo de entrada padrao
2. Cria instancia do AudioComponent
3. Habilita input (bus 1)
4. Desabilita output (bus 0)
5. Define dispositivo de entrada
6. Le formato do stream (canais)
7. Aloca buffers
8. Registra render callback
9. AudioUnitInitialize
10. AudioOutputUnitStart

Se qualquer passo falha, todos os recursos alocados ate aquele ponto sao liberados.

### Projetos de referencia

- [AirMute](https://github.com/CominAtYou/AirMute) — AUHAL + AVAudioApplication para controlar mute do Discord via AirPods. Mesmo padrao que usamos.

## Notificacao "Cannot Control Mic with AirPods Pro"

### Quem gera

O daemon `audioaccessoryd` gera a notificacao. Ela aparece quando:
1. AirPods Pro/Max detectam gesto de mute
2. Nenhum app com audio I/O ativo registrou o handler do AVAudioApplication retornando YES

### Como suprimir

A unica maneira:
1. Registrar `AVAudioApplication.setInputMuteStateChangeHandler`
2. Ter audio I/O ativo (AUHAL resolvido acima)
3. Handler retorna `YES`

### O que NAO funciona

- Nao ha como filtrar ou esconder a notificacao via UNUserNotificationCenter
- Nao ha como bloquear o audioaccessoryd
- Darwin notifications nao ajudam — detectam o evento mas nao suprimem
- Registrar o handler sem audio I/O — handler nunca e chamado

## Estrategia de Deduplicacao

Como temos multiplas fontes de eventos para o mesmo gesto, precisamos evitar double-toggle (mutar e imediatamente desmutar).

### Media keys: CGEventTap + NSEvent

```
Fonte primaria:  CGEventTap (mais confiavel)
Fonte fallback:  NSEvent globalMonitor
Dedup window:    200ms
Variavel:        lastTapEventTimeMs (atomic)
Logica:          NSEvent verifica se CGEventTap ja processou nos ultimos 200ms
```

### AirPods mute: AVAudioApplication + Darwin

```
Ambas podem disparar para o mesmo gesto
Dedup window:    500ms (bidirecional)
Variavel:        lastAirpodsMuteTimeMs (atomic)
Logica:          Quem chegar primeiro marca o timestamp
                 O segundo verifica e ignora se < 500ms
```

O window de 500ms e maior que os 200ms do media key porque os dois callbacks (AVAudioApplication e Darwin) podem ter mais variacao temporal entre si.

## WWDC Reference

**WWDC23 Session 10233**: "Enhance your app's audio experience with AirPods"

Esta sessao cobre:
- Como usar `AVAudioApplication.setInputMuteStateChangeHandler`
- O requisito de audio session ativa
- Best practices para integracao de mute com AirPods
