import { FC, useEffect, useRef } from 'react';
import { useSetAtom } from 'jotai';
import { useHotkeys } from 'react-hotkeys-hook';
import type { HlsJsAdapter } from '@videojs/hlsjs-video';
import { usePlayer } from '../player/createOwncastPlayer';
import { isVideoPlayingAtom } from '../../stores/ClientConfigStore';
import {
  readSavedVolume,
  saveVolume,
  shouldPersistVolume,
  watchForAudiblePlayback,
} from '../player/volumePersistence';
import ViewerPing from '../viewer-ping';
import PlaybackMetrics from '../metrics/playback';

export type PlayerWiringProps = {
  video: HTMLVideoElement | null;
  adapter: HlsJsAdapter | null;
  metrics: PlaybackMetrics;
  clockSkew: number;
  onEngineChange: (engineName: string | undefined) => void;
  // The session began from a mute the viewer chose on an earlier visit.
  startedMutedByViewer: boolean;
  // Bumped by the parent each time resuming playback after a latency engine
  // rebuild is rejected. The rebuild swaps the MediaSource and a rejected
  // play() does not reliably produce a pause event, so the parent signals the
  // failure and this component, which owns the viewer pings and the playing
  // atom, stops them. A counter rather than a callback keeps that ownership
  // here. 0 means no failure yet.
  resumeFailedSignal: number;
};

// Side effects that need the player store or the media element but render
// nothing: volume persistence, viewer pings, the shared "is playing" atom,
// metrics binding, and keyboard shortcuts. Lives inside <Player> so it can
// call usePlayer.
export const PlayerWiring: FC<PlayerWiringProps> = ({
  video,
  adapter,
  metrics,
  clockSkew,
  onEngineChange,
  startedMutedByViewer,
  resumeFailedSignal,
}) => {
  const player = usePlayer();
  const volume = usePlayer(state => state.volume);
  const muted = usePlayer(state => state.muted);
  const setVideoPlaying = useSetAtom(isVideoPlayingAtom);
  const pingRef = useRef<ViewerPing | null>(null);
  const volumeRestored = useRef(false);
  const wasAudible = useRef(false);

  // Restore the persisted volume once the media is attached. A stored 0 is
  // a mute the viewer chose on an earlier visit. Set on the adapter itself:
  // mediaRef delivers it before the store attaches to it, and store actions
  // throw NO_TARGET until then. The store picks the value up from the
  // adapter's volumechange event.
  useEffect(() => {
    if (!adapter || volumeRestored.current) {
      return;
    }
    adapter.volume = readSavedVolume() ?? 1;
    volumeRestored.current = true;
  }, [adapter]);

  // Persist volume changes; muted is stored as 0 like the old player did.
  // A mute the player imposed (autoplay fallback, embed initiallyMuted) is not
  // the viewer's, so it is only saved once the viewer could have chosen it.
  useEffect(() => {
    // Before the restore ran, the store still reports its defaults, which
    // say nothing about what the viewer can hear.
    if (!volumeRestored.current) {
      return;
    }
    if (
      shouldPersistVolume({
        volume,
        muted,
        wasAudible: wasAudible.current,
        startedMutedByViewer,
      })
    ) {
      saveVolume(volume, muted);
    }
  }, [volume, muted, startedMutedByViewer]);

  // wasAudible follows the media element while it is actually playing, not
  // store changes: the restore's volumechange fires while still paused, and a
  // first-time viewer's store never changes from (1, unmuted).
  useEffect(() => {
    if (!video) {
      return undefined;
    }
    return watchForAudiblePlayback(video, () => {
      wasAudible.current = true;
    });
  }, [video]);

  // Viewer pings and the playing atom follow the media element's events.
  useEffect(() => {
    if (!video) {
      return undefined;
    }
    if (!pingRef.current) {
      pingRef.current = new ViewerPing();
    }
    const ping = pingRef.current;
    const onPlaying = () => {
      ping.start();
      setVideoPlaying(true);
    };
    const onStopped = () => {
      ping.stop();
      setVideoPlaying(false);
    };
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onStopped);
    video.addEventListener('ended', onStopped);
    return () => {
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onStopped);
      video.removeEventListener('ended', onStopped);
      onStopped();
    };
  }, [video, setVideoPlaying]);

  // A rejected resume after an engine rebuild leaves playback stopped, so the
  // pings and the playing atom must stop too (see resumeFailedSignal).
  useEffect(() => {
    if (resumeFailedSignal === 0) {
      return;
    }
    pingRef.current?.stop();
    setVideoPlaying(false);
  }, [resumeFailedSignal, setVideoPlaying]);

  // Metrics: bind the element, then re-bind the hls.js engine every time the
  // adapter (re)builds it. The adapter fires loadstart right after creating
  // the engine, and there is no dedicated engine-created event. Detach on
  // cleanup so metrics never stay bound to an element that left the DOM when
  // the Player subtree unmounts while the parent stays mounted.
  useEffect(() => {
    if (!video) {
      return undefined;
    }
    metrics.attachMedia(video);
    return () => {
      metrics.detachMedia();
    };
  }, [video, metrics]);

  useEffect(() => {
    if (!adapter) {
      return undefined;
    }
    const bindEngine = () => {
      metrics.setEngine(adapter.engine ?? null);
      onEngineChange(adapter.engineName);
    };
    bindEngine();
    adapter.addEventListener('loadstart', bindEngine);
    return () => {
      adapter.removeEventListener('loadstart', bindEngine);
      metrics.setEngine(null);
    };
  }, [adapter, metrics, onEngineChange]);

  useEffect(() => {
    metrics.setClockSkew(clockSkew);
  }, [metrics, clockSkew]);

  // Keyboard shortcuts stay document-level (and ignore inputs and
  // contenteditable, so typing in chat never drives the player), as before.
  useHotkeys('space', event => {
    event.preventDefault();
    // The store has no target until the media attaches; actions would throw.
    if (!player.target) {
      return;
    }
    if (player.state.paused) {
      player.play().catch(console.error);
    } else {
      player.pause();
    }
  });
  useHotkeys(
    'f',
    () => {
      if (!player.target) {
        return;
      }
      if (player.state.isFullscreen) {
        player.exitFullscreen().catch(console.error);
      } else {
        player.requestFullscreen().catch(console.error);
      }
    },
    { enableOnContentEditable: false },
  );
  useHotkeys(
    'i',
    () => {
      if (!player.target) {
        return;
      }
      if (player.state.isPictureInPicture) {
        player.exitPictureInPicture().catch(console.error);
      } else {
        player.requestPictureInPicture().catch(console.error);
      }
    },
    { enableOnContentEditable: false },
  );
  useHotkeys(
    'm',
    () => {
      if (!player.target) {
        return;
      }
      if (player.state.muted || player.state.volume === 0) {
        player.setMuted(false);
        player.setVolume(0.7);
      } else {
        player.setVolume(0);
      }
    },
    { enableOnContentEditable: false },
  );
  useHotkeys(
    '0',
    () => {
      if (player.target) {
        player.setVolume(player.state.volume + 0.1);
      }
    },
    { enableOnContentEditable: false },
  );
  useHotkeys(
    '9',
    () => {
      if (player.target) {
        player.setVolume(player.state.volume - 0.1);
      }
    },
    { enableOnContentEditable: false },
  );

  return null;
};
