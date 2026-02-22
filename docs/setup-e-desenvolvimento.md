# Setup e Desenvolvimento

## Pre-requisitos

| Requisito | Versao minima | Nota |
|-----------|--------------|------|
| macOS | 12 (Monterey) | CGEventTap requer macOS moderno |
| macOS (para AirPods mute) | 14 (Sonoma) | AVAudioApplication disponivel a partir do macOS 14 |
| Node.js | 22+ | Necessario para N-API e node-gyp |
| Xcode CLT | Qualquer recente | `xcode-select --install` |
| Google Chrome | Qualquer recente | Para a extensao |

## Instalacao

```bash
git clone <repo-url> meetpods
cd meetpods
npm install
```

## Comandos

### Build

```bash
npm run build          # Build completo (TypeScript + native)
npm run build:ts       # Somente TypeScript → dist/
npm run build:native   # Somente addon nativo → src/native/build/Release/
```

### Execucao

```bash
npm start              # Build completo + inicia Electron
npm run dev            # Build TS + inicia Electron (pula rebuild do native)
npm run build && npx electron .   # Build e executa separadamente
```

### Testes

```bash
npm test               # Roda todos os testes (vitest)
npm run test:watch     # Modo watch
```

### Distribuicao

```bash
npm run dist           # Gera .dmg via electron-builder
```

### Geracao de icones

```bash
node scripts/generate-icons.js           # Icones do tray (SVG → PNG @1x/@2x)
node scripts/generate-extension-icons.js  # Icones da extensao Chrome
```

### Makefile

```bash
make build             # Alias para npm run build
make start             # Build + run
make dev               # Build TS + run
make test              # Testes
make clean             # Remove dist/ e src/native/build/
```

## Instalacao da Extensao Chrome

1. Abra `chrome://extensions/`
2. Ative **Modo do Desenvolvedor** (toggle no canto superior direito)
3. Clique em **Carregar sem compactacao**
4. Selecione a pasta `dist/extension/`

A extensao aparecera na barra de ferramentas do Chrome. Clique no icone para ver o status em tempo real.

**Importante:** A extensao se reconecta automaticamente ao Electron. Se voce reiniciar o app Electron, a extensao reconecta em ate 5 segundos.

## Permissoes do macOS

### Acessibilidade (obrigatoria)

Na primeira execucao, macOS pergunta sobre permissao de Acessibilidade. Necessaria para o CGEventTap interceptar teclas de midia.

Se negar, o app nao consegue capturar teclas de midia. Para conceder depois:
**System Settings → Privacy & Security → Accessibility → MeetPods ✓**

### Microfone (necessaria para suprimir notificacao AirPods)

Na primeira execucao, macOS tambem pergunta sobre permissao de Microfone. Necessaria para:
- `AVAudioApplication.setInputMuteStateChangeHandler` funcionar
- AUHAL abrir audio input

Se negar, o app ainda funciona via Darwin notification fallback, mas a notificacao "Cannot Control Mic with AirPods Pro" aparecera.

Para conceder depois:
**System Settings → Privacy & Security → Microphone → MeetPods ✓**

## Estrutura de Pastas

```
meetpods/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # Orquestrador principal
│   │   ├── media-key.ts         # Wrapper do addon nativo
│   │   ├── native-msg.ts        # WebSocket server (bridge)
│   │   ├── tray.ts              # Menu bar icon e context menu
│   │   └── __tests__/           # Testes unitarios (vitest)
│   │       ├── integration.test.ts
│   │       └── media-key.test.ts
│   ├── native/                  # Addon nativo C++/ObjC++
│   │   ├── media_key_tap.cc     # Implementacao principal
│   │   └── binding.gyp          # Configuracao node-gyp
│   └── extension/               # Chrome Extension (Manifest V3)
│       ├── manifest.json        # Permissoes e configuracao
│       ├── background.ts        # Service Worker (WebSocket ↔ tabs)
│       ├── content.ts           # Injetado no Google Meet (DOM)
│       ├── popup.html           # UI do popup
│       ├── popup.ts             # Logica do popup
│       └── icons/               # Icones da extensao
├── assets/                      # Icones do tray (SVG + PNG @1x/@2x)
├── scripts/                     # Scripts de geracao de icones
├── dist/                        # Output TypeScript compilado
├── docs/                        # Documentacao
├── CLAUDE.md                    # Project memory (para IA)
├── package.json
├── tsconfig.json
├── electron-builder.yml         # Configuracao do electron-builder
├── Makefile
├── Dockerfile                   # Para testes em container
└── docker-compose.yml
```

## Configuracao do TypeScript

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/native", "src/extension", "node_modules", "dist"]
}
```

- `src/native` e `src/extension` sao excluidos porque nao sao TypeScript
- Output vai para `dist/main/` mantendo a estrutura de pastas

## Configuracao do Electron Builder

```yaml
appId: com.meetpods.app
productName: MeetPods
mac:
  category: public.app-category.productivity
  target: dmg
  extendInfo:
    NSAccessibilityUsageDescription: "..."
    NSMicrophoneUsageDescription: "..."
extraResources:
  - from: src/native/build/Release/media_key_tap.node
    to: native/media_key_tap.node
  - from: dist/extension/
    to: extension/
```

Pontos importantes:
- `extendInfo` adiciona as chaves de permissao ao Info.plist do app empacotado
- `extraResources` copia o addon nativo e a extensao Chrome para o pacote final
- O addon nativo e carregado de `process.resourcesPath` em producao e do caminho de build em desenvolvimento

## Docker

O Dockerfile e usado para rodar testes em ambiente consistente. **Nao funciona para build do addon nativo** (requer macOS frameworks).

```bash
docker compose run --rm meetpods npm install
docker compose run --rm meetpods npm test
```

## Troubleshooting

### "Failed to create event tap"
- Permissao de Acessibilidade nao concedida
- Solucao: System Settings → Privacy & Security → Accessibility

### Addon nativo nao encontrado
- Precisa fazer `npm run build:native` antes de rodar
- Em producao, o addon e copiado para `resources/native/`

### Extensao nao conecta ao Electron
- Verifique se o Electron esta rodando (icone no menu bar)
- A extensao tenta reconectar a cada 5s automaticamente
- Logs do service worker em chrome://extensions → MeetPods → service worker

### "Cannot Control Mic with AirPods Pro" ainda aparece
- Verifique permissao de microfone concedida ao MeetPods
- Verifique nos logs se "AUHAL: audio input started" aparece ao entrar na chamada
- Verifique nos logs se "AVAudioApplication mic mute handler registered" aparece ao iniciar

### Media keys nao funcionam com Bluetooth
- CGEventTap DEVE estar no main run loop (ja esta configurado assim)
- NSEvent fallback serve como rede de seguranca
- Verifique nos logs se os eventos estao chegando
