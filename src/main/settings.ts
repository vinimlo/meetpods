import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const TAG = '[MeetPods:settings]';

interface Settings {
  feedbackVolume: number;
  showMuteHud: boolean;
}

const DEFAULTS: Settings = { feedbackVolume: 0.4, showMuteHud: true };

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): Settings {
  try {
    const data = fs.readFileSync(settingsPath(), 'utf-8');
    const parsed = JSON.parse(data);
    return { ...DEFAULTS, ...parsed };
  } catch {
    console.log(`${TAG} No settings file, using defaults`);
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Partial<Settings>): void {
  const current = loadSettings();
  const merged = { ...current, ...settings };
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2));
    console.log(`${TAG} Saved settings`);
  } catch (err) {
    console.error(`${TAG} Failed to save settings:`, err);
  }
}
