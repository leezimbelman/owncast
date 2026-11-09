import { useEffect, useRef, useState } from 'react';
import type { AutoplayMode } from '../../../utils/autoplay';

// The subset of the media adapter the hook needs. HlsJsAdapter forwards
// play(), muted and volume and dispatches loadstart / volumechange.
export interface AutoplayMedia extends EventTarget {
  play(): Promise<void>;
  muted: boolean;
  volume: number;
}

// Video.js 10 only supports native autoplay, so Owncast's two string modes
// are implemented here, on the adapter's loadstart event. The adapter fires
// loadstart again whenever its hls.js engine is rebuilt (for example the
// "Minimize latency" toggle), so autoplay runs only once, on the first
// loadstart after mount. It is a page-load behavior: a later loadstart must
// not resume a stream the viewer paused, nor mistake a viewer's own mute for
// one the player applied.
//
// Returns true while playback is inaudible *because the player muted it*:
// the 'any' fallback, or an autoplay that started silently without the
// viewer having chosen that. It clears the moment the media becomes
// audible, so any later mute is by definition the viewer's.
//
// startedMutedByViewer: the session began from a mute the viewer chose on an
// earlier visit, so a silent autoplay is theirs and never flags the overlay.
export function useAutoplay(
  media: AutoplayMedia | null,
  mode: AutoplayMode,
  startedMutedByViewer: boolean,
): boolean {
  const [mutedByAutoplay, setMutedByAutoplay] = useState(false);
  // Lives for the whole hook lifetime, so swapping media does not re-autoplay.
  const attempted = useRef(false);

  useEffect(() => {
    // A new media or mode must not inherit a stale flag.
    setMutedByAutoplay(false);
    if (!media) {
      return undefined;
    }
    const inaudible = () => media.muted || media.volume === 0;
    const handleVolumeChange = () => {
      if (!inaudible()) {
        setMutedByAutoplay(false);
      }
    };
    media.addEventListener('volumechange', handleVolumeChange);

    if (mode === false) {
      return () => media.removeEventListener('volumechange', handleVolumeChange);
    }

    let cancelled = false;
    const attempt = async () => {
      if (attempted.current) {
        return;
      }
      attempted.current = true;
      try {
        await media.play();
        if (!cancelled && !startedMutedByViewer && inaudible()) {
          setMutedByAutoplay(true);
        }
      } catch {
        if (cancelled || mode !== 'any') {
          return;
        }
        media.muted = true;
        try {
          await media.play();
          if (!cancelled) {
            setMutedByAutoplay(true);
          }
        } catch {
          // Even muted autoplay was refused; the big play button remains.
        }
      }
    };
    media.addEventListener('loadstart', attempt);

    return () => {
      cancelled = true;
      media.removeEventListener('loadstart', attempt);
      media.removeEventListener('volumechange', handleVolumeChange);
    };
  }, [media, mode, startedMutedByViewer]);

  return mutedByAutoplay;
}
