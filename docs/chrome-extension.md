# Chrome Extension: Guia Tecnico

## Visao Geral

A extensao Chrome e o componente que interage com o Google Meet. Ela detecta chamadas ativas, monitora o estado do microfone e executa o toggle de mute clicando diretamente no botao do DOM.

## Manifest V3

```json
{
  "manifest_version": 3,
  "permissions": ["tabs"],
  "host_permissions": ["https://meet.google.com/*"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["https://meet.google.com/*"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }]
}
```

| Permissao | Motivo |
|-----------|--------|
| `tabs` | Detectar quais abas tem Google Meet aberto |
| `https://meet.google.com/*` | Injetar content script e enviar mensagens |

## Componentes

### background.ts (Service Worker)

**Responsabilidades:**
1. Manter conexao WebSocket com o Electron (porta 18432)
2. Rastrear tabs do Google Meet em um `Map`
3. Rotear mensagens entre Electron e content scripts
4. Reconectar automaticamente se a conexao cair

**Rastreamento de tabs:**

```javascript
let meetTabs = new Map(); // tabId → { url, lastFocused }
```

- `chrome.tabs.onUpdated`: adiciona/remove tabs conforme URL muda
- `chrome.tabs.onRemoved`: limpa tabs fechadas
- `chrome.tabs.onActivated`: atualiza lastFocused para priorizar a tab mais recente
- Startup scan: `chrome.tabs.query` para recuperar tabs ja existentes quando o service worker reinicia

**Selecao da melhor tab:**
Quando multiplas tabs do Meet estao abertas, `getBestMeetTab()` seleciona a mais recentemente focada.

**Protocolo WebSocket:**

| Mensagem recebida | Acao |
|-------------------|------|
| `query_meet_status` | Envia get_status para content script, responde com meet_status |
| `toggle_mute` | Envia toggle_mute para content script, responde com mute_toggled |
| `ping` | Responde com pong |

**Reconexao:**
Se o WebSocket fechar, tenta reconectar a cada 5 segundos via `setInterval`.

### content.ts (Content Script)

**Injetado em:** Todas as paginas de `https://meet.google.com/*`
**Quando:** `document_idle` (apos DOM carregado)

**Deteccao do botao de mute:**

```javascript
const MUTE_BUTTON_SELECTORS = [
  'button[data-is-muted][aria-label*="microphone" i]',
  'button[data-is-muted][aria-label*="microfone" i]',   // portugues
  'button[data-is-muted][aria-label*="mikrofon" i]',     // alemao
  '[data-tooltip*="microphone" i] button[data-is-muted]',
  '[data-tooltip*="microfone" i] button[data-is-muted]',
];
```

Suporte multi-idioma via multiplos seletores. O atributo `data-is-muted` do Google Meet indica o estado atual.

**Deteccao de chamada ativa:**

```javascript
const CALL_INDICATORS = [
  '[data-call-ended]',
  'button[data-is-muted]',
  '[data-meeting-title]',
];
```

Se qualquer um desses elementos existe no DOM, ha uma chamada ativa.

**MutationObserver:**
Monitora mudancas no DOM para detectar transicoes de estado em tempo real:
- `childList: true, subtree: true` — detecta entrada/saida de chamada
- `attributes: true, attributeFilter: ['data-is-muted', 'aria-label']` — detecta toggle de mute

Quando o estado muda, envia `status_changed` ao background via `chrome.runtime.sendMessage`.

**Toggle de mute:**
Simplesmente faz `.click()` no botao de mute encontrado. Aguarda 100ms e verifica o novo estado.

**Poll de seguranca:**
`setInterval(checkCallStatus, 5000)` garante que mudancas de estado nao sejam perdidas pelo MutationObserver.

### popup.html + popup.ts

UI minimalista com tema escuro mostrando 3 indicadores:

| Indicador | Estados |
|-----------|---------|
| Electron App | Connected (verde) / Offline (vermelho) |
| Google Meet | In call (verde) / No call (cinza) |
| Microphone | Mic ON (verde) / Muted (vermelho) |

**Como funciona:**
1. Popup abre → cria WebSocket temporario para o Electron
2. Envia `query_meet_status` via WebSocket
3. Tambem consulta background script via `chrome.runtime.sendMessage`
4. Atualiza UI com os resultados
5. Fecha WebSocket

## Protocolo de Mensagens

### Entre Electron ↔ background.ts (WebSocket)

```
Electron → Extension:
  { type: "query_meet_status" }
  { type: "toggle_mute" }

Extension → Electron:
  { type: "meet_status", active: bool, muted: bool, tabId: number|null }
  { type: "mute_toggled", success: bool, muted: bool, error?: string }
```

### Entre background.ts ↔ content.ts (chrome.runtime)

```
Background → Content:
  { type: "get_status" }        → Response: { active: bool, muted: bool }
  { type: "toggle_mute" }      → Response: { success: bool, muted: bool }

Content → Background:
  { type: "status_changed", active: bool, muted: bool }
```

### Entre popup.ts ↔ background.ts (chrome.runtime)

```
Popup → Background:
  { type: "query_meet_status" } → Response: { active: bool, muted: bool }
```

## Decisoes de Design

### WebSocket ao inves de Chrome Native Messaging

Native Messaging requer que o Chrome lance um binario separado via stdio. Esse binario precisaria de seu proprio IPC para se comunicar com o Electron app ja rodando. Um WebSocket local e mais simples e direto.

### Click no DOM ao inves de atalho de teclado

Enviar `Cmd+D` (atalho de mute do Meet) requer foco na janela do Chrome, o que roubaria o foco do app que o usuario esta usando. Clicar diretamente no botao via content script funciona em background sem afetar o foco.

### Seletores multi-idioma

O Google Meet usa `aria-label` localizado. Para funcionar em portugues, ingles, alemao etc, temos multiplos seletores. O atributo `data-is-muted` e consistente entre idiomas.

## Limitacoes

- Se o Google Meet mudar a estrutura do DOM, os seletores podem quebrar
- Service Workers do Chrome podem ser suspensos — a reconexao WebSocket trata isso
- Nao funciona com outros servicos de video (Zoom, Teams) — design intencional
