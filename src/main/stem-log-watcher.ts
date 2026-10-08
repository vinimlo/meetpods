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
