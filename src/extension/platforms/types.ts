export type PlatformId = 'meet' | 'zoom' | 'teams';

export interface PlatformAdapter {
  readonly platformId: PlatformId;
  readonly displayName: string;
  readonly muteButtonSelectors: string[];
  readonly callIndicators: string[];
  readonly observedAttributes: string[];

  findMuteButton(): HTMLButtonElement | null;
  isMuted(button: HTMLButtonElement): boolean;
  isInCall(): boolean;
}
