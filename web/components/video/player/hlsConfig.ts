import type { HlsEngineConfig } from '@videojs/hlsjs-video';

// The raw hls.js config object accepted under HlsSource.engine.hlsJs.
export type HlsJsConfig = NonNullable<HlsEngineConfig['hlsJs']>;

export type LatencyProfile = 'default' | 'low';
export type RequestKind = 'playlist' | 'segment';

export interface RequestDecorator {
  decorateUrl(url: string, kind: RequestKind): string;
}

// hls.js default live sync: stay 3 segments behind the live edge, never
// speed up playback to catch up.
export const DEFAULT_LATENCY_PROFILE = {
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: Infinity,
  maxLiveSyncPlaybackRate: 1,
} as const;

// "Minimize latency": target 2 segments behind the live edge. hls.js speeds
// playback up (to at most 1.08x, the old compensator's cap) only while the
// latency is within about one target duration of that target; once more
// than liveMaxLatencyDurationCount (4) segments behind, it seeks forward to
// the sync position instead of catching up. Segment counts, not seconds:
// hls.js rejects a config that mixes the two forms, and counts track the
// configured segment duration automatically.
export const LOW_LATENCY_PROFILE = {
  liveSyncDurationCount: 2,
  liveMaxLatencyDurationCount: 4,
  maxLiveSyncPlaybackRate: 1.08,
} as const;

const PLAYLIST_CONTEXT_TYPES = new Set(['manifest', 'level']);
const SEGMENT_CONTEXT_TYPE = 'media-fragment';

export function requestKindForContextType(type: string): RequestKind | null {
  if (PLAYLIST_CONTEXT_TYPES.has(type)) {
    return 'playlist';
  }
  if (type === SEGMENT_CONTEXT_TYPE) {
    return 'segment';
  }
  return null;
}

// Playlists are re-fetched every few seconds; a random query value defeats
// intermediate caches that ignore Cache-Control.
export function addCachebuster(url: string, random: () => number = Math.random): string {
  const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
  const u = new URL(url, base);
  u.searchParams.append('cachebust', random().toString(16).slice(2, 8));
  return u.toString();
}

export function buildHlsConfig({
  latencyProfile,
  decorator = null,
}: {
  latencyProfile: LatencyProfile;
  decorator?: RequestDecorator | null;
}): HlsJsConfig {
  const latency = latencyProfile === 'low' ? LOW_LATENCY_PROFILE : DEFAULT_LATENCY_PROFILE;

  return {
    ...latency,
    // Start on the lowest bitrate rendition so the first frame arrives
    // quickly; ABR climbs from there.
    startLevel: 0,
    // A stream restart can leave the playlist unavailable for a while.
    // Keep retrying it well beyond the hls.js default of 2 attempts.
    playlistLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 10000,
        maxLoadTimeMs: 20000,
        timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
        errorRetry: { maxNumRetry: 30, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
      },
    },
    // hls.js only opens the request itself when xhrSetup did not already
    // call open(), so rewriting the URL here is the supported way to add
    // query parameters.
    xhrSetup: (xhr, url, context) => {
      const kind = requestKindForContextType(context.type);
      if (!kind) {
        return;
      }
      let finalUrl = url;
      try {
        if (kind === 'playlist') {
          finalUrl = addCachebuster(finalUrl);
        }
        if (decorator) {
          finalUrl = decorator.decorateUrl(finalUrl, kind);
        }
      } catch {
        // Never let metrics decoration break media loading.
        finalUrl = url;
      }
      if (finalUrl !== url) {
        xhr.open('GET', finalUrl, true);
      }
    },
  };
}
