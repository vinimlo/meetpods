import { BrowserWindow, screen } from 'electron';

const TAG = '[MeetPods:mute-hud]';

let hudWindow: BrowserWindow | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

const WINDOW_SIZE = 200;
const DISMISS_DELAY_MS = 1500;
const FADE_OUT_MS = 300;

const MIC_ON_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z" fill="#4CAF50"/><path d="M17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12H5C5 15.53 7.61 18.43 11 18.93V22H13V18.93C16.39 18.43 19 15.53 19 12H17Z" fill="#4CAF50"/></svg>';
const MIC_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z" fill="#F44336"/><path d="M17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12H5C5 15.53 7.61 18.43 11 18.93V22H13V18.93C16.39 18.43 19 15.53 19 12H17Z" fill="#F44336"/><line x1="3" y1="3" x2="21" y2="21" stroke="#F44336" stroke-width="2" stroke-linecap="round"/></svg>';

function buildHtml(muted: boolean): string {
  const icon = muted ? MIC_OFF_SVG : MIC_ON_SVG;
  const label = muted ? 'Muted' : 'Unmuted';
  return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: transparent;
    display: flex; align-items: center; justify-content: center;
    height: 100vh; width: 100vw;
    -webkit-app-region: no-drag;
  }
  .hud {
    width: 160px; height: 160px;
    border-radius: 18px;
    background: rgba(30, 30, 30, 0.85);
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 10px;
    opacity: 1;
    transition: opacity 0.2s ease-in;
  }
  .hud.fade-out { opacity: 0; transition: opacity ${FADE_OUT_MS}ms ease-out; }
  .icon svg { width: 56px; height: 56px; }
  .label {
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 16px; font-weight: 500;
    color: #fff;
    user-select: none;
  }
</style></head><body>
  <div class="hud" id="hud">
    <div class="icon" id="icon">${icon}</div>
    <div class="label" id="label">${label}</div>
  </div>
  <script>
    const micOnSvg = '${MIC_ON_SVG}';
    const micOffSvg = '${MIC_OFF_SVG}';

    function update(muted) {
      document.getElementById('hud').className = 'hud';
      document.getElementById('icon').innerHTML = muted ? micOffSvg : micOnSvg;
      document.getElementById('label').textContent = muted ? 'Muted' : 'Unmuted';
    }

    function fadeOut() {
      document.getElementById('hud').className = 'hud fade-out';
    }
  </script>
</body></html>`;
}

function clearDismissTimer(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

function positionOnCursorDisplay(win: BrowserWindow): void {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width, height } = display.workArea;
  const winX = Math.round(x + width / 2 - WINDOW_SIZE / 2);
  const winY = Math.round(y + height / 2 - WINDOW_SIZE / 2);
  win.setPosition(winX, winY);
}

function scheduleDismiss(): void {
  clearDismissTimer();
  dismissTimer = setTimeout(() => {
    if (hudWindow && !hudWindow.isDestroyed()) {
      hudWindow.webContents.executeJavaScript('fadeOut()').catch(() => {});
      dismissTimer = setTimeout(() => {
        if (hudWindow && !hudWindow.isDestroyed()) {
          hudWindow.hide();
        }
        dismissTimer = null;
      }, FADE_OUT_MS);
    }
  }, DISMISS_DELAY_MS);
}

export function showMuteHud(muted: boolean): void {
  if (hudWindow && !hudWindow.isDestroyed()) {
    // Reuse existing window — update content and reposition
    positionOnCursorDisplay(hudWindow);
    hudWindow.webContents
      .executeJavaScript(`update(${muted})`)
      .catch((err) => console.error(`${TAG} executeJavaScript error:`, err));
    if (!hudWindow.isVisible()) {
      hudWindow.showInactive();
    }
    scheduleDismiss();
    return;
  }

  hudWindow = new BrowserWindow({
    width: WINDOW_SIZE,
    height: WINDOW_SIZE,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    transparent: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Screen-saver level ensures visibility over all apps including full-screen
  hudWindow.setAlwaysOnTop(true, 'screen-saver');
  hudWindow.setIgnoreMouseEvents(true);

  const html = buildHtml(muted);
  hudWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  hudWindow.once('ready-to-show', () => {
    if (hudWindow && !hudWindow.isDestroyed()) {
      positionOnCursorDisplay(hudWindow);
      hudWindow.showInactive();
      scheduleDismiss();
      console.log(`${TAG} HUD shown (muted=${muted})`);
    }
  });

  hudWindow.on('closed', () => {
    hudWindow = null;
    clearDismissTimer();
  });

  console.log(`${TAG} HUD created`);
}

export function destroyMuteHud(): void {
  clearDismissTimer();
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.destroy();
    hudWindow = null;
    console.log(`${TAG} HUD destroyed`);
  }
}
