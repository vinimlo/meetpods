# Decisoes de Design

Registro das decisoes arquiteturais tomadas durante o desenvolvimento do MeetPods, com contexto sobre alternativas consideradas e motivos da escolha.

## 1. WebSocket ao inves de Chrome Native Messaging

**Escolha:** Servidor WebSocket local na porta 18432 (127.0.0.1)

**Alternativa descartada:** Chrome Native Messaging (stdio)

**Motivo:** Native Messaging exige que o Chrome lance um binario separado via stdin/stdout. Como o MeetPods ja roda como app Electron, seria necessario um IPC adicional entre o binario NativeMessaging e o Electron. WebSocket e mais direto — a extensao conecta diretamente ao processo Electron.

**Trade-off:** WebSocket requer uma porta fixa (18432). Se outra aplicacao usar a mesma porta, havera conflito. Na pratica, isso e raro.

## 2. Click no DOM ao inves de atalho de teclado

**Escolha:** Content script faz `.click()` no botao de mute diretamente no DOM do Google Meet.

**Alternativa descartada:** Enviar `Cmd+D` (atalho de teclado do Meet para toggle mute).

**Motivo:** Enviar `Cmd+D` requer foco na janela do Chrome, o que roubaria o foco do app que o usuario esta usando. Click no DOM funciona em background, sem afetar janela alguma.

**Trade-off:** Dependencia na estrutura do DOM do Google Meet. Se o Google mudar os seletores/atributos, o content script precisa ser atualizado.

## 3. Consumo de evento sincronamente vs. asincronamente

**Problema:** CGEventTap decide sincronamente se consome o evento (retorna nullptr ou event). Mas verificar se ha uma chamada Meet ativa requer async (query via WebSocket).

**Escolha:** Um flag `shouldConsumeEvent` (mutex-protected) que e mantido atualizado de forma assincrona. Quando `enabled && connected && meetActive`, o flag e true e eventos sao consumidos.

**Alternativa descartada:** Sempre consumir e emitir play/pause via programacao quando nao ha chamada.

**Motivo:** A alternativa seria mais complexa e poderia causar problemas com outros apps de media. Melhor deixar o evento passar naturalmente quando nao estamos em chamada.

## 4. CGEventTap + NSEvent fallback (dupla captura)

**Escolha:** Usar CGEventTap como fonte primaria e NSEvent global monitor como fallback, com dedup de 200ms.

**Motivo:** CGEventTap pode perder eventos Bluetooth HID em certas condicoes raras no macOS. NSEvent globalMonitor e mais confiavel para Bluetooth mas nao pode consumir eventos. A combinacao cobre ambos os cenarios.

## 5. AUHAL dinamico (ligado a chamada) vs. AUHAL permanente

**Escolha:** Ligar AUHAL somente quando ha chamada Meet ativa, desligar quando nao ha.

**Alternativa descartada:** Manter AUHAL sempre ativo para simplificar o codigo.

**Motivo:** AUHAL ativo = indicador laranja de microfone permanente no menu bar do macOS. Isso e confuso e preocupante para o usuario. Ao ligar somente durante chamadas, o indicador aparece apenas quando Chrome ja mostra um (por causa do Meet).

**Trade-off:** Codigo mais complexo no lifecycle management. Mas a UX e muito melhor.

## 6. Darwin notification como fallback (nao unica fonte)

**Escolha:** Usar Darwin notification (`com.apple.audioaccessoryd.MuteState`) E AVAudioApplication handler, com dedup bidirecional.

**Alternativa considerada:** Usar somente Darwin notification.

**Motivo:** Darwin notification nao suprime a notificacao "Cannot Control Mic". Somente o AVAudioApplication handler com audio I/O ativo faz isso. Mas Darwin notification funciona sem permissao de microfone, entao serve como fallback graceful quando o usuario nao concede mic access.

## 7. Dedup com timestamps atomicos (nao mutexes)

**Escolha:** `std::atomic<uint64_t>` para timestamps de dedup.

**Alternativa:** Mutexes para proteger a logica de dedup.

**Motivo:** Os acessos sao simples load/store. Atomics sao mais leves (no locks, no contention) e suficientes para o padrao de uso. Mutexes seriam overkill para operacoes que nao precisam de sections criticas.

## 8. Poll periodico de 10s + MutationObserver

**Escolha:** O Electron faz poll a cada 10s para verificar o estado do Meet, e o content script usa MutationObserver para push de mudancas.

**Motivo:** MutationObserver e a fonte primaria e mais responsiva. O poll de 10s e rede de seguranca contra:
- MutationObserver perder alguma mutacao
- Service worker do Chrome ser suspenso e acordar
- Tab do Meet sendo recarregada

## 9. Seletores multi-idioma para o botao de mute

**Escolha:** Multiplos seletores CSS para diferentes idiomas (ingles, portugues, alemao).

**Alternativa:** Usar apenas `data-is-muted` sem filtro de `aria-label`.

**Motivo:** `button[data-is-muted]` sozinho pode pegar outros botoes (camera mute, por exemplo). Filtrar por aria-label garante que encontramos o botao CORRETO de microfone. Multiplos idiomas garantem cobertura para usuarios brasileiros e de outros paises.

## 10. Tray app (sem janela principal)

**Escolha:** App vive somente no menu bar. Dock icon escondido via `app.dock?.hide()`.

**Motivo:** MeetPods e um utilitario de background. Nao precisa de janela. O menu bar e suficiente para mostrar status (3 icones) e dar controle (menu de contexto com toggle e quit).

## 11. Porta fixa 18432

**Escolha:** WebSocket server na porta 18432, hardcoded.

**Alternativa:** Porta dinamica com discovery.

**Motivo:** A extensao Chrome precisa saber a porta antecipadamente. Com porta dinamica, seria necessario um mecanismo de discovery (arquivo em disco, outro protocolo). Porta fixa e simples e funciona. 18432 foi escolhida por ser alta o suficiente para nao conflitar com servicos comuns.

## 12. node-addon-api (N-API) ao inves de NAN

**Escolha:** `node-addon-api` (C++ wrapper sobre N-API).

**Motivo:** N-API e ABI-stable — o addon compilado funciona com diferentes versoes do Node.js sem recompilar. NAN requer recompilacao por versao. Como o Electron embute sua propria versao do Node, ABI stability simplifica distribuicao.
