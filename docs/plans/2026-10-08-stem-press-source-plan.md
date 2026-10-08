# Stem Press Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On macOS 27 the AirPods stem press toggles Meet again by following `bluetoothd`'s log line, behind a flag that keeps the official AVAudioApplication path intact and one click away.

**Architecture:** A new `StemLogWatcher` spawns `/usr/bin/log stream` during calls and emits `stem-press`. A `stemPressSource` setting (`'system-log' | 'audio-api'`, default by macOS version) decides which source feeds `index.ts`: in `system-log` mode AUHAL and `setInputMuted` stay off and native `airpods_mute` events are dropped; in `audio-api` mode nothing changes from today. The tray gets a two-option submenu that switches at runtime.

**Tech Stack:** Electron 35 main process (TypeScript 5.9, CommonJS), vitest 4, Node `child_process`.

**Spec:** `docs/plans/2026-10-08-stem-press-source-design.md`

## Global Constraints

- Setting key and values, verbatim: `stemPressSource: 'system-log' | 'audio-api'`.
- Default when absent: `'system-log'` when the macOS major version from `process.getSystemVersion()` is 27 or later, else `'audio-api'`. Written to `settings.json` only when the user picks.
- Log command, verbatim: `/usr/bin/log stream --style ndjson --predicate 'process == "bluetoothd" AND eventMessage CONTAINS "Received Software Mute"'`.
- Restart delays: 1 s, doubling, capped at 30 s; back to 1 s after a press and on every `start()`.
- Tray labels, verbatim: submenu **AirPods Stem Press**, radio items **System Log** and **Audio API**, placed right after **Show Mute HUD**.
- AirPods feedback sound plays 300 ms after the toggle (existing value).
- The native addon (`src/native/`) does not change.
- Code, identifiers and UI text in English. Log lines use the module tag style `[MeetPods:<module>]`.
- Every new or changed line is covered by tests. The global thresholds already fail before this work (86.8% lines on 2026-10-08), so coverage is checked per file.
- Tests run on the host: `npx vitest run` (MeetPods is a host-native exception, no Docker).

## Review Focus

- Two presses within 500 ms: the second is dropped by the existing debounce, as with the keyboard key (pinned in Task 4).
- A press while the extension is disconnected: nothing toggles (pinned in Task 4).
- A press that lands just after the call ended, before the watcher stops: MeetPods re-queries Meet and does not toggle (pinned in Task 4).
- Two presses delivered by `log stream` in one stdout chunk: both count (pinned in Task 2).
- A stream that was stopped and replaced exits or writes late: no extra restart, no ghost press (pinned in Task 2).

---

### Task 1: `stemPressSource` setting with a macOS-version default

**Files:**

- Modify: `src/main/settings.ts` (whole file, 38 lines)
- Create: `src/main/__tests__/settings.test.ts`

**Interfaces:**

- Produces: `export type StemPressSource = 'system-log' | 'audio-api'`; `export interface Settings { feedbackVolume: number; showMuteHud: boolean; stemPressSource: StemPressSource }`; `loadSettings(): Settings`; `saveSettings(settings: Partial<Settings>): void` (signatures unchanged).

- [ ] **Step 1: Write the failing test** — `src/main/__tests__/settings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/__tests__/settings.test.ts`
Expected: FAIL — `stemPressSource` missing from the loaded settings, and `saveSettings` writes the defaults too.

- [ ] **Step 3: Implement** — replace `src/main/settings.ts` with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/__tests__/settings.test.ts && npx tsc --noEmit`
Expected: 8 passed; tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/settings.ts src/main/__tests__/settings.test.ts
git commit -m "feat(settings): stemPressSource, defaulting to system-log on macOS 27+"
```

---

### Task 2: `StemLogWatcher`

**Files:**

- Create: `src/main/stem-log-watcher.ts`
- Create: `src/main/__tests__/stem-log-watcher.test.ts`

**Interfaces:**

- Produces: `export class StemLogWatcher extends EventEmitter` with `start(): void` (idempotent), `stop(): void` (idempotent) and the event `'stem-press'` (no payload). The constructor has no side effects.

