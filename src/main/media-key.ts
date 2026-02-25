import { EventEmitter } from 'events';
import path from 'path';

const TAG = '[MeetPods:media-key]';

interface NativeAddon {
  start(callback: (key: string, keyDown: boolean) => void): boolean;
  stop(): void;
  setConsume(consume: boolean): void;
  isActive(): boolean;
  startAudioInput(): boolean;
  stopAudioInput(): void;
  playFeedbackSound(isMuted: boolean): void;
  setFeedbackVolume(volume: number): void;
}

function loadAddon(): NativeAddon {
  const devPath = path.join(__dirname, '../../src/native/build/Release/media_key_tap.node');
  const prodPath = path.join(process.resourcesPath, 'native/media_key_tap.node');
  try {
    console.log(`${TAG} Trying prod path: ${prodPath}`);
    const addon = require(prodPath);
    console.log(`${TAG} Loaded native addon from prod path`);
    return addon;
  } catch {
    console.log(`${TAG} Prod path failed, trying dev path: ${devPath}`);
    const addon = require(devPath);
    console.log(`${TAG} Loaded native addon from dev path`);
    return addon;
  }
}

export class MediaKeyManager extends EventEmitter {
  private addon: NativeAddon;
  private running = false;

  constructor() {
    super();
    this.addon = loadAddon();
  }

  start(): boolean {
    if (this.running) {
      console.log(`${TAG} start() called but already running`);
      return true;
    }
    try {
      console.log(`${TAG} Starting media key listener...`);
      this.addon.start((key: string, keyDown: boolean) => {
        if (key === 'airpods_mute') {
          console.log(`${TAG} AirPods mute event: shouldBeMuted=${keyDown}`);
          this.emit('media-key', { key: 'airpods_mute', shouldBeMuted: keyDown });
        } else if (keyDown) {
          console.log(`${TAG} Media key event: ${key}`);
          this.emit('media-key', { key });
        }
      });
      this.running = true;
      console.log(`${TAG} Media key listener started`);
      return true;
    } catch (err) {
      console.error(`${TAG} Failed to start:`, err);
      this.emit('error', err);
      return false;
    }
  }

  stop(): void {
    if (!this.running) return;
    console.log(`${TAG} Stopping media key listener`);
    this.addon.stop();
    this.running = false;
  }

  setConsume(consume: boolean): void {
    console.log(`${TAG} setConsume(${consume})`);
    this.addon.setConsume(consume);
  }

  startAudioInput(): boolean {
    try {
      const ok = this.addon.startAudioInput();
      console.log(`${TAG} startAudioInput() → ${ok}`);
      return ok;
    } catch (err) {
      console.error(`${TAG} startAudioInput() failed:`, err);
      return false;
    }
  }

  stopAudioInput(): void {
    try {
      this.addon.stopAudioInput();
      console.log(`${TAG} stopAudioInput()`);
    } catch (err) {
      console.error(`${TAG} stopAudioInput() failed:`, err);
    }
  }

  playFeedbackSound(isMuted: boolean): void {
    console.log(`${TAG} playFeedbackSound(isMuted=${isMuted})`);
    try {
      this.addon.playFeedbackSound(isMuted);
    } catch (err) {
      console.error(`${TAG} playFeedbackSound() FAILED:`, err);
    }
  }

  setFeedbackVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    try {
      this.addon.setFeedbackVolume(clamped);
      console.log(`${TAG} setFeedbackVolume(${Math.round(clamped * 100)}%)`);
    } catch (err) {
      console.error(`${TAG} setFeedbackVolume() failed:`, err);
    }
  }
}
