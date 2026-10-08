import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const TAG = '[MeetPods:settings]';

export type StemPressSource = 'system-log' | 'audio-api';

export interface Settings {
  feedbackVolume: number;
  showMuteHud: boolean;
  stemPressSource: StemPressSource;
}

// macOS 27 stopped handing the AirPods stem press to third-party apps (AGENTS.md §16).
// Before it, the Audio API path works and also keeps the system's "rejected" chime quiet.
function defaultStemPressSource(): StemPressSource {
  const major = Number(process.getSystemVersion().split('.')[0]);
  return major >= 27 ? 'system-log' : 'audio-api';
}

function defaults(): Settings {
  return { feedbackVolume: 0.4, showMuteHud: true, stemPressSource: defaultStemPressSource() };
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

// Only what the user chose. Defaults stay out of the file, so a default that depends on
// the macOS version follows an upgrade instead of being pinned on the first save.
function readSaved(): Partial<Settings> {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
  } catch {
    console.log(`${TAG} No settings file, using defaults`);
    return {};
  }
}

export function loadSettings(): Settings {
  return { ...defaults(), ...readSaved() };
}

export function saveSettings(settings: Partial<Settings>): void {
  const merged = { ...readSaved(), ...settings };
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2));
    console.log(`${TAG} Saved settings`);
  } catch (err) {
    console.error(`${TAG} Failed to save settings:`, err);
  }
}
