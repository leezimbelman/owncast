import {
  PLAYER_VOLUME,
  isInaudible,
  readSavedVolume,
  saveVolume,
  shouldPersistVolume,
  watchForAudiblePlayback,
} from '../components/video/player/volumePersistence';

describe('volumePersistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('readSavedVolume', () => {
    it('returns null when nothing is saved', () => {
      expect(readSavedVolume()).toBeNull();
    });

    it('reads zero', () => {
      localStorage.setItem(PLAYER_VOLUME, '0');
      expect(readSavedVolume()).toBe(0);
    });

    it('reads a fractional volume', () => {
      localStorage.setItem(PLAYER_VOLUME, '0.7');
      expect(readSavedVolume()).toBe(0.7);
    });

    it('returns null for garbage', () => {
      localStorage.setItem(PLAYER_VOLUME, 'abc');
      expect(readSavedVolume()).toBeNull();
    });

    it('clamps values above 1', () => {
      localStorage.setItem(PLAYER_VOLUME, '5');
      expect(readSavedVolume()).toBe(1);
    });
  });

  describe('isInaudible', () => {
    it('is true when muted or at zero volume', () => {
      expect(isInaudible(0.5, true)).toBe(true);
      expect(isInaudible(0, false)).toBe(true);
      expect(isInaudible(0.5, false)).toBe(false);
    });
  });

  describe('shouldPersistVolume', () => {
    const base = { volume: 0.5, muted: false, wasAudible: false, startedMutedByViewer: false };

    it('persists an audible state', () => {
      expect(shouldPersistVolume(base)).toBe(true);
    });

    it('skips a player-imposed mute', () => {
      expect(shouldPersistVolume({ ...base, muted: true })).toBe(false);
    });

    it('persists a mute after the player was audible', () => {
      expect(shouldPersistVolume({ ...base, muted: true, wasAudible: true })).toBe(true);
    });

    it('persists zero volume when the session started from a viewer mute', () => {
      expect(shouldPersistVolume({ ...base, volume: 0, startedMutedByViewer: true })).toBe(true);
    });
  });

  describe('saveVolume', () => {
    it('writes 0 when muted', () => {
      saveVolume(0.6, true);
      expect(localStorage.getItem(PLAYER_VOLUME)).toBe('0');
    });

    it('writes the volume otherwise', () => {
      saveVolume(0.6, false);
      expect(localStorage.getItem(PLAYER_VOLUME)).toBe('0.6');
    });
  });

  describe('watchForAudiblePlayback', () => {
    class FakeMedia extends EventTarget {
      paused = true;

      muted = false;

      volume = 1;
    }

    it('ignores a volumechange while paused', () => {
      const media = new FakeMedia();
      const onAudible = jest.fn();
      watchForAudiblePlayback(media, onAudible);
      media.volume = 0.5;
      media.dispatchEvent(new Event('volumechange'));
      expect(onAudible).not.toHaveBeenCalled();
    });

    it('ignores playing while muted', () => {
      const media = new FakeMedia();
      const onAudible = jest.fn();
      watchForAudiblePlayback(media, onAudible);
      media.muted = true;
      media.paused = false;
      media.dispatchEvent(new Event('playing'));
      expect(onAudible).not.toHaveBeenCalled();
    });

    it('calls once on playing while unmuted with volume above zero', () => {
      const media = new FakeMedia();
      const onAudible = jest.fn();
      watchForAudiblePlayback(media, onAudible);
      media.volume = 0.5;
      media.paused = false;
      media.dispatchEvent(new Event('playing'));
      expect(onAudible).toHaveBeenCalledTimes(1);
    });

    it('calls once when unmuted during playback and not again', () => {
      const media = new FakeMedia();
      const onAudible = jest.fn();
      media.paused = false;
      media.muted = true;
      watchForAudiblePlayback(media, onAudible);
      media.muted = false;
      media.dispatchEvent(new Event('volumechange'));
      media.dispatchEvent(new Event('volumechange'));
      media.dispatchEvent(new Event('playing'));
      expect(onAudible).toHaveBeenCalledTimes(1);
    });

    it('stops listening after cleanup', () => {
      const media = new FakeMedia();
      const onAudible = jest.fn();
      const cleanup = watchForAudiblePlayback(media, onAudible);
      cleanup();
      media.paused = false;
      media.dispatchEvent(new Event('playing'));
      expect(onAudible).not.toHaveBeenCalled();
    });
  });
});
