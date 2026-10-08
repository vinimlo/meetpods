import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }));

import { app } from 'electron';
import { loadSettings, saveSettings } from '../settings';

describe('settings', () => {
  let dir: string;
  const file = () => path.join(dir, 'settings.json');
  const onMacOS = (version: string) => {
    process.getSystemVersion = () => version;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetpods-settings-'));
    vi.mocked(app.getPath).mockReturnValue(dir);
    onMacOS('27.0.1');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    Reflect.deleteProperty(process, 'getSystemVersion');
    vi.restoreAllMocks();
  });

  it('defaults the stem press source to system-log on macOS 27', () => {
    expect(loadSettings()).toEqual({ feedbackVolume: 0.4, showMuteHud: true, stemPressSource: 'system-log' });
  });

  it('defaults the stem press source to system-log on later macOS versions', () => {
    onMacOS('28.1');
    expect(loadSettings().stemPressSource).toBe('system-log');
  });

  it('defaults the stem press source to audio-api before macOS 27', () => {
    onMacOS('26.4.1');
    expect(loadSettings().stemPressSource).toBe('audio-api');
  });

  it('a saved stem press source wins over the default', () => {
    fs.writeFileSync(file(), JSON.stringify({ stemPressSource: 'audio-api' }));
    expect(loadSettings().stemPressSource).toBe('audio-api');
  });

  it('falls back to defaults when the file is not valid JSON', () => {
    fs.writeFileSync(file(), '{not json');
    expect(loadSettings()).toEqual({ feedbackVolume: 0.4, showMuteHud: true, stemPressSource: 'system-log' });
  });

  it('saves only the chosen values, merged with what was saved before', () => {
    saveSettings({ feedbackVolume: 0.7 });
    saveSettings({ stemPressSource: 'audio-api' });
    expect(JSON.parse(fs.readFileSync(file(), 'utf-8'))).toEqual({ feedbackVolume: 0.7, stemPressSource: 'audio-api' });
  });

  it('keeps the default out of the file, so it follows a macOS upgrade', () => {
    onMacOS('26.4');
    saveSettings({ showMuteHud: false });
    onMacOS('27.0.1');
    expect(loadSettings().stemPressSource).toBe('system-log');
  });

  it('logs and survives a failed write', () => {
    vi.mocked(app.getPath).mockReturnValue(path.join(dir, 'missing'));
    expect(() => saveSettings({ showMuteHud: false })).not.toThrow();
    expect(console.error).toHaveBeenCalledWith('[MeetPods:settings] Failed to save settings:', expect.any(Error));
  });
});
