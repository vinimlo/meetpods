import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';

export type TrayState = 'idle' | 'in-call' | 'muted';

export class MeetPodsTray {
  private tray: Tray;
  private state: TrayState = 'idle';
  private enabled = true;
  private feedbackVolumePct = 40;
  private showMuteHud = true;
  private onToggleEnabled: (enabled: boolean) => void;
  private onVolumeClick: (() => void) | null = null;
  private onTestSound: (() => void) | null = null;
  private onShowMuteHudChanged: ((show: boolean) => void) | null = null;

  constructor(onToggleEnabled: (enabled: boolean) => void) {
    this.onToggleEnabled = onToggleEnabled;
    const icon = this.getIcon('idle');
    this.tray = new Tray(icon);
    this.tray.setToolTip('MeetPods');
    this.updateMenu();
  }

  private getIcon(state: TrayState): Electron.NativeImage {
    const iconName = state === 'idle' ? 'tray-icon' : state === 'in-call' ? 'tray-icon-active' : 'tray-icon-muted';

    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, `assets/${iconName}.png`)
      : path.join(__dirname, `../../assets/${iconName}.png`);

    try {
      const img = nativeImage.createFromPath(iconPath);
      img.setTemplateImage(true);
      return img;
    } catch {
      return nativeImage.createEmpty();
    }
  }

  private getStatusText(): string {
    if (!this.enabled) return 'Disabled';
    switch (this.state) {
      case 'idle':
        return 'No active call';
      case 'in-call':
        return 'In call — mic ON';
      case 'muted':
        return 'In call — MUTED';
    }
  }

  private updateMenu(): void {
    const menu = Menu.buildFromTemplate([
      {
        label: this.getStatusText(),
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Active',
        type: 'checkbox',
        checked: this.enabled,
        click: () => {
          this.enabled = !this.enabled;
          this.onToggleEnabled(this.enabled);
          this.updateMenu();
        },
      },
      {
        label: 'Open at Login',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (menuItem) => {
          app.setLoginItemSettings({ openAtLogin: menuItem.checked });
        },
      },
      {
        label: `Feedback Volume (${this.feedbackVolumePct}%)`,
        click: () => this.onVolumeClick?.(),
      },
      {
        label: 'Test Sound',
        click: () => this.onTestSound?.(),
      },
      {
        label: 'Show Mute HUD',
        type: 'checkbox',
        checked: this.showMuteHud,
        click: () => {
          this.showMuteHud = !this.showMuteHud;
          this.onShowMuteHudChanged?.(this.showMuteHud);
          this.updateMenu();
        },
      },
      { type: 'separator' },
      {
        label: `About MeetPods v${app.getVersion()}`,
        enabled: false,
      },
      {
        label: 'Quit',
        click: () => app.quit(),
      },
    ]);
    this.tray.setContextMenu(menu);
  }

  setState(state: TrayState): void {
    this.state = state;
    this.tray.setImage(this.getIcon(state));
    this.updateMenu();
  }

  flash(): void {
    const original = this.state;
    this.tray.setImage(this.getIcon('idle'));
    setTimeout(() => {
      this.tray.setImage(this.getIcon(original));
    }, 200);
  }

  getBounds(): Electron.Rectangle {
    return this.tray.getBounds();
  }

  setOnVolumeClick(handler: () => void): void {
    this.onVolumeClick = handler;
  }

  setOnTestSound(handler: () => void): void {
    this.onTestSound = handler;
  }

  setVolume(volumePct: number): void {
    this.feedbackVolumePct = Math.round(volumePct);
    this.updateMenu();
  }

  setShowMuteHud(show: boolean): void {
    this.showMuteHud = show;
    this.updateMenu();
  }

  setOnShowMuteHudChanged(handler: (show: boolean) => void): void {
    this.onShowMuteHudChanged = handler;
  }

  destroy(): void {
    this.tray.destroy();
  }
}
