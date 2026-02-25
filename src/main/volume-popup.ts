import { BrowserWindow, ipcMain } from 'electron';

const TAG = '[MeetPods:volume-popup]';

let popup: BrowserWindow | null = null;
let changeHandler: ((volume: number) => void) | null = null;

export function showVolumePopup(
  trayBounds: Electron.Rectangle,
  currentVolume: number,
  onVolumeChanged: (volume: number) => void,
): void {
  if (popup && !popup.isDestroyed()) {
    popup.focus();
    return;
  }

  changeHandler = onVolumeChanged;

  const width = 220;
  const height = 80;
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  const y = trayBounds.y + trayBounds.height + 4;

  popup = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#2d2d2d',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const pct = Math.round(currentVolume * 100);
  const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    background: #2d2d2d; color: #e0e0e0;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 100vh; padding: 12px;
    -webkit-app-region: no-drag;
  }
  label { font-size: 12px; margin-bottom: 8px; user-select: none; }
  input[type=range] {
    -webkit-appearance: none; width: 180px; height: 4px;
    background: #555; border-radius: 2px; outline: none;
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none; width: 16px; height: 16px;
    background: #fff; border-radius: 50%; cursor: pointer;
  }
  .pct { font-size: 11px; color: #aaa; margin-top: 6px; }
</style></head><body>
  <label>Feedback Volume</label>
  <input type="range" id="vol" min="0" max="100" step="5" value="${pct}">
  <div class="pct" id="lbl">${pct}%</div>
  <script>
    const {ipcRenderer} = require('electron');
    const slider = document.getElementById('vol');
    const lbl = document.getElementById('lbl');
    slider.addEventListener('input', () => {
      lbl.textContent = slider.value + '%';
      ipcRenderer.send('volume-change', parseInt(slider.value));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') ipcRenderer.send('volume-close');
    });
  </script>
</body></html>`;

  popup.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  popup.once('ready-to-show', () => popup?.show());
  popup.on('blur', () => {
    popup?.close();
  });
  popup.on('closed', () => {
    popup = null;
    changeHandler = null;
  });

  console.log(`${TAG} Popup opened (volume=${pct}%)`);
}

ipcMain.on('volume-change', (_event, pct: number) => {
  const volume = Math.max(0, Math.min(100, pct)) / 100;
  changeHandler?.(volume);
});

ipcMain.on('volume-close', () => {
  if (popup && !popup.isDestroyed()) popup.close();
});
