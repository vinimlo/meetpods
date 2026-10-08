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

  // `log stream` refuses standard (non-admin) accounts; retrying cannot help.
  it('gives up for the rest of the call when log stream needs an admin account', () => {
    watcher.start();
    latest().stderr.emit('data', Buffer.from("log: Must be admin to run 'stream' command\n"));
    latest().emit('exit', 64, null);
    vi.advanceTimersByTime(60_000);
    expect(children.length).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('needs an admin account'));
  });

  it('tries again on the next call after giving up', () => {
    watcher.start();
    latest().stderr.emit('data', Buffer.from("log: Must be admin to run 'stream' command\n"));
    latest().emit('exit', 64, null);
    watcher.stop();
    watcher.start();
    expect(children.length).toBe(2);
  });

  it('logs what the stream writes to stderr', () => {
    watcher.start();
    latest().stderr.emit('data', Buffer.from('log: Cannot run while sandboxed\n'));
    expect(console.error).toHaveBeenCalledWith(
      '[MeetPods:stem-log] log stream stderr: log: Cannot run while sandboxed',
    );
  });
});
