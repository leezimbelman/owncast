import { getLocalStorage, setLocalStorage } from '../../../utils/localStorage';

export const PLAYER_VOLUME = 'owncast_volume';

// Parsed saved volume clamped to 0..1, or null when absent or invalid.
export function readSavedVolume(): number | null {
  const saved = typeof window !== 'undefined' ? getLocalStorage(PLAYER_VOLUME) : null;
  if (saved === null || saved === '') {
    return null;
  }
  const parsed = Number(saved);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : null;
}

export function isInaudible(volume: number, muted: boolean): boolean {
  return muted || volume === 0;
}

// A mute is persisted only if the viewer could have chosen it: the player has
// been audible during this mount, or the session started from a viewer mute.
// Player-imposed mutes (autoplay fallback, embed initiallyMuted) are skipped.
// Audible volume changes are always persisted.
export function shouldPersistVolume(input: {
  volume: number;
  muted: boolean;
  wasAudible: boolean;
  startedMutedByViewer: boolean;
}): boolean {
  if (!isInaudible(input.volume, input.muted)) {
    return true;
  }
  return input.wasAudible || input.startedMutedByViewer;
}

// Muted is stored as 0, like the old player did.
export function saveVolume(volume: number, muted: boolean): void {
  setLocalStorage(PLAYER_VOLUME, muted ? 0 : volume);
}

// Calls onAudible the first time the media is heard: playing and not
// muted with volume above zero. Returns a cleanup that removes listeners.
export function watchForAudiblePlayback(
  media: Pick<
    HTMLMediaElement,
    'paused' | 'muted' | 'volume' | 'addEventListener' | 'removeEventListener'
  >,
  onAudible: () => void,
): () => void {
  const listener = {
    handleEvent() {
      if (!media.paused && !isInaudible(media.volume, media.muted)) {
        listener.stop();
        onAudible();
      }
    },
    stop() {
      media.removeEventListener('playing', listener);
      media.removeEventListener('volumechange', listener);
    },
  };
  media.addEventListener('playing', listener);
  media.addEventListener('volumechange', listener);
  return listener.stop;
}