- [ ] **Step 1: Write the failing test** — `src/main/__tests__/stem-log-watcher.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'child_process';
import { StemLogWatcher } from '../stem-log-watcher';

type FakeChild = EventEmitter & {
  pid: number;
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

const PRESS = JSON.stringify({
  timestamp: '2026-10-08 08:24:49.746123-0300',
  eventMessage: 'Received Software Mute (control cmd 0x27) as unknown from device 70:8C:F2:6E:CE:8F',
});
const HEADER =
  'Filtering the log data using "process == "bluetoothd" AND composedMessage CONTAINS "Received Software Mute""';

describe('StemLogWatcher', () => {
  let children: FakeChild[];
  let watcher: StemLogWatcher;
  let presses: number;

  const latest = () => children[children.length - 1];
  const write = (child: FakeChild, text: string) => child.stdout.emit('data', text);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    children = [];
    vi.mocked(spawn)
      .mockReset()
      .mockImplementation((() => {
        const child = Object.assign(new EventEmitter(), {
          pid: 4242 + children.length,
          stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
          stderr: new EventEmitter(),
          kill: vi.fn(),
        });
        children.push(child);
        return child;
      }) as unknown as typeof spawn);
    watcher = new StemLogWatcher();
    presses = 0;
    watcher.on('stem-press', () => presses++);
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("follows bluetoothd's stem press line in the system log", () => {
    watcher.start();
    expect(spawn).toHaveBeenCalledWith('/usr/bin/log', [
      'stream',
      '--style',
      'ndjson',
      '--predicate',
      'process == "bluetoothd" AND eventMessage CONTAINS "Received Software Mute"',
    ]);
    expect(latest().stdout.setEncoding).toHaveBeenCalledWith('utf8');
  });

  it('emits stem-press for a press line after the header', () => {
    watcher.start();
    write(latest(), `${HEADER}\n${PRESS}\n`);
    expect(presses).toBe(1);
  });

  it('emits once per line when several presses arrive in one chunk', () => {
    watcher.start();
    write(latest(), `${PRESS}\n${PRESS}\n`);
    expect(presses).toBe(2);
  });

  it('joins a line split across chunks', () => {
    watcher.start();
    write(latest(), PRESS.slice(0, 40));
    expect(presses).toBe(0);
    write(latest(), `${PRESS.slice(40)}\n`);
    expect(presses).toBe(1);
  });

  it.each([
    ['the header', HEADER],
    ['another bluetoothd line', JSON.stringify({ eventMessage: 'Received Hold (control cmd 0x28)' })],
    ['a line without a message', JSON.stringify({ timestamp: '2026-10-08 08:24:49.746123-0300' })],
    ['a non-string message', JSON.stringify({ eventMessage: 7 })],
    ['JSON null', 'null'],
  ])('skips %s', (_name, line) => {
    watcher.start();
    write(latest(), `${line}\n`);
    expect(presses).toBe(0);
  });

  it('starts one log stream when started twice', () => {
    watcher.start();
    watcher.start();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('stop() kills the stream and does not restart it', () => {
    watcher.start();
    const child = latest();
    watcher.stop();
    expect(child.kill).toHaveBeenCalled();
    child.emit('exit', null, 'SIGTERM');
    vi.advanceTimersByTime(60_000);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('stop() before start() does nothing', () => {
    expect(() => watcher.stop()).not.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('restarts an exited stream with growing delays capped at 30 s', () => {
    watcher.start();
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const count = children.length;
      latest().emit('exit', 1, null);
      vi.advanceTimersByTime(delay - 1);
      expect(children.length).toBe(count);
      vi.advanceTimersByTime(1);
      expect(children.length).toBe(count + 1);
    }
  });

  it('a press resets the restart delay', () => {
    watcher.start();
    latest().emit('exit', 1, null);
    vi.advanceTimersByTime(1000);
    latest().emit('exit', 1, null);
    vi.advanceTimersByTime(2000);
    write(latest(), `${PRESS}\n`);
    latest().emit('exit', 1, null);
    vi.advanceTimersByTime(1000);
    expect(children.length).toBe(4);
  });

  it('restarts once when a spawn error is followed by exit', () => {
    watcher.start();
    latest().emit('error', new Error('spawn /usr/bin/log ENOENT'));
    latest().emit('exit', -2, null);
    vi.advanceTimersByTime(1000);
    expect(children.length).toBe(2);
    vi.advanceTimersByTime(60_000);
    expect(children.length).toBe(2);
  });

  it('stop() cancels a pending restart', () => {
    watcher.start();
    latest().emit('exit', 1, null);
    watcher.stop();
    vi.advanceTimersByTime(60_000);
    expect(children.length).toBe(1);
  });

  it('ignores output and exit of a stream it already replaced', () => {
    watcher.start();
    const old = latest();
    watcher.stop();
    watcher.start();
    write(old, `${PRESS}\n`);
    old.emit('exit', null, 'SIGTERM');
    vi.advanceTimersByTime(60_000);
    expect(presses).toBe(0);
    expect(children.length).toBe(2);
  });

  it('a new start begins again at the shortest restart delay', () => {
    watcher.start();
    latest().emit('exit', 1, null);
    vi.advanceTimersByTime(1000);
    latest().emit('exit', 1, null);
    watcher.stop();
    watcher.start();
    latest().emit('exit', 1, null);
    vi.advanceTimersByTime(1000);
    expect(children.length).toBe(4);
  });

  it('logs what the stream writes to stderr', () => {
    watcher.start();
    latest().stderr.emit('data', Buffer.from('log: Cannot run while sandboxed\n'));
    expect(console.error).toHaveBeenCalledWith(
      '[MeetPods:stem-log] log stream stderr: log: Cannot run while sandboxed',
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/__tests__/stem-log-watcher.test.ts`
Expected: FAIL — cannot resolve `../stem-log-watcher`.

- [ ] **Step 3: Implement** — `src/main/stem-log-watcher.ts`:

```ts
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';

const TAG = '[MeetPods:stem-log]';

// On macOS 27 the AirPods stem press no longer reaches third-party apps through
// AVAudioApplication (AGENTS.md §16), but bluetoothd logs every press with this text.
const PRESS_MARKER = 'Received Software Mute';
const LOG_STREAM_ARGS = [
  'stream',
  '--style',
  'ndjson',
  '--predicate',
  `process == "bluetoothd" AND eventMessage CONTAINS "${PRESS_MARKER}"`,
];
const FIRST_RESTART_DELAY_MS = 1000;
const MAX_RESTART_DELAY_MS = 30_000;

/** Follows the system log and emits `stem-press` for every AirPods stem press. */
export class StemLogWatcher extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private running = false;
  private buffer = '';
  private restartDelayMs = FIRST_RESTART_DELAY_MS;
  private restartTimer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.restartDelayMs = FIRST_RESTART_DELAY_MS;
    this.spawnStream();
  }

  stop(): void {
    if (!this.running) return;
    console.log(`${TAG} Stopping`);
    this.running = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    this.child = null;
    child?.kill();
  }

  private spawnStream(): void {
    this.buffer = '';
    const child = spawn('/usr/bin/log', LOG_STREAM_ARGS);
    this.child = child;
    console.log(`${TAG} log stream started (pid ${child.pid})`);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (child === this.child) this.onData(chunk);
    });
    child.stderr.on('data', (data: Buffer) => {
      console.error(`${TAG} log stream stderr: ${data.toString().trim()}`);
    });
    child.on('error', (err) => {
      console.error(`${TAG} log stream failed:`, err);
      this.onStreamGone(child);
    });
    child.on('exit', (code, signal) => {
      console.log(`${TAG} log stream exited (code=${code}, signal=${signal})`);
      this.onStreamGone(child);
    });
  }

  // 'error' and 'exit' can both fire for one process, and a stopped stream still exits
  // later: only the first event of the current stream schedules a restart.
  private onStreamGone(child: ChildProcessWithoutNullStreams): void {
    if (child !== this.child) return;
    this.child = null;
    const delay = this.restartDelayMs;
    this.restartDelayMs = Math.min(delay * 2, MAX_RESTART_DELAY_MS);
    console.log(`${TAG} restarting log stream in ${delay} ms`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnStream();
    }, delay);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.onLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private onLine(line: string): void {
    let event: { eventMessage?: unknown } | null;
    try {
      event = JSON.parse(line);
    } catch {
      return; // the "Filtering the log data using …" header
    }
    const message = event?.eventMessage;
    if (typeof message !== 'string' || !message.includes(PRESS_MARKER)) return;
    console.log(`${TAG} stem press`);
    this.restartDelayMs = FIRST_RESTART_DELAY_MS;
    this.emit('stem-press');
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/__tests__/stem-log-watcher.test.ts && npx tsc --noEmit`
Expected: 19 passed; tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/stem-log-watcher.ts src/main/__tests__/stem-log-watcher.test.ts
git commit -m "feat: StemLogWatcher follows bluetoothd's stem press line in the system log"
```

---

### Task 3: Tray submenu **AirPods Stem Press**

**Files:**

- Modify: `src/main/tray.ts` (fields after line 16, menu after the **Show Mute HUD** item at lines 87–96, setters after `setOnShowMuteHudChanged`)
- Test: `src/main/__tests__/tray.test.ts` (new `describe` at the end of the top-level `describe('MeetPodsTray')`)

**Interfaces:**

- Consumes: `StemPressSource` from Task 1 (`import type`).
- Produces: `setStemPressSource(source: StemPressSource): void`; `setOnStemPressSourceChanged(handler: (source: StemPressSource) => void): void`. The handler fires only when the choice changes.

- [ ] **Step 1: Write the failing test** — append inside `describe('MeetPodsTray', ...)` in `src/main/__tests__/tray.test.ts`:

```ts
describe('AirPods Stem Press submenu', () => {
  const submenu = () => mocks.menuTemplate.find((i: any) => i.label === 'AirPods Stem Press').submenu;
  const item = (label: string) => submenu().find((i: any) => i.label === label);

  it('sits right after Show Mute HUD', () => {
    const labels = mocks.menuTemplate.map((i: any) => i.label);
    expect(labels.indexOf('AirPods Stem Press')).toBe(labels.indexOf('Show Mute HUD') + 1);
  });

  it('checks the source the app is using', () => {
    tray.setStemPressSource('audio-api');
    expect(item('Audio API')).toMatchObject({ type: 'radio', checked: true });
    expect(item('System Log')).toMatchObject({ type: 'radio', checked: false });
  });

  it('reports a new choice and moves the check', () => {
    const handler = vi.fn();
    tray.setOnStemPressSourceChanged(handler);
    tray.setStemPressSource('system-log');
    item('Audio API').click();
    expect(handler).toHaveBeenCalledWith('audio-api');
    expect(item('Audio API').checked).toBe(true);
  });

  it('does not report the source that is already selected', () => {
    const handler = vi.fn();
    tray.setOnStemPressSourceChanged(handler);
    tray.setStemPressSource('system-log');
    item('System Log').click();
    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts a choice before a handler is set', () => {
    tray.setStemPressSource('system-log');
    expect(() => item('Audio API').click()).not.toThrow();
    expect(item('Audio API').checked).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/__tests__/tray.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'submenu')`.

- [ ] **Step 3: Implement** — in `src/main/tray.ts`:

Add after `import { checkForUpdates } from './updater';`:

```ts
import type { StemPressSource } from './settings';
```

Add after `private onShowMuteHudChanged: ((show: boolean) => void) | null = null;`:

```ts
  private stemPressSource: StemPressSource = 'system-log';
  private onStemPressSourceChanged: ((source: StemPressSource) => void) | null = null;
```

In `updateMenu()`, add right after the **Show Mute HUD** item (before the separator):

```ts
      {
        label: 'AirPods Stem Press',
        submenu: [
          {
            label: 'System Log',
            type: 'radio',
            checked: this.stemPressSource === 'system-log',
            click: () => this.selectStemPressSource('system-log'),
          },
          {
            label: 'Audio API',
            type: 'radio',
            checked: this.stemPressSource === 'audio-api',
            click: () => this.selectStemPressSource('audio-api'),
          },
        ],
      },
```

Add after `setOnShowMuteHudChanged(...)`:

```ts
  setStemPressSource(source: StemPressSource): void {
    this.stemPressSource = source;
    this.updateMenu();
  }

  setOnStemPressSourceChanged(handler: (source: StemPressSource) => void): void {
    this.onStemPressSourceChanged = handler;
  }

  private selectStemPressSource(source: StemPressSource): void {
    if (source === this.stemPressSource) return;
    this.stemPressSource = source;
    this.onStemPressSourceChanged?.(source);
    this.updateMenu();
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/__tests__/tray.test.ts && npx tsc --noEmit`
Expected: all tray tests pass (existing ones find items by label); tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/tray.ts src/main/__tests__/tray.test.ts
git commit -m "feat(tray): AirPods Stem Press submenu (System Log / Audio API)"
```

---

### Task 4: Wire the source into `index.ts`

**Files:**

- Modify: `src/main/index.ts`
- Test: `src/main/__tests__/index.test.ts`

**Interfaces:**

- Consumes: `loadSettings`, `saveSettings`, `StemPressSource` (Task 1); `StemLogWatcher` with `start()`, `stop()`, `'stem-press'` (Task 2); `tray.setStemPressSource`, `tray.setOnStemPressSourceChanged` (Task 3).
- Produces: nothing new for other modules.

- [ ] **Step 1: Prepare the test harness** — in `src/main/__tests__/index.test.ts`:

1. Add to the object returned by the first `vi.hoisted(...)`: in `mockTrayInstance`, the two methods

```ts
      setStemPressSource: vi.fn(),
      setOnStemPressSourceChanged: vi.fn(),
```

and destructure two new mocks next to it by adding, right after that first `vi.hoisted` block:

```ts
const { mockStemWatcherInstance, mockLoadSettings, mockSaveSettings } = vi.hoisted(() => ({
  mockStemWatcherInstance: { start: vi.fn(), stop: vi.fn(), on: vi.fn() },
  mockLoadSettings: vi.fn(),
  mockSaveSettings: vi.fn(),
}));

const AUDIO_API_SETTINGS = { feedbackVolume: 0.4, showMuteHud: true, stemPressSource: 'audio-api' };
```

2. Replace the settings mock with:

```ts
vi.mock('../settings', () => ({
  loadSettings: mockLoadSettings,
  saveSettings: mockSaveSettings,
}));

// ── Mock: stem-log-watcher ───────────────────────────────────────────
vi.mock('../stem-log-watcher', () => ({
  StemLogWatcher: function StemLogWatcher() {
    return mockStemWatcherInstance;
  },
}));
```

3. In `describe('MeetPods main orchestration')`, declare `let stemWatcherOnHandlers: Record<string, Function>;` next to the other handler maps. In the outer `beforeEach`, before `vi.resetModules()`:

```ts
stemWatcherOnHandlers = {};
mockLoadSettings.mockReturnValue(AUDIO_API_SETTINGS);
mockStemWatcherInstance.on.mockImplementation((event: string, handler: Function) => {
  stemWatcherOnHandlers[event] = handler;
});
```

4. In `describe('before-quit')`, add to the existing test: `expect(mockStemWatcherInstance.stop).toHaveBeenCalled();`

Run: `npx vitest run src/main/__tests__/index.test.ts`
Expected: FAIL only on the before-quit expectation (the rest of the suite runs on `audio-api`, like today).

- [ ] **Step 2: Write the failing tests** — add inside `describe('after app.whenReady()')` (the `audio-api` path), after `describe('syncInputMuteState()')`:

```ts
describe('stem press source (Audio API)', () => {
  it('tells the tray the source in use', () => {
    expect(mockTrayInstance.setStemPressSource).toHaveBeenCalledWith('audio-api');
  });

  it('never follows the system log', () => {
    bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
    expect(mockStemWatcherInstance.start).not.toHaveBeenCalled();
  });

  it('switching to System Log mid-call stops recording and follows the log', async () => {
    bridgeOnHandlers['meet-status']({ active: true, muted: true, tabId: 1 });
    mockMediaKeysInstance.stopAudioInput.mockClear();
    const onSourceChanged = mockTrayInstance.setOnStemPressSourceChanged.mock.calls[0][0];

    await onSourceChanged('system-log');

    expect(mockSaveSettings).toHaveBeenCalledWith({ stemPressSource: 'system-log' });
    expect(mockMediaKeysInstance.stopAudioInput).toHaveBeenCalled();
    expect(mockStemWatcherInstance.start).toHaveBeenCalled();
    expect(mockSystemPreferences.askForMediaAccess).not.toHaveBeenCalled();
  });
});
```

And add a sibling of `describe('after app.whenReady()')`, inside `describe('MeetPods main orchestration')`:

```ts
describe('stem press source: system-log', () => {
  beforeEach(async () => {
    mockLoadSettings.mockReturnValue({ ...AUDIO_API_SETTINGS, stemPressSource: 'system-log' });
    mockSystemPreferences.getMediaAccessStatus.mockReturnValue('not-determined');
    await readyCallback();
  });

  const startCall = (muted = false) => bridgeOnHandlers['meet-status']({ active: true, muted, tabId: 1 });

  it('does not ask for the microphone', () => {
    expect(mockSystemPreferences.askForMediaAccess).not.toHaveBeenCalled();
  });

  it('tells the tray the source in use', () => {
    expect(mockTrayInstance.setStemPressSource).toHaveBeenCalledWith('system-log');
  });

  it('keeps the media keys but never records the mic during a call', () => {
    startCall(true);
    expect(mockMediaKeysInstance.start).toHaveBeenCalled();
    expect(mockMediaKeysInstance.startAudioInput).not.toHaveBeenCalled();
    expect(mockMediaKeysInstance.setInputMuted).not.toHaveBeenCalled();
  });

  it('follows the log while a call is active', () => {
    startCall();
    expect(mockStemWatcherInstance.start).toHaveBeenCalled();

    mockStemWatcherInstance.stop.mockClear();
    bridgeOnHandlers['meet-status']({ active: false, muted: false, tabId: null });
    expect(mockStemWatcherInstance.stop).toHaveBeenCalled();
  });

  it('stops following the log when MeetPods is disabled', () => {
    startCall();
    mockStemWatcherInstance.stop.mockClear();
    getTrayToggle()(false);
    expect(mockStemWatcherInstance.stop).toHaveBeenCalled();
  });

  it('does not follow the log when disabled', () => {
    getTrayToggle()(false);
    mockStemWatcherInstance.start.mockClear();
    startCall();
    expect(mockStemWatcherInstance.start).not.toHaveBeenCalled();
  });

  it('a stem press toggles Meet, with the AirPods feedback delay', async () => {
    startCall();
    mockBridgeInstance.toggleMute.mockResolvedValue({ success: true, muted: true });

    await stemWatcherOnHandlers['stem-press']();

    expect(mockBridgeInstance.toggleMute).toHaveBeenCalledTimes(1);
    expect(mockShowMuteHud).toHaveBeenCalledWith(true);
    expect(mockMediaKeysInstance.playFeedbackSound).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(mockMediaKeysInstance.playFeedbackSound).toHaveBeenCalledWith(true);
  });

  it('ignores airpods_mute from the native addon', async () => {
    startCall();
    await mediaKeyOnHandlers['media-key']({ key: 'airpods_mute', shouldBeMuted: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockBridgeInstance.toggleMute).not.toHaveBeenCalled();
  });

  // Review Focus
  it('drops a second press within 500 ms', async () => {
    startCall();
    await stemWatcherOnHandlers['stem-press']();
    vi.advanceTimersByTime(100);
    await stemWatcherOnHandlers['stem-press']();
    expect(mockBridgeInstance.toggleMute).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the extension is disconnected', async () => {
    startCall();
    mockBridgeInstance.isConnected = false;
    await stemWatcherOnHandlers['stem-press']();
    expect(mockBridgeInstance.toggleMute).not.toHaveBeenCalled();
  });

  it('re-checks Meet for a press that lands after the call ended', async () => {
    bridgeOnHandlers['meet-status']({ active: false, muted: false, tabId: null });
    mockBridgeInstance.queryMeetStatus.mockResolvedValue({ active: false, muted: false, tabId: null });
    await stemWatcherOnHandlers['stem-press']();
    expect(mockBridgeInstance.queryMeetStatus).toHaveBeenCalled();
    expect(mockBridgeInstance.toggleMute).not.toHaveBeenCalled();
  });

  it('switching to Audio API mid-call records the mic again and stops following the log', async () => {
    startCall(true);
    mockStemWatcherInstance.stop.mockClear();
    const onSourceChanged = mockTrayInstance.setOnStemPressSourceChanged.mock.calls[0][0];

    await onSourceChanged('audio-api');

    expect(mockSaveSettings).toHaveBeenCalledWith({ stemPressSource: 'audio-api' });
    expect(mockSystemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone');
    expect(mockStemWatcherInstance.stop).toHaveBeenCalled();
    expect(mockMediaKeysInstance.setInputMuted).toHaveBeenCalledWith(true);
    expect(mockMediaKeysInstance.startAudioInput).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/main/__tests__/index.test.ts`
Expected: FAIL — `setStemPressSource` never called, `stemWatcherOnHandlers['stem-press']` is not a function, AUHAL starts in `system-log` mode.

- [ ] **Step 4: Implement** — in `src/main/index.ts`:

Imports (replace the settings import, add the watcher):

```ts
import { loadSettings, saveSettings, type StemPressSource } from './settings';
import { StemLogWatcher } from './stem-log-watcher';
```

State, after `let pendingFeedback ...`:

```ts
let stemPressSource: StemPressSource = 'audio-api';
// No side effects until start(): follows bluetoothd's log line when the source is system-log.
const stemWatcher = new StemLogWatcher();
```

Constant, after `const PENDING_FEEDBACK_TIMEOUT_MS = 5000;`:

```ts
const AIRPODS_FEEDBACK_DELAY_MS = 300;
```

`syncAudioInput()` — first line becomes:

```ts
const shouldBeActive = stemPressSource === 'audio-api' && enabled && lastMeetStatus.active;
```

`syncInputMuteState()` — the guard becomes:

```ts
  if (stemPressSource !== 'audio-api' || !mediaKeysActive || !lastMeetStatus.active) {
```

New function after `syncInputMuteState()`:

```ts
function syncStemWatcher(): void {
  if (stemPressSource === 'system-log' && enabled && lastMeetStatus.active) {
    stemWatcher.start();
  } else {
    stemWatcher.stop();
  }
}
```

`updateTrayState()` — add `syncStemWatcher();` after `syncAudioInput();`.

New function before `handleMediaKey`:

```ts
// After an AirPods press, let the system's own response to the gesture finish (the
// audioaccessoryd routing transition, or macOS 27's "rejected" chime) before our sound.
function playToggleSound(muted: boolean, isAirpods: boolean): void {
  if (isAirpods) {
    setTimeout(() => mediaKeys.playFeedbackSound(muted), AIRPODS_FEEDBACK_DELAY_MS);
  } else {
    mediaKeys.playFeedbackSound(muted);
  }
}
```

`handleMediaKey` — signature `async function handleMediaKey(isAirpods = false): Promise<void>`; set `pendingFeedback = { expectedMuted: !lastMeetStatus.muted, timestamp: Date.now(), isAirpods };`; replace `mediaKeys.playFeedbackSound(result.muted);` with `playToggleSound(result.muted, isAirpods);`.

`handleAirpodsMute` — replace the comment and `setTimeout(() => mediaKeys.playFeedbackSound(result.muted!), 300);` with `playToggleSound(result.muted, true);`.

`meet-status` fallback — replace the `if (isAirpods) { setTimeout(...) } else { ... }` block with `playToggleSound(status.muted, isAirpods);`.

New function before `app.whenReady()` (body moved from the startup code):

```ts
// The Audio API source records the mic so AVAudioApplication can hand it the gesture.
async function ensureMicPermission(): Promise<void> {
  const micStatus = systemPreferences.getMediaAccessStatus('microphone');
  console.log(`${TAG} Microphone permission: ${micStatus}`);
  if (micStatus === 'granted') return;
  console.log(`${TAG} Requesting microphone access for AirPods mute gesture support...`);
  const micGranted = await systemPreferences.askForMediaAccess('microphone');
  console.log(
    `${TAG} Microphone access ${micGranted ? 'GRANTED' : 'DENIED'} — ${micGranted ? 'AVAudioApplication will suppress notifications' : 'using Darwin notification fallback'}`,
  );
}
```

In the `whenReady` callback, replace the microphone block (comment, `getMediaAccessStatus`, `if (micStatus !== 'granted') {...}`) with:

```ts
const settings = loadSettings();
stemPressSource = settings.stemPressSource;
console.log(`${TAG} AirPods stem press source: ${stemPressSource}`);
if (stemPressSource === 'audio-api') await ensureMicPermission();
```

Remove the later `const settings = loadSettings();` (keep its comment as `// Apply saved settings`). After `tray.setOnShowMuteHudChanged(...)`, add:

```ts
tray.setStemPressSource(stemPressSource);
tray.setOnStemPressSourceChanged(async (source) => {
  console.log(`${TAG} AirPods stem press source → ${source}`);
  stemPressSource = source;
  saveSettings({ stemPressSource: source });
  if (source === 'audio-api') await ensureMicPermission();
  updateTrayState();
});
```

In `mediaKeys.on('media-key', ...)`, the `airpods_mute` branch becomes:

```ts
    } else if (event.key === 'airpods_mute') {
      if (stemPressSource === 'system-log') {
        console.log(`${TAG} airpods_mute ignored — the stem press comes from the system log`);
        return;
      }
      await handleAirpodsMute(event.shouldBeMuted);
    }
```

After `mediaKeys.on('error', ...)`:

```ts
stemWatcher.on('stem-press', async () => {
  console.log(`${TAG} stem-press event received`);
  await handleMediaKey(true);
});
```

In `before-quit`, after `mediaKeys?.stop();`: `stemWatcher.stop();`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/main/__tests__/index.test.ts && npx tsc --noEmit`
Expected: all pass; tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/main/__tests__/index.test.ts
git commit -m "feat: stem press from the system log on macOS 27, behind the stemPressSource flag"
```

---

### Task 5: Docs and full verification

**Files:**

- Modify: `AGENTS.md` (§2b key files table, §16)
- Modify: `README.md` (paragraph at line 86)

- [ ] **Step 1: AGENTS.md** — add to the §2b table, after the `src/main/tray.ts` row:

```markdown
| `src/main/stem-log-watcher.ts` | Follows bluetoothd's stem press log line (macOS 27) |
| `src/main/settings.ts` | `settings.json` in userData, incl. `stemPressSource` |
```

Append to the end of §16:

```markdown
**Workaround — `stemPressSource` (2026-10-08):** `settings.json` key, also the tray submenu **AirPods Stem Press**. `system-log` (default on macOS 27+) runs `StemLogWatcher` during calls: it spawns `/usr/bin/log stream --style ndjson --predicate 'process == "bluetoothd" AND eventMessage CONTAINS "Received Software Mute"'` and toggles Meet on every line, like the play/pause key. In this mode MeetPods does not record (no AUHAL, no `setInputMuted`) and drops `airpods_mute` from the addon, so a press never toggles twice. `audio-api` is the path above, unchanged — switch back when Apple turns the feature flag on. The rejected chime still plays in `system-log` mode; MeetPods's sound follows 300 ms later. Latency measured on 27.0.1: 0–51 ms from bluetoothd's timestamp to the watcher. If presses stop arriving, check that the line still exists: `log stream --predicate 'process == "bluetoothd" AND eventMessage CONTAINS "Software Mute"'` and press the stem during a call.
```

- [ ] **Step 2: README.md** — replace the paragraph at line 86 with:

```markdown
The app also listens for **AirPods stem-hold mute gestures** via `AVAudioApplication` (macOS 14+), suppressing the "Cannot Control Mic" system notification. On macOS 27, where the system no longer hands that gesture to third-party apps, MeetPods follows the press in the system log instead (tray → **AirPods Stem Press** → **System Log**, the default there); macOS still plays its own "rejected" chime before MeetPods's sound.
```

- [ ] **Step 3: Full verification**

Run, from `apps/meetpods`:

```bash
npx vitest run --coverage --coverage.reporter=text
npx tsc --noEmit
npx eslint src/
npx prettier --check src/main AGENTS.md README.md docs/plans
```

Expected: all tests pass. In the coverage table, `stem-log-watcher.ts`, `settings.ts` and `tray.ts` are at 100% lines/functions, and `index.ts` has no uncovered line inside the code this plan added. ESLint: 0 errors. Prettier: the listed paths are clean (extension files with pre-existing warnings are out of scope).

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs: stemPressSource and the macOS 27 system-log workaround"
```

---

### Task 6: Manual verification from source

Needs the user to press the stem. Build first: `npx tsc && node scripts/build-extension.mjs`.

- [ ] **Step 1: Fake client** — start the app with `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .` (log to the scratchpad), then `node .claude/debug/fake-meet-client.js 600000`. The user presses the stem 3 times.
      Expected: the fake client prints `TOGGLE received` 3 times; the app log has `stem-press event received` and no `AUHAL` line.
- [ ] **Step 2: Real call** — stop the fake client; the user joins `meet.new` and presses 4 times.
      Expected: Meet's mic button alternates; the MeetPods sound follows the rejected chime; `lsof`/the menu bar shows only Chrome using the mic.
- [ ] **Step 3: Switch at runtime** — the user picks **Audio API** in the tray mid-call, presses once, then picks **System Log** and presses once.
      Expected: in Audio API the app log shows `AUHAL: audio input started` and the press is rejected (no toggle); back in System Log, `AUHAL: audio input stopped` and the press toggles.

### Task 7: Packaged app

- [ ] **Step 1: Build** — `make dist`. Expected: `dist/MeetPods-0.4.0-arm64.dmg` and `dist/mac-arm64/MeetPods.app`.
- [ ] **Step 2: Install** — move the current `/Applications/MeetPods.app` to the scratchpad as a backup, then `ditto dist/mac-arm64/MeetPods.app /Applications/MeetPods.app`. The ad-hoc signature changes, so macOS may ask for Accessibility again.
- [ ] **Step 3: Real call with the packaged app** — the user opens MeetPods from `/Applications`, joins `meet.new` and presses 3 times. Expected: as in Task 6 Step 2; `pgrep -fl 'log stream'` shows the stream under MeetPods during the call and nothing after it.
- [ ] **Step 4: Record** — update `cerebro/projetos/meetpods.md` (state, decision, next steps) and commit it in the `cerebro` repo.
