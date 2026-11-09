# Video.js 10 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Video.js 8 / VHS player in `web/components/video` with Video.js 10 React (`@videojs/react`) on the hls.js engine, keeping every viewer-facing behavior and the CMCD metrics contract.

**Architecture:** `OwncastPlayer` keeps its public props and renders a v10 `Player` (live-video features plus the quality feature) containing a `Container`, an `HlsJsVideo` media element, a hand-built `OwncastSkin` made of v10 headless components styled with SCSS modules, and a null-rendering `PlayerWiring` component that owns side effects (volume persistence, viewer ping, playing atom, metrics engine binding, hotkeys). The custom latency compensator is deleted; the "Minimize latency" toggle switches the hls.js live-sync profile, which rebuilds the engine.

**Tech Stack:** React 18.3, Next.js 16 pages router, TypeScript, `@videojs/react@10.3.0`, `@videojs/hlsjs-video@10.3.0` (hls.js 1.7.3), jotai, next-export-i18n, SCSS modules, Jest + Testing Library, Storybook 10, Cypress.

Spec: `docs/superpowers/specs/2026-11-08-videojs-10-migration-design.md`. Signatures below were verified against the `.d.ts` files shipped in `web/node_modules/@videojs/react` and `web/node_modules/@videojs/hlsjs-video`; check them there when a signature in this plan looks surprising.

## Global Constraints

- **Do not commit, push, or open a PR.** The repository owner reviews the branch `feat/videojs-10` first. Where the usual plan would say "commit", stop and leave the working tree dirty.
- All commands run from the `web/` directory of the repository in a POSIX shell unless stated otherwise.
- `@videojs/react` and `@videojs/hlsjs-video` are **ESM-only** and Jest does not transform `node_modules`. Any module covered by a Jest test must import only **types** from `@videojs/*` (`import type`), never runtime values. Components that import runtime values from `@videojs/react` are verified by `npm run typecheck`, Storybook, and the browser, not by Jest.
- Unit tests live in `web/tests/*.test.ts(x)` (Jest `testRegex` is `/tests/.*\.(test|spec)?\.(ts|tsx)$`), environment jsdom, setup in `tests/setup.ts`.
- Code style: Prettier (single quotes, width 100, trailing commas, `arrowParens: avoid`), ESLint Next + TypeScript rules (`@typescript-eslint/no-shadow`, `no-unused-vars` are errors). Components follow `web/components/_COMPONENT_HOW_TO.md`: `export type XProps = {...}; export const X: FC<XProps> = (...) => ...`, each with a `.stories.tsx` beside it.
- Every user-facing string goes through next-export-i18n keys declared in `web/types/localization.ts` and `web/i18n/en/translation.json` (that JSON is **tab-indented**; edit it without running Prettier on it).
- No emoji anywhere. Conventional Commit messages are not needed because nothing is committed.
- Stable DOM class names for Cypress: `owncast-big-play-button`, `owncast-big-unmute-button`, `owncast-mute-button`.
- CMCD payload keys, event names, `/api/metrics/cmcd`, and `/api/ping` behavior are unchanged.
- Dependencies `@videojs/react@^10.3.0` and `@videojs/hlsjs-video@^10.3.0` are already in `web/package.json` and installed. `video.js` is removed in Task 8.

## Decisions recorded while planning (deviations from the spec)

1. hls.js refuses a config that mixes `liveSyncDuration` (seconds) with `liveSyncDurationCount` (segments). The latency profile uses **counts only**: default = hls.js defaults, low = `liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 4, maxLiveSyncPlaybackRate: 1.08`. No LEVEL_LOADED switch-over.
2. Keyboard shortcuts stay on `react-hotkeys-hook` (document-level, ignores inputs and contenteditable exactly as today) but call the v10 store. v10's `useHotkey` scopes to the player container and would change behavior while chat has focus.
3. Live latency (`ltc`) uses `hls.playingDate` (program-date-time of the playing position) plus the server clock skew, matching the old wall-clock semantics, rather than `hls.latency`.
4. Quality labels keep the admin-configured variant names from `/api/video/variants`: the hls.js level index is the rendition id, `level.url[0]` contains `/hls/<variantIndex>/`, and that index selects the name. Fallback is `<height>p`, then `<kbps> kbps`.

## File structure

| Path | Responsibility |
| --- | --- |
| `web/components/video/player/createOwncastPlayer.ts` | Calls `createPlayer` once; exports `Player`, `usePlayer`, `useMedia`. |
| `web/components/video/player/usePlayerLabels.ts` | Returns all player strings translated with English fallbacks; builds the `I18nProvider` overrides. |
| `web/components/video/player/hlsConfig.ts` | Pure builder for the hls.js config: cachebuster + CMCD `xhrSetup`, retry policy, latency profile. |
| `web/components/video/player/useAutoplay.ts` | Implements autoplay modes `'any'` / `'play'` on the media adapter; exposes `mutedByAutoplay`. |
| `web/components/video/player/latencyPreference.ts` | localStorage read/write for the "Minimize latency" preference (key `latencyCompensatorEnabled`). |
| `web/components/video/metrics/playback.js` | CMCD emitter; now fed by a `<video>` element and the hls.js instance. |
| `web/components/video/SettingsMenu/SettingsMenu.tsx` (+ `.module.scss`, `.stories.tsx`) | Gear menu: quality radio group and latency toggle. |
| `web/components/video/OwncastSkin/OwncastSkin.tsx` (+ `.module.scss`, `.stories.tsx`) | Control bar, big play button, unmute overlay, buffering, error message. |
| `web/components/video/OwncastPlayer/OwncastPlayer.tsx` (+ `.module.scss`, story) | Public component; composes Player, Container, HlsJsVideo, skin, wiring. |
| `web/components/video/OwncastPlayer/PlayerWiring.tsx` | Null-rendering effects: volume persistence, ping, playing atom, metrics, hotkeys. |
| `web/tests/hlsConfig.test.ts`, `web/tests/useAutoplay.test.ts`, `web/tests/playbackMetrics.test.ts`, `web/tests/latencyPreference.test.ts` | Unit tests. |
| Deleted in Task 8 | `VideoJS/*`, `latencyCompensator.js`, `settings-menu.ts`, `airplay.svg`, `video.js` dependency, global player CSS imports. |

---

### Task 1: Player store, labels, and i18n keys

**Files:**
- Create: `web/components/video/player/createOwncastPlayer.ts`
- Create: `web/components/video/player/usePlayerLabels.ts`
- Modify: `web/types/localization.ts` (inside `Frontend`, after the `unmute` line)
- Modify: `web/i18n/en/translation.json` (inside `"Frontend"`, tab-indented)

**Interfaces:**
- Produces: `Player`, `usePlayer`, `useMedia` (typed to live-video features + quality). `usePlayerLabels(): PlayerLabels` and `playerI18nOverrides(labels: PlayerLabels)`.

- [ ] **Step 1: Create the player store module**

```ts
// web/components/video/player/createOwncastPlayer.ts
import { createPlayer, liveVideoFeatures, qualityFeature } from '@videojs/react';

// One store definition for the whole app. liveVideoFeatures deliberately
// omits quality selection, so it is added back: Owncast streams several
// renditions and the settings menu lets viewers pick one.
export const { Player, usePlayer, useMedia } = createPlayer({
  features: [...liveVideoFeatures, qualityFeature],
  displayName: 'OwncastPlayer',
});
```

- [ ] **Step 2: Add localization keys to the type map**

In `web/types/localization.ts`, directly after the line `unmute: 'Frontend.unmute',` add:

```ts
    // Video player controls
    Player: {
      play: 'Frontend.Player.play',
      pause: 'Frontend.Player.pause',
      mute: 'Frontend.Player.mute',
      fullscreen: 'Frontend.Player.fullscreen',
      exitFullscreen: 'Frontend.Player.exitFullscreen',
      pictureInPicture: 'Frontend.Player.pictureInPicture',
      exitPictureInPicture: 'Frontend.Player.exitPictureInPicture',
      airplay: 'Frontend.Player.airplay',
      live: 'Frontend.Player.live',
      goLive: 'Frontend.Player.goLive',
      settings: 'Frontend.Player.settings',
      quality: 'Frontend.Player.quality',
      minimizeLatency: 'Frontend.Player.minimizeLatency',
      minimizeLatencyDescription: 'Frontend.Player.minimizeLatencyDescription',
      on: 'Frontend.Player.on',
      off: 'Frontend.Player.off',
      playbackError: 'Frontend.Player.playbackError',
      player: 'Frontend.Player.player',
    },
```

- [ ] **Step 3: Add the English strings**

In `web/i18n/en/translation.json`, inside the `"Frontend": {` object, add a `"Player"` object in alphabetical position (after `"OfflineRecommendation"`-style nested objects; keys are sorted, so place it after the entry that sorts before "Player"). Use tabs, two tab levels for the object key and three for its members:

```json
		"Player": {
			"airplay": "AirPlay",
			"exitFullscreen": "Exit fullscreen",
			"exitPictureInPicture": "Exit picture-in-picture",
			"fullscreen": "Fullscreen",
			"goLive": "Go live",
			"live": "Live",
			"minimizeLatency": "Minimize latency",
			"minimizeLatencyDescription": "Experimental: slightly speeds up playback to keep you closer to live",
			"mute": "Mute",
			"off": "OFF",
			"on": "ON",
			"pause": "Pause",
			"pictureInPicture": "Picture-in-picture",
			"play": "Play",
			"playbackError": "Playback failed. The stream may have ended or your connection was interrupted.",
			"player": "Video player",
			"quality": "Quality",
			"settings": "Settings"
		},
```

Make sure the preceding entry ends with a comma and the JSON stays valid: run `node -e "JSON.parse(require('fs').readFileSync('i18n/en/translation.json','utf8')); console.log('ok')"`.

- [ ] **Step 4: Create the labels hook**

```ts
// web/components/video/player/usePlayerLabels.ts
import { useMemo } from 'react';
import { useTranslation } from 'next-export-i18n';
import { Localization } from '../../../types/localization';

const KEYS = Localization.Frontend.Player;

const ENGLISH: Record<keyof typeof KEYS, string> = {
  play: 'Play',
  pause: 'Pause',
  mute: 'Mute',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  pictureInPicture: 'Picture-in-picture',
  exitPictureInPicture: 'Exit picture-in-picture',
  airplay: 'AirPlay',
  live: 'Live',
  goLive: 'Go live',
  settings: 'Settings',
  quality: 'Quality',
  minimizeLatency: 'Minimize latency',
  minimizeLatencyDescription:
    'Experimental: slightly speeds up playback to keep you closer to live',
  on: 'ON',
  off: 'OFF',
  playbackError: 'Playback failed. The stream may have ended or your connection was interrupted.',
  player: 'Video player',
};

export type PlayerLabels = Record<keyof typeof KEYS, string> & { unmute: string };

// next-export-i18n returns the key itself when a translation is missing;
// fall back to English in that case, mirroring the Translation component.
const withFallback = (translated: string, key: string, fallback: string) =>
  translated === key ? fallback : translated;

export function usePlayerLabels(): PlayerLabels {
  const { t } = useTranslation();
  return useMemo(() => {
    const labels = Object.fromEntries(
      (Object.keys(KEYS) as Array<keyof typeof KEYS>).map(name => [
        name,
        withFallback(t(KEYS[name]), KEYS[name], ENGLISH[name]),
      ]),
    ) as Record<keyof typeof KEYS, string>;
    return {
      ...labels,
      unmute: withFallback(
        t(Localization.Frontend.unmute),
        Localization.Frontend.unmute,
        'Unmute',
      ),
    };
  }, [t]);
}

// Overrides for @videojs/react's I18nProvider so the built-in buttons
// announce Owncast's translated labels instead of the package's English.
export function playerI18nOverrides(labels: PlayerLabels) {
  return {
    buttons: { play: labels.play, pause: labels.pause, mute: labels.mute, unmute: labels.unmute },
    fullscreen: { enter: labels.fullscreen, exit: labels.exitFullscreen },
    pip: { enter: labels.pictureInPicture, exit: labels.exitPictureInPicture },
    airplay: { start: labels.airplay, stop: labels.airplay },
    live: { badge: labels.live, playing: labels.live, seekToEdge: labels.goLive },
    menu: { settings: labels.settings, quality: labels.quality },
    container: { label: labels.player },
  };
}
```

- [ ] **Step 5: Typecheck and run the existing tests**

Run: `npm run typecheck && npx jest tests/localization-keys.test.ts tests/translation.test.tsx`
Expected: typecheck exits 0; both test files pass.

- [ ] **Step 6: Do not commit.** Leave changes in the working tree.

---

### Task 2: hls.js config builder

**Files:**
- Create: `web/components/video/player/hlsConfig.ts`
- Test: `web/tests/hlsConfig.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LatencyProfile = 'default' | 'low';
  export type RequestKind = 'playlist' | 'segment';
  export interface RequestDecorator { decorateUrl(url: string, kind: RequestKind): string }
  export function buildHlsConfig(options: { latencyProfile: LatencyProfile; decorator?: RequestDecorator | null }): HlsJsConfig;
  export function addCachebuster(url: string, random?: () => number): string;
  export function requestKindForContextType(type: string): RequestKind | null;
  export const LOW_LATENCY_PROFILE, DEFAULT_LATENCY_PROFILE;
  ```
- Consumed by Task 7 (`OwncastPlayer`) and Task 3 (metrics implements `RequestDecorator`).

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/hlsConfig.test.ts
import {
  addCachebuster,
  buildHlsConfig,
  DEFAULT_LATENCY_PROFILE,
  LOW_LATENCY_PROFILE,
  requestKindForContextType,
} from '../components/video/player/hlsConfig';

const fakeXhr = () => ({ open: jest.fn() });

describe('hlsConfig', () => {
  test('classifies hls.js loader contexts', () => {
    expect(requestKindForContextType('manifest')).toBe('playlist');
    expect(requestKindForContextType('level')).toBe('playlist');
    expect(requestKindForContextType('media-fragment')).toBe('segment');
    expect(requestKindForContextType('key')).toBeNull();
  });

  test('adds a six character cachebuster to playlist urls', () => {
    const url = addCachebuster('http://localhost:8080/hls/stream.m3u8', () => 0.123456789);
    const cachebust = new URL(url).searchParams.get('cachebust');
    expect(cachebust).toHaveLength(6);
    expect(cachebust).toBe((0.123456789).toString(16).slice(2, 8));
  });

  test('default profile uses hls.js live sync defaults', () => {
    const config = buildHlsConfig({ latencyProfile: 'default' });
    expect(config).toMatchObject(DEFAULT_LATENCY_PROFILE);
    expect(config.startLevel).toBe(0);
    expect(config.liveSyncDuration).toBeUndefined();
  });

  test('low profile tightens the live window with counts only', () => {
    const config = buildHlsConfig({ latencyProfile: 'low' });
    expect(config).toMatchObject(LOW_LATENCY_PROFILE);
    expect(config.liveSyncDurationCount).toBe(2);
    expect(config.liveMaxLatencyDurationCount).toBe(4);
    expect(config.maxLiveSyncPlaybackRate).toBe(1.08);
    expect(config.liveSyncDuration).toBeUndefined();
    expect(config.liveMaxLatencyDuration).toBeUndefined();
  });

  test('xhrSetup rewrites playlist requests with cachebuster and CMCD', () => {
    const decorator = { decorateUrl: jest.fn((url: string) => `${url}&CMCD=x`) };
    const config = buildHlsConfig({ latencyProfile: 'default', decorator });
    const xhr = fakeXhr();
    config.xhrSetup(xhr as any, 'http://h/hls/stream.m3u8', { type: 'level' } as any);
    expect(decorator.decorateUrl).toHaveBeenCalledWith(
      expect.stringContaining('cachebust='),
      'playlist',
    );
    const opened = xhr.open.mock.calls[0][1] as string;
    expect(opened).toContain('cachebust=');
    expect(opened).toContain('CMCD=x');
  });

  test('xhrSetup decorates segments without a cachebuster', () => {
    const decorator = { decorateUrl: jest.fn((url: string) => `${url}?CMCD=y`) };
    const config = buildHlsConfig({ latencyProfile: 'default', decorator });
    const xhr = fakeXhr();
    config.xhrSetup(xhr as any, 'http://h/hls/0/stream-1.ts', { type: 'media-fragment' } as any);
    expect(decorator.decorateUrl).toHaveBeenCalledWith('http://h/hls/0/stream-1.ts', 'segment');
    expect(xhr.open).toHaveBeenCalledWith('GET', 'http://h/hls/0/stream-1.ts?CMCD=y', true);
  });

  test('xhrSetup leaves other requests alone and survives decorator errors', () => {
    const decorator = {
      decorateUrl: jest.fn(() => {
        throw new Error('boom');
      }),
    };
    const config = buildHlsConfig({ latencyProfile: 'default', decorator });
    const xhr = fakeXhr();
    config.xhrSetup(xhr as any, 'http://h/key', { type: 'key' } as any);
    expect(xhr.open).not.toHaveBeenCalled();
    config.xhrSetup(xhr as any, 'http://h/hls/0/stream-1.ts', { type: 'media-fragment' } as any);
    expect(xhr.open).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/hlsConfig.test.ts`
Expected: FAIL, "Cannot find module '../components/video/player/hlsConfig'".

- [ ] **Step 3: Implement the builder**

```ts
// web/components/video/player/hlsConfig.ts
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

// "Minimize latency": sit 2 segments behind, and once more than 4 segments
// behind let hls.js speed playback up to 1.08x (the old compensator's cap)
// until it is back at the target. Segment counts, not seconds: hls.js
// rejects a config that mixes the two forms, and counts track the
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
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/hlsConfig.test.ts && npm run typecheck`
Expected: 7 tests pass; typecheck exits 0. If TypeScript complains that `xhrSetup` may be undefined in the tests, call it as `config.xhrSetup!(...)`.

- [ ] **Step 5: Do not commit.**

---

### Task 3: PlaybackMetrics on hls.js

**Files:**
- Modify: `web/components/video/metrics/playback.js` (rewrite the class; keep the helper functions at the top of the file unchanged: `generateSessionID`, `CMCD_TOKEN_KEYS`, `encodeCmcdDictionary`, `appendCmcdQuery`, and the constants `URL_CMCD_COLLECTOR`, `EVENT_REPORT_INTERVAL`, `MAX_VALID_LATENCY_SECONDS`, `CMCD_VERSION`)
- Test: `web/tests/playbackMetrics.test.ts` (rewrite)

**Interfaces:**
- Produces (default export class `PlaybackMetrics`):
  ```js
  new PlaybackMetrics()                 // starts the 10 s interval timer
  metrics.attachMedia(videoElement)     // HTMLVideoElement; binds media events
  metrics.setEngine(hls | null)         // hls.js instance from adapter.engine
  metrics.setClockSkew(skewMs)
  metrics.decorateUrl(url, kind)        // RequestDecorator for hlsConfig
  metrics.stop()                        // final report, unbinds everything
  ```
- Consumes: hls.js event name `'hlsFragLoaded'` (`Hls.Events.FRAG_LOADED`), `hls.bandwidthEstimate`, `hls.levels`, `hls.currentLevel`, `hls.playingDate`.

- [ ] **Step 1: Rewrite the test file**

```ts
// web/tests/playbackMetrics.test.ts
import PlaybackMetrics from '../components/video/metrics/playback';

class FakeMedia extends EventTarget {
  paused = false;

  ended = false;

  seeking = false;

  currentTime = 0;

  playbackRate = 1;

  error: { code: number } | null = null;

  buffered = { length: 0, end: () => 0 };

  trigger(event: string) {
    this.dispatchEvent(new Event(event));
  }
}

type FragHandler = (event: string, data: unknown) => void;

const makeHls = () => {
  const handlers = new Map<string, FragHandler>();
  return {
    bandwidthEstimate: 2_560_000,
    currentLevel: 1,
    levels: [{ bitrate: 800_000 }, { bitrate: 1_500_000 }],
    playingDate: null as Date | null,
    on: jest.fn((event: string, handler: FragHandler) => handlers.set(event, handler)),
    off: jest.fn((event: string) => handlers.delete(event)),
    emit: (event: string, data: unknown) => handlers.get(event)?.(event, data),
  };
};

const reports = () =>
  (global.fetch as jest.Mock).mock.calls.map(([, init]) => JSON.parse(init.body));

describe('PlaybackMetrics', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn(() => Promise.resolve({})) as jest.Mock;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('reports ended when a started player is torn down', async () => {
    const media = new FakeMedia();
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);

    media.trigger('playing');
    await Promise.resolve();
    metrics.stop();
    await Promise.resolve();

    expect(reports().map(report => report.sta)).toEqual(['p', 'e']);
  });

  test('reports a pause after playback starts', async () => {
    const media = new FakeMedia();
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);

    media.trigger('playing');
    media.trigger('pause');
    await Promise.resolve();

    expect(reports().map(report => report.sta)).toEqual(['p', 'a']);
    metrics.stop();
  });

  test('keeps a paused session fresh beyond the server stale timeout', async () => {
    const media = new FakeMedia();
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);

    media.trigger('playing');
    media.paused = true;
    media.trigger('pause');
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();

    expect(reports().map(report => report.sta)).toEqual(['p', 'a', 'a', 'a', 'a', 'a', 'a', 'a']);
    metrics.stop();
  });

  test('decorates requests with CMCD request-mode keys from hls.js state', () => {
    const media = new FakeMedia();
    const hls = makeHls();
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);
    metrics.setEngine(hls as any);

    const url = metrics.decorateUrl('http://h/hls/stream.m3u8?cachebust=abc', 'playlist');
    const cmcd = decodeURIComponent(new URL(url).searchParams.get('CMCD') as string);

    expect(cmcd).toContain('v=2');
    expect(cmcd).toContain('ot=m');
    expect(cmcd).toContain('sf=h');
    expect(cmcd).toContain('st=l');
    expect(cmcd).toContain('su'); // startup until first playing event
    expect(cmcd).toContain('mtp=2600'); // 2,560 kbps rounded to 100
    expect(cmcd).toContain('br=1500');
    expect(cmcd).toMatch(/sid="[0-9a-f-]{36}"/);

    const segmentUrl = metrics.decorateUrl('http://h/hls/0/s-1.ts', 'segment');
    expect(decodeURIComponent(new URL(segmentUrl).searchParams.get('CMCD') as string)).toContain(
      'ot=av',
    );
    metrics.stop();
  });

  test('averages fragment download times into ttlb and reads live latency', async () => {
    const media = new FakeMedia();
    const hls = makeHls();
    hls.playingDate = new Date(Date.now() - 4_000);
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);
    metrics.setEngine(hls as any);
    expect(hls.on).toHaveBeenCalledWith('hlsFragLoaded', expect.any(Function));

    hls.emit('hlsFragLoaded', { frag: { stats: { loading: { start: 100, end: 300 } } } });
    hls.emit('hlsFragLoaded', { frag: { stats: { loading: { start: 400, end: 800 } } } });
    media.trigger('playing');
    await Promise.resolve();

    const [first] = reports();
    expect(first.ttlb).toBe(300);
    expect(first.ltc).toBeGreaterThanOrEqual(3_900);
    expect(first.ltc).toBeLessThan(5_000);

    metrics.setEngine(null);
    expect(hls.off).toHaveBeenCalledWith('hlsFragLoaded', expect.any(Function));
    metrics.stop();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/playbackMetrics.test.ts`
Expected: FAIL (constructor still expects a player; `attachMedia` is not a function).

- [ ] **Step 3: Rewrite the class**

Keep lines 1 through the end of `appendCmcdQuery` as they are, but delete the `getCurrentlyPlayingSegment` function (it read VHS playlists). Replace everything from the `/* CMCD v2 ... */` comment to the end of the file with:

```js
// hls.js event name for Hls.Events.FRAG_LOADED. Spelled out so this module
// stays free of the ESM-only @videojs packages and remains unit-testable.
const HLS_FRAG_LOADED_EVENT = 'hlsFragLoaded';

/*
CMCD v2 (CTA-5004-A) metrics emitter.

Request mode: every playlist and segment request the player makes is
decorated with a CMCD query parameter carrying throughput, buffer, bitrate
and live latency data, which the server harvests off the requests it is
already serving. The hls.js xhrSetup hook (see player/hlsConfig.ts) calls
decorateUrl for each request.

Event mode: player state transitions, errors and a periodic time-interval
report are POSTed to the CMCD collector endpoint.

Lifecycle: construct once per player mount, attachMedia(videoElement) when
the element exists, setEngine(hls) every time the hls.js engine is created
(it is rebuilt when the latency profile changes), stop() on unmount.
*/
class PlaybackMetrics {
  constructor() {
    this.media = null;
    this.hls = null;
    this.clockSkewMs = 0;
    this.sessionID = generateSessionID();
    this.sequenceNumber = 0;

    this.hasStartedPlaying = false;
    this.isStalled = false;
    this.playRequestedAt = null;
    this.mediaStartDelayMs = null;
    this.mediaStartDelaySent = false;
    this.segmentDownloadTimesMs = [];

    this.handlePlay = this.handlePlay.bind(this);
    this.handlePlaying = this.handlePlaying.bind(this);
    this.handlePause = this.handlePause.bind(this);
    this.handleEnded = this.handleEnded.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleBuffering = this.handleBuffering.bind(this);
    this.handleNoLongerBuffering = this.handleNoLongerBuffering.bind(this);
    this.handleFragLoaded = this.handleFragLoaded.bind(this);

    this.mediaListeners = [
      ['play', this.handlePlay],
      ['playing', this.handlePlaying],
      ['pause', this.handlePause],
      ['ended', this.handleEnded],
      ['error', this.handleError],
      ['stalled', this.handleBuffering],
      ['waiting', this.handleBuffering],
      ['canplaythrough', this.handleNoLongerBuffering],
    ];

    this.eventReportTimer = setInterval(() => {
      if (!this.media || !this.hasStartedPlaying) {
        return;
      }
      if (this.media.paused) {
        // Viewer pings keep a paused tab active. Refresh its CMCD state too,
        // or the server prunes its health before the viewer.
        this.sendEventReport('t', { sta: 'a' });
        return;
      }
      this.sendEventReport('t');
    }, EVENT_REPORT_INTERVAL);
  }

  attachMedia(media) {
    if (this.media === media) {
      return;
    }
    this.detachMedia();
    this.media = media;
    if (media) {
      this.mediaListeners.forEach(([event, handler]) => media.addEventListener(event, handler));
    }
  }

  detachMedia() {
    if (!this.media) {
      return;
    }
    this.mediaListeners.forEach(([event, handler]) =>
      this.media.removeEventListener(event, handler),
    );
    this.media = null;
  }

  // Bind to the hls.js instance for throughput, bitrate, latency and
  // per-fragment download timing. Pass null when the engine is destroyed.
  setEngine(hls) {
    if (this.hls === hls) {
      return;
    }
    if (this.hls) {
      this.hls.off(HLS_FRAG_LOADED_EVENT, this.handleFragLoaded);
    }
    this.hls = hls;
    if (hls) {
      hls.on(HLS_FRAG_LOADED_EVENT, this.handleFragLoaded);
    }
  }

  stop() {
    clearInterval(this.eventReportTimer);
    // Component teardown does not reliably emit an ended event. Preserve the
    // terminal state while its viewer is still active.
    if (this.hasStartedPlaying && this.media && !this.media.ended) {
      this.sendEventReport('ps', { sta: 'e' });
    }
    this.detachMedia();
    this.setEngine(null);
  }

  // Keep our client clock in sync with the server clock to determine
  // accurate latency calculations.
  setClockSkew(skewMs) {
    this.clockSkewMs = skewMs;
  }

  // RequestDecorator implementation used by the hls.js xhrSetup hook.
  decorateUrl(url, kind) {
    return appendCmcdQuery(url, {
      ...this.commonCmcdKeys(),
      ot: kind === 'segment' ? 'av' : 'm',
      sf: 'h',
      st: 'l',
      su: !this.hasStartedPlaying || undefined,
    });
  }

  // Time segment downloads client-side: reported as ttlb, the only
  // download duration measurement that stays honest when a proxy or
  // tunnel sits between the viewer and the server.
  handleFragLoaded(_event, data) {
    const loading = data?.frag?.stats?.loading;
    if (!loading || !(loading.end > loading.start)) {
      return;
    }
    this.segmentDownloadTimesMs.push(Math.round(loading.end - loading.start));
  }

  handlePlay() {
    if (this.playRequestedAt === null) {
      this.playRequestedAt = Date.now();
    }
  }

  handlePlaying() {
    if (this.mediaStartDelayMs === null && this.playRequestedAt !== null) {
      this.mediaStartDelayMs = Date.now() - this.playRequestedAt;
    }
    const firstPlay = !this.hasStartedPlaying;
    this.hasStartedPlaying = true;
    this.isStalled = false;
    if (firstPlay) {
      this.sendEventReport('ps', { sta: 'p' });
    }
  }

  handlePause() {
    // Tearing down the player fires a pause; don't report it.
    if (this.media && !this.media.ended) {
      this.sendEventReport('ps', { sta: 'a' });
    }
  }

  handleEnded() {
    this.sendEventReport('ps', { sta: 'e' });
  }

  handleError() {
    const error = this.media?.error;
    this.sendEventReport('e', { ec: error ? String(error.code) : undefined });
  }

  handleBuffering() {
    // Buffering before the first frame is startup, not an interruption. A
    // waiting event that fires while seeking is the fetch at a seek
    // discontinuity, not a playback interruption. Genuine starvation fires
    // with seeking false, so only report those.
    if (!this.hasStartedPlaying || this.media?.seeking || this.isStalled) {
      return;
    }
    this.isStalled = true;
    this.sendEventReport('ps', { sta: 'w', bs: true });
  }

  handleNoLongerBuffering() {
    this.isStalled = false;
  }

  // CMCD keys shared by request-mode decoration and event reports.
  commonCmcdKeys() {
    const keys = {
      v: CMCD_VERSION,
      sid: this.sessionID,
    };

    const throughput = this.measuredThroughputKbps();
    if (throughput) {
      keys.mtp = throughput;
    }

    const bitrate = this.currentBitrateKbps();
    if (bitrate) {
      keys.br = bitrate;
    }

    const buffer = this.bufferLengthMs();
    if (buffer !== null) {
      keys.bl = buffer;
    }

    const latency = this.liveLatencyMs();
    if (latency !== null) {
      keys.ltc = latency;
    }

    const playbackRate = this.media?.playbackRate ?? 1;
    if (playbackRate !== 1) {
      keys.pr = playbackRate;
    }

    return keys;
  }

  async sendEventReport(event, extraKeys = {}) {
    this.sequenceNumber += 1;

    const report = {
      ...this.commonCmcdKeys(),
      ...extraKeys,
      e: event,
      ts: Date.now(),
      sn: this.sequenceNumber,
    };

    if (report.sta === undefined) {
      report.sta = this.playerStateToken();
    }

    if (!this.mediaStartDelaySent && this.mediaStartDelayMs !== null) {
      this.mediaStartDelaySent = true;
      report.msd = this.mediaStartDelayMs;
    }

    const droppedFrames = this.droppedFrameCount();
    if (droppedFrames) {
      report.df = droppedFrames;
    }

    // Average client-measured segment download time since the last report,
    // reported as ttlb in milliseconds.
    if (this.segmentDownloadTimesMs.length > 0) {
      const sum = this.segmentDownloadTimesMs.reduce((p, c) => p + c, 0);
      report.ttlb = Math.round(sum / this.segmentDownloadTimesMs.length);
      this.segmentDownloadTimesMs = [];
    }

    Object.keys(report).forEach(key => {
      if (report[key] === undefined || report[key] === null) {
        delete report[key];
      }
    });

    try {
      await fetch(URL_CMCD_COLLECTOR, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(report),
      });
    } catch (e) {
      console.error(e);
    }
  }

  playerStateToken() {
    if (this.media?.seeking) {
      return 'k';
    }
    if (this.media?.ended) {
      return 'e';
    }
    if (this.media?.paused) {
      return 'a';
    }
    return 'p';
  }

  // hls.js bandwidth estimate in bits per second, reported as kbps rounded
  // to the nearest 100 as the CMCD spec asks.
  measuredThroughputKbps() {
    const bandwidth = this.hls?.bandwidthEstimate;
    if (!bandwidth || !Number.isFinite(bandwidth)) {
      return null;
    }
    return Math.round(bandwidth / 1000 / 100) * 100;
  }

  currentBitrateKbps() {
    const level = this.hls?.levels?.[this.hls.currentLevel];
    const bitrate = level?.bitrate;
    if (!bitrate) {
      return null;
    }
    return Math.round(bitrate / 1000);
  }

  bufferLengthMs() {
    try {
      const buffered = this.media?.buffered;
      if (!buffered || buffered.length === 0) {
        return null;
      }
      const bufferMs = (buffered.end(buffered.length - 1) - this.media.currentTime) * 1000;
      if (bufferMs < 0) {
        return null;
      }
      // The spec asks for buffer length rounded to the nearest 100ms.
      return Math.round(bufferMs / 100) * 100;
    } catch {
      return null;
    }
  }

  // Wall-clock latency: program-date-time of the playing position (hls.js
  // playingDate) against the server clock.
  liveLatencyMs() {
    const playingDate = this.hls?.playingDate;
    if (!playingDate) {
      return null;
    }
    const now = Date.now() + this.clockSkewMs;
    const latency = now - playingDate.getTime();

    // Throw away values that seem invalid.
    if (latency < 0 || latency / 1000 >= MAX_VALID_LATENCY_SECONDS) {
      return null;
    }
    return Math.round(latency);
  }

  droppedFrameCount() {
    const media = this.media;
    if (!media?.getVideoPlaybackQuality) {
      return null;
    }
    return media.getVideoPlaybackQuality().droppedVideoFrames || null;
  }
}

export default PlaybackMetrics;
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/playbackMetrics.test.ts && npx eslint components/video/metrics/playback.js`
Expected: 5 tests pass; ESLint clean. (`OwncastPlayer.tsx` still constructs `new PlaybackMetrics(player, videojs)`; that call is replaced in Task 7 and typecheck of a `.js` module does not flag the arity.)

- [ ] **Step 5: Do not commit.**

---

### Task 4: Autoplay hook and latency preference

**Files:**
- Modify: `web/utils/autoplay.ts` (rename the mode type)
- Create: `web/components/video/player/useAutoplay.ts`
- Create: `web/components/video/player/latencyPreference.ts`
- Test: `web/tests/useAutoplay.test.ts`, `web/tests/latencyPreference.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // utils/autoplay.ts
  export type AutoplayMode = false | 'any' | 'play';   // renamed from VideoJSAutoplayMode
  // player/useAutoplay.ts
  export interface AutoplayMedia extends EventTarget { play(): Promise<void>; muted: boolean; volume: number }
  export function useAutoplay(media: AutoplayMedia | null, mode: AutoplayMode, startsInaudible: boolean): boolean; // mutedByAutoplay
  // player/latencyPreference.ts
  export const LATENCY_COMPENSATION_ENABLED = 'latencyCompensatorEnabled';
  export function readLatencyPreference(): boolean;
  export function writeLatencyPreference(enabled: boolean): void;
  ```

- [ ] **Step 1: Rename the autoplay mode type**

In `web/utils/autoplay.ts` replace the comment block and type:

```ts
// Autoplay modes:
//   false  -> no autoplay
//   'any'  -> try to play with sound, fall back to muted if the browser blocks it
//   'play' -> play with sound when the browser allows it, otherwise stay paused
export type AutoplayMode = false | 'any' | 'play';
```

and change the return type of `autoplayModeForSetting` from `VideoJSAutoplayMode` to `AutoplayMode`. Update the comment above it from "Map an autoplay setting to the video.js autoplay value." to "Map an autoplay setting to the player's autoplay mode.". Run `npx jest tests/autoplay.test.ts` (expect pass, unchanged behavior).

- [ ] **Step 2: Write the failing autoplay tests**

```ts
// web/tests/useAutoplay.test.ts
import { act, renderHook } from '@testing-library/react';
import { useAutoplay } from '../components/video/player/useAutoplay';

class FakeMedia extends EventTarget {
  muted = false;

  volume = 1;

  play = jest.fn<Promise<void>, []>(() => Promise.resolve());

  loadstart() {
    this.dispatchEvent(new Event('loadstart'));
  }

  setVolume(volume: number, muted = false) {
    this.volume = volume;
    this.muted = muted;
    this.dispatchEvent(new Event('volumechange'));
  }
}

const blockedUnlessMuted = (media: FakeMedia) =>
  jest.fn<Promise<void>, []>(() =>
    media.muted ? Promise.resolve() : Promise.reject(new Error('NotAllowedError')),
  );

const flush = () => act(async () => {});

describe('useAutoplay', () => {
  test('mode false never calls play', async () => {
    const media = new FakeMedia();
    renderHook(() => useAutoplay(media, false, false));
    act(() => media.loadstart());
    await flush();
    expect(media.play).not.toHaveBeenCalled();
  });

  test("mode 'play' plays audibly and leaves the flag off", async () => {
    const media = new FakeMedia();
    const { result } = renderHook(() => useAutoplay(media, 'play', false));
    act(() => media.loadstart());
    await flush();
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(media.muted).toBe(false);
    expect(result.current).toBe(false);
  });

  test("mode 'play' stays paused when blocked", async () => {
    const media = new FakeMedia();
    media.play = blockedUnlessMuted(media);
    const { result } = renderHook(() => useAutoplay(media, 'play', false));
    act(() => media.loadstart());
    await flush();
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(media.muted).toBe(false);
    expect(result.current).toBe(false);
  });

  test("mode 'any' falls back to muted playback and sets the flag", async () => {
    const media = new FakeMedia();
    media.play = blockedUnlessMuted(media);
    const { result } = renderHook(() => useAutoplay(media, 'any', false));
    act(() => media.loadstart());
    await flush();
    expect(media.play).toHaveBeenCalledTimes(2);
    expect(media.muted).toBe(true);
    expect(result.current).toBe(true);
  });

  test('the flag clears once the viewer makes playback audible', async () => {
    const media = new FakeMedia();
    media.play = blockedUnlessMuted(media);
    const { result } = renderHook(() => useAutoplay(media, 'any', false));
    act(() => media.loadstart());
    await flush();
    expect(result.current).toBe(true);
    act(() => media.setVolume(0.7, false));
    expect(result.current).toBe(false);
  });

  test('a viewer-chosen inaudible start never sets the flag', async () => {
    const media = new FakeMedia();
    media.volume = 0;
    const { result } = renderHook(() => useAutoplay(media, 'any', true));
    act(() => media.loadstart());
    await flush();
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);
  });

  test('does nothing without media', () => {
    const { result } = renderHook(() => useAutoplay(null, 'any', false));
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 3: Write the failing latency preference tests**

```ts
// web/tests/latencyPreference.test.ts
import {
  LATENCY_COMPENSATION_ENABLED,
  readLatencyPreference,
  writeLatencyPreference,
} from '../components/video/player/latencyPreference';

describe('latencyPreference', () => {
  beforeEach(() => localStorage.clear());

  test('keeps the historical storage key', () => {
    expect(LATENCY_COMPENSATION_ENABLED).toBe('latencyCompensatorEnabled');
  });

  test('defaults to off', () => {
    expect(readLatencyPreference()).toBe(false);
  });

  test('round-trips on and off', () => {
    writeLatencyPreference(true);
    expect(localStorage.getItem(LATENCY_COMPENSATION_ENABLED)).toBe('true');
    expect(readLatencyPreference()).toBe(true);
    writeLatencyPreference(false);
    expect(readLatencyPreference()).toBe(false);
  });
});
```

- [ ] **Step 4: Run both to verify they fail**

Run: `npx jest tests/useAutoplay.test.ts tests/latencyPreference.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement the hook**

```ts
// web/components/video/player/useAutoplay.ts
import { useEffect, useState } from 'react';
import type { AutoplayMode } from '../../../utils/autoplay';

// The subset of the media adapter the hook needs. HlsJsAdapter forwards
// play(), muted and volume and dispatches loadstart / volumechange.
export interface AutoplayMedia extends EventTarget {
  play(): Promise<void>;
  muted: boolean;
  volume: number;
}

// Video.js 10 only supports native autoplay, so Owncast's two string modes
// are implemented here, on the adapter's loadstart event (which fires again
// whenever the hls.js engine is rebuilt; play() on an already playing
// element is a harmless no-op).
//
// Returns true while playback is inaudible *because the player muted it*:
// the 'any' fallback, or an autoplay that started silently without the
// viewer having chosen that. It clears the moment the media becomes
// audible, so any later mute is by definition the viewer's.
export function useAutoplay(
  media: AutoplayMedia | null,
  mode: AutoplayMode,
  startsInaudible: boolean,
): boolean {
  const [mutedByAutoplay, setMutedByAutoplay] = useState(false);

  useEffect(() => {
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
      try {
        await media.play();
        if (!cancelled && !startsInaudible && inaudible()) {
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
  }, [media, mode, startsInaudible]);

  return mutedByAutoplay;
}
```

- [ ] **Step 6: Implement the preference module**

```ts
// web/components/video/player/latencyPreference.ts
import { getLocalStorage, setLocalStorage } from '../../../utils/localStorage';

// Storage key kept from the old latency compensator so an existing
// viewer's choice survives the player migration.
export const LATENCY_COMPENSATION_ENABLED = 'latencyCompensatorEnabled';

export function readLatencyPreference(): boolean {
  return getLocalStorage(LATENCY_COMPENSATION_ENABLED) === 'true';
}

export function writeLatencyPreference(enabled: boolean): void {
  setLocalStorage(LATENCY_COMPENSATION_ENABLED, enabled ? 'true' : 'false');
}
```

Check `web/utils/localStorage.ts` exports `getLocalStorage(key)` and `setLocalStorage(key, value)` (they are already used by `OwncastPlayer.tsx`). If `getLocalStorage` returns `null` when `window` is undefined, `readLatencyPreference` returns false during SSR, which is the intent.

- [ ] **Step 7: Run the tests**

Run: `npx jest tests/useAutoplay.test.ts tests/latencyPreference.test.ts tests/autoplay.test.ts && npm run typecheck`
Expected: all pass; typecheck exits 0.

- [ ] **Step 8: Do not commit.**

---

### Task 5: SettingsMenu component

**Files:**
- Create: `web/components/video/SettingsMenu/SettingsMenu.tsx`
- Create: `web/components/video/SettingsMenu/SettingsMenu.module.scss`
- Create: `web/components/video/SettingsMenu/SettingsMenu.stories.tsx`

**Interfaces:**
- Consumes: `usePlayer`, `useMedia` from Task 1; `PlayerLabels` from Task 1.
- Produces:
  ```ts
  export type SettingsMenuProps = {
    labels: PlayerLabels;
    lowLatency: boolean;
    onLowLatencyChange: (enabled: boolean) => void;
    showLatencyToggle: boolean;
    qualityNames?: Map<number, string>; // variant index -> admin name
    className?: string;
  };
  export const SettingsMenu: FC<SettingsMenuProps>;
  ```
  Renders `null` when there is nothing to show (one rendition and no latency toggle).

- [ ] **Step 1: Write the component**

```tsx
// web/components/video/SettingsMenu/SettingsMenu.tsx
import { FC, useCallback } from 'react';
import classNames from 'classnames';
import { Menu, QualityRadioGroup } from '@videojs/react';
import type { MediaVideoRendition } from '@videojs/react';
import { CheckIcon, GearIcon } from '@videojs/react/icons';
import type { HlsJsAdapter } from '@videojs/hlsjs-video';
import { useMedia, usePlayer } from '../player/createOwncastPlayer';
import { PlayerLabels } from '../player/usePlayerLabels';
import styles from './SettingsMenu.module.scss';

export type SettingsMenuProps = {
  labels: PlayerLabels;
  lowLatency: boolean;
  onLowLatencyChange: (enabled: boolean) => void;
  // Only hls.js can retune live sync; native HLS (iOS Safari) cannot.
  showLatencyToggle: boolean;
  // Admin-configured variant names keyed by Owncast variant index.
  qualityNames?: Map<number, string>;
  className?: string;
};

// Owncast variant playlists live at /hls/<variantIndex>/stream.m3u8.
const VARIANT_INDEX_PATTERN = /\/hls\/(\d+)\//;

export const SettingsMenu: FC<SettingsMenuProps> = ({
  labels,
  lowLatency,
  onLowLatencyChange,
  showLatencyToggle,
  qualityNames,
  className,
}) => {
  const renditionCount = usePlayer(state => state.videoRenditionList.length);
  const media = useMedia() as HlsJsAdapter | null;
  const showQuality = renditionCount > 1;

  // Rendition ids are hls.js level indices. The level URL carries the
  // Owncast variant index, which selects the admin's name for it.
  const formatRendition = useCallback(
    (rendition: MediaVideoRendition): string => {
      const level = media?.engine?.levels?.[Number(rendition.id)];
      const match = level?.url?.[0]?.match(VARIANT_INDEX_PATTERN);
      const name = match ? qualityNames?.get(Number(match[1])) : undefined;
      if (name) {
        return name;
      }
      if (rendition.height) {
        return `${rendition.height}p`;
      }
      return rendition.bitrate ? `${Math.round(rendition.bitrate / 1000)} kbps` : rendition.id;
    },
    [media, qualityNames],
  );

  if (!showQuality && !showLatencyToggle) {
    return null;
  }

  return (
    <Menu.Root side="top" align="end">
      <Menu.Trigger
        className={classNames(styles.trigger, 'owncast-settings-button', className)}
        aria-label={labels.settings}
      >
        <GearIcon aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Popup className={styles.popup}>
        <Menu.Content className={styles.content}>
          {showQuality && (
            <QualityRadioGroup.Root label={labels.quality} formatRendition={formatRendition}>
              <Menu.GroupLabel className={styles.groupLabel}>{labels.quality}</Menu.GroupLabel>
              <QualityRadioGroup.Options
                className={styles.group}
                renderItem={(props, item) => (
                  <Menu.RadioItem {...props} key={item.value} className={styles.item}>
                    <span>{item.label}</span>
                    <Menu.ItemIndicator className={styles.indicator}>
                      <CheckIcon aria-hidden="true" />
                    </Menu.ItemIndicator>
                  </Menu.RadioItem>
                )}
              />
            </QualityRadioGroup.Root>
          )}
          {showQuality && showLatencyToggle && <Menu.Separator className={styles.separator} />}
          {showLatencyToggle && (
            <Menu.CheckboxItem
              className={classNames(styles.item, 'owncast-latency-toggle')}
              checked={lowLatency}
              onCheckedChange={onLowLatencyChange}
              title={labels.minimizeLatencyDescription}
            >
              <span>{labels.minimizeLatency}</span>
              <span className={classNames(styles.pill, lowLatency && styles.pillOn)}>
                {lowLatency ? labels.on : labels.off}
              </span>
            </Menu.CheckboxItem>
          )}
        </Menu.Content>
      </Menu.Popup>
    </Menu.Root>
  );
};
```

If `MediaVideoRendition` is not exported from `@videojs/react` root, import it as `import type { MediaVideoRendition } from '@videojs/core';` (it is declared in `@videojs/core`'s quality feature; see the API reference section 2).

- [ ] **Step 2: Write the styles**

```scss
// web/components/video/SettingsMenu/SettingsMenu.module.scss
.trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;

  svg {
    width: 20px;
    height: 20px;
    fill: currentcolor;
  }

  &:hover,
  &:focus-visible {
    color: var(--theme-color-action);
    outline: none;
  }
}

// Menu.Popup renders with the HTML popover attribute, so the user agent
// styles for [popover] (border, padding, color) must be reset here.
.popup {
  min-width: 220px;
  padding: 6px 0;
  border: 1px solid rgb(255 255 255 / 15%);
  border-radius: var(--theme-rounded-corners);
  background: rgb(20 20 20 / 95%);
  color: var(--theme-color-components-text-on-dark);
  box-shadow: 0 6px 24px rgb(0 0 0 / 50%);
  font-size: 0.9rem;

  &[data-starting-style],
  &[data-ending-style] {
    opacity: 0;
  }

  transition: opacity 0.15s ease-in-out;
}

.content {
  display: flex;
  flex-direction: column;
  outline: none;
}

.groupLabel {
  padding: 4px 14px;
  font-size: 0.75rem;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  opacity: 0.7;
}

.group {
  display: flex;
  flex-direction: column;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;

  &[data-highlighted] {
    background: rgb(255 255 255 / 10%);
  }
}

.indicator {
  display: inline-flex;
  width: 16px;
  height: 16px;

  svg {
    width: 16px;
    height: 16px;
    fill: var(--theme-color-action);
  }
}

.separator {
  height: 1px;
  margin: 6px 14px;
  background: rgb(255 255 255 / 30%);
}

// On/off pill that makes the toggle state obvious at a glance.
.pill {
  display: inline-block;
  min-width: 34px;
  padding: 1px 8px;
  border: 1px solid #777;
  border-radius: 9px;
  color: #999;
  font-size: 0.75em;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-align: center;
}

.pillOn {
  border-color: #12b76a;
  background: #12b76a;
  color: #fff;
}
```

- [ ] **Step 3: Write the story**

```tsx
// web/components/video/SettingsMenu/SettingsMenu.stories.tsx
import { StoryFn, Meta } from '@storybook/nextjs';
import { useState } from 'react';
import { Container } from '@videojs/react';
import { SettingsMenu } from './SettingsMenu';
import { Player } from '../player/createOwncastPlayer';
import { usePlayerLabels } from '../player/usePlayerLabels';

const meta = {
  title: 'owncast/Player/Settings menu',
  component: SettingsMenu,
  parameters: {
    docs: {
      description: {
        component:
          'Gear menu inside the player control bar: quality selection (when the stream has more than one rendition) and the "Minimize latency" toggle. Without a live stream only the latency toggle renders.',
      },
    },
  },
} satisfies Meta<typeof SettingsMenu>;

export default meta;

const Template: StoryFn<typeof SettingsMenu> = args => {
  const labels = usePlayerLabels();
  const [lowLatency, setLowLatency] = useState(args.lowLatency);
  return (
    <Player>
      <Container
        style={{ position: 'relative', width: 480, height: 120, background: '#111', color: '#eee' }}
      >
        <div style={{ position: 'absolute', right: 8, bottom: 8 }}>
          <SettingsMenu
            {...args}
            labels={labels}
            lowLatency={lowLatency}
            onLowLatencyChange={setLowLatency}
          />
        </div>
      </Container>
    </Player>
  );
};

export const LatencyToggleOnly = {
  render: Template,
  args: {
    lowLatency: false,
    showLatencyToggle: true,
  },
};
```

- [ ] **Step 4: Typecheck, lint, and build the story**

Run: `npm run typecheck && npx eslint components/video/SettingsMenu && npx stylelint "components/video/SettingsMenu/*.scss" && npx prettier --check components/video/SettingsMenu`
Expected: all exit 0.

Run: `npm run build-storybook 2>&1 | tail -5`
Expected: "Storybook build completed" style success line, no errors mentioning SettingsMenu. (This takes a few minutes; run it in the background if the tool allows.)

- [ ] **Step 5: Do not commit.**

---

### Task 6: OwncastSkin component

**Files:**
- Create: `web/components/video/OwncastSkin/OwncastSkin.tsx`
- Create: `web/components/video/OwncastSkin/OwncastSkin.module.scss`
- Create: `web/components/video/OwncastSkin/OwncastSkin.stories.tsx`

**Interfaces:**
- Consumes: `usePlayer` (Task 1), `SettingsMenu` (Task 5), `PlayerLabels` (Task 1).
- Produces:
  ```ts
  export type OwncastSkinProps = {
    labels: PlayerLabels;
    mutedByAutoplay: boolean;
    onUnmute: () => void;
    lowLatency: boolean;
    onLowLatencyChange: (enabled: boolean) => void;
    showLatencyToggle: boolean;
    qualityNames?: Map<number, string>;
  };
  export const OwncastSkin: FC<OwncastSkinProps>;
  ```
  Must be rendered inside `<Player><Container>`.

- [ ] **Step 1: Write the component**

```tsx
// web/components/video/OwncastSkin/OwncastSkin.tsx
import { FC, ReactNode } from 'react';
import classNames from 'classnames';
import {
  AirPlayButton,
  BufferingIndicator,
  Controls,
  FullscreenButton,
  LiveButton,
  MuteButton,
  PiPButton,
  PlayButton,
  Tooltip,
  VolumeSlider,
} from '@videojs/react';
import {
  AirPlayEnterIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  PauseIcon,
  PipEnterIcon,
  PipExitIcon,
  PlayIcon,
  SpinnerIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeOffIcon,
} from '@videojs/react/icons';
import { usePlayer } from '../player/createOwncastPlayer';
import { PlayerLabels } from '../player/usePlayerLabels';
import { SettingsMenu } from '../SettingsMenu/SettingsMenu';
import styles from './OwncastSkin.module.scss';

export type OwncastSkinProps = {
  labels: PlayerLabels;
  mutedByAutoplay: boolean;
  onUnmute: () => void;
  lowLatency: boolean;
  onLowLatencyChange: (enabled: boolean) => void;
  showLatencyToggle: boolean;
  qualityNames?: Map<number, string>;
};

// Wraps a control bar button so its accessible label (and optional keyboard
// shortcut) shows as a tooltip on hover and focus.
const WithTooltip: FC<{ button: ReactNode; shortcut?: string }> = ({ button, shortcut }) => (
  <Tooltip.Root side="top">
    <Tooltip.Trigger render={button as React.ReactElement} />
    <Tooltip.Popup className={styles.tooltip}>
      <Tooltip.Label />
      {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
    </Tooltip.Popup>
  </Tooltip.Root>
);

// Antd's MutedFilled glyph, inlined so the overlay matches the icon family
// used by the rest of the UI.
const MutedGlyph: FC = () => (
  <svg viewBox="64 64 896 896" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M771.91 115a31.65 31.65 0 00-17.42 5.27L400 351.97H236a16 16 0 00-16 16v288.06a16 16 0 0016 16h164l354.5 231.7a31.66 31.66 0 0017.42 5.27c16.65 0 32.08-13.25 32.08-32.06V147.06c0-18.8-15.44-32.06-32.09-32.06" />
  </svg>
);

export const OwncastSkin: FC<OwncastSkinProps> = ({
  labels,
  mutedByAutoplay,
  onUnmute,
  lowLatency,
  onLowLatencyChange,
  showLatencyToggle,
  qualityNames,
}) => {
  const player = usePlayer();
  const paused = usePlayer(state => state.paused);
  const error = usePlayer(state => state.error);

  const showUnmute = mutedByAutoplay && !paused;

  return (
    <>
      {/* Big centered play button, shown whenever playback is paused. */}
      {paused && !error && (
        <button
          type="button"
          className={classNames(styles.bigPlayButton, 'owncast-big-play-button')}
          aria-label={labels.play}
          onClick={() => player.play().catch(console.error)}
        >
          <PlayIcon aria-hidden="true" />
        </button>
      )}

      {/* Full-frame unmute affordance while the player itself muted playback. */}
      {showUnmute && (
        <button
          type="button"
          className={classNames(styles.bigUnmuteButton, 'owncast-big-unmute-button')}
          aria-label={labels.unmute}
          onClick={onUnmute}
        >
          <MutedGlyph />
        </button>
      )}

      <BufferingIndicator className={styles.buffering} delay={500}>
        <SpinnerIcon aria-hidden="true" />
      </BufferingIndicator>

      {error && (
        <div className={styles.error} role="alert">
          {labels.playbackError}
        </div>
      )}

      <Controls.Root>
        <Controls.Content className={styles.controls}>
          <Tooltip.Provider delay={300}>
            <div className={styles.group}>
              <WithTooltip
                shortcut="Space"
                button={
                  <PlayButton className={styles.button}>
                    <PlayIcon className={styles.playIcon} aria-hidden="true" />
                    <PauseIcon className={styles.pauseIcon} aria-hidden="true" />
                  </PlayButton>
                }
              />
              <div className={styles.volume}>
                <WithTooltip
                  shortcut="m"
                  button={
                    <MuteButton className={classNames(styles.button, 'owncast-mute-button')}>
                      <VolumeOffIcon className={styles.volumeOff} aria-hidden="true" />
                      <VolumeLowIcon className={styles.volumeLow} aria-hidden="true" />
                      <VolumeHighIcon className={styles.volumeHigh} aria-hidden="true" />
                    </MuteButton>
                  }
                />
                <VolumeSlider.Root className={styles.slider} thumbAlignment="edge">
                  <VolumeSlider.Track className={styles.track}>
                    <VolumeSlider.Fill className={styles.fill} />
                  </VolumeSlider.Track>
                  <VolumeSlider.Thumb className={styles.thumb} />
                </VolumeSlider.Root>
              </div>
            </div>

            <div className={styles.group}>
              <LiveButton
                className={styles.live}
                render={(props, state) => (
                  <button {...props}>
                    <span className={styles.liveDot} aria-hidden="true" />
                    {state.liveEdge ? labels.live : labels.goLive}
                  </button>
                )}
              />
            </div>

            <div className={styles.group}>
              <SettingsMenu
                labels={labels}
                lowLatency={lowLatency}
                onLowLatencyChange={onLowLatencyChange}
                showLatencyToggle={showLatencyToggle}
                qualityNames={qualityNames}
              />
              <WithTooltip
                button={
                  <AirPlayButton className={styles.button}>
                    <AirPlayEnterIcon aria-hidden="true" />
                  </AirPlayButton>
                }
              />
              <WithTooltip
                shortcut="i"
                button={
                  <PiPButton className={styles.button}>
                    <PipEnterIcon className={styles.pipEnter} aria-hidden="true" />
                    <PipExitIcon className={styles.pipExit} aria-hidden="true" />
                  </PiPButton>
                }
              />
              <WithTooltip
                shortcut="f"
                button={
                  <FullscreenButton className={styles.button}>
                    <FullscreenEnterIcon className={styles.fsEnter} aria-hidden="true" />
                    <FullscreenExitIcon className={styles.fsExit} aria-hidden="true" />
                  </FullscreenButton>
                }
              />
            </div>
          </Tooltip.Provider>
        </Controls.Content>
      </Controls.Root>
    </>
  );
};
```

If TypeScript rejects `render={button as React.ReactElement}`, change `WithTooltip`'s `button` prop type to `React.ReactElement` and drop the cast; callers already pass elements.

- [ ] **Step 2: Write the styles**

```scss
// web/components/video/OwncastSkin/OwncastSkin.module.scss
@use '../../../styles/mixins' as *;

// Elements that set the HTML hidden attribute (fullscreen, PiP, AirPlay)
// must stay hidden even though .button sets display: flex.
[hidden] {
  display: none !important;
}

.controls {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 6px;
  background-color: var(--theme-color-background-main);
  color: var(--theme-color-components-text-on-light);
  transition: opacity 0.2s ease-in-out;

  &:not([data-visible]) {
    opacity: 0;
    pointer-events: none;
  }
}

.group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;

  svg {
    width: 22px;
    height: 22px;
    fill: currentcolor;
  }

  &:hover,
  &:focus-visible {
    color: var(--theme-color-action);
    outline: none;
  }
}

// Icon swapping is state driven through the data attributes each button sets.
.playIcon,
.pauseIcon,
.volumeOff,
.volumeLow,
.volumeHigh,
.pipEnter,
.pipExit,
.fsEnter,
.fsExit {
  display: none;
}

[data-paused] .playIcon,
:not([data-paused]) .pauseIcon {
  display: block;
}

[data-volume-level='off'] .volumeOff,
[data-volume-level='low'] .volumeLow,
[data-volume-level='medium'] .volumeHigh,
[data-volume-level='high'] .volumeHigh {
  display: block;
}

[data-pip] .pipExit,
:not([data-pip]) .pipEnter,
[data-fullscreen] .fsExit,
:not([data-fullscreen]) .fsEnter {
  display: block;
}

.volume {
  display: flex;
  align-items: center;

  // iOS cannot set volume programmatically; the slider hides itself.
  .slider[data-hidden] {
    display: none;
  }
}

.slider {
  position: relative;
  width: 100px;
  height: 40px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}

.track {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgb(255 255 255 / 30%);
}

.fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: calc(var(--media-slider-fill) * 1%);
  border-radius: 2px;
  background: var(--theme-color-action);
}

.thumb {
  position: absolute;
  top: 50%;
  left: calc(var(--media-slider-fill) * 1%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--theme-color-components-text-on-light);
  transform: translate(-50%, -50%);
}

.live {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: pointer;

  &[data-live-edge] {
    cursor: default;

    .liveDot {
      background: var(--theme-color-components-video-live-indicator);
    }
  }

  &:not([data-live]) {
    display: none;
  }
}

.liveDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #777;
}

.tooltip {
  // Tooltip.Popup uses the popover attribute; reset the UA styles.
  margin: 0;
  padding: 5px 10px;
  border: none;
  border-radius: 4px;
  background: rgb(20 20 20 / 90%);
  color: #fff;
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
}

.shortcut {
  margin-left: 6px;
  font-family: inherit;
  opacity: 0.7;

  &::before {
    content: '(';
  }

  &::after {
    content: ')';
  }
}

.bigPlayButton {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--theme-color-action);
  cursor: pointer;
  transform: translate(-50%, -50%);

  svg {
    width: clamp(2rem, 30vmin, 8rem);
    height: auto;
    fill: currentcolor;
    filter: drop-shadow(2px 3px 4px rgb(0 0 0 / 37%));
    transition:
      transform 0.2s ease-in-out,
      filter 0.2s ease-in-out;
  }

  &:hover svg {
    transform: scale(1.15);
    filter: drop-shadow(2px 5px 4px rgb(0 0 0 / 58%));
  }
}

// Fills the whole frame so clicking anywhere unmutes. Sits below the
// control bar so the controls stay usable.
.bigUnmuteButton {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--theme-color-action);
  cursor: pointer;

  svg {
    width: clamp(2rem, 30vmin, 9rem);
    height: auto;
    filter: drop-shadow(2px 6px 22px rgb(0 0 0 / 90%)) drop-shadow(0 2px 8px rgb(0 0 0 / 80%));
    transition:
      transform 0.2s ease-in-out,
      filter 0.2s ease-in-out;
  }

  &:hover svg {
    transform: scale(1.25);
  }
}

.buffering {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 10;
  display: none;
  color: var(--theme-color-components-text-on-light);
  transform: translate(-50%, -50%);
  pointer-events: none;

  &[data-visible] {
    display: block;
  }

  svg {
    width: 56px;
    height: 56px;
    fill: currentcolor;
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(0 0 0 / 70%);
  color: #fff;
  text-align: center;
}
```

- [ ] **Step 3: Write the story**

```tsx
// web/components/video/OwncastSkin/OwncastSkin.stories.tsx
import { StoryFn, Meta } from '@storybook/nextjs';
import { useState } from 'react';
import { Container } from '@videojs/react';
import { OwncastSkin } from './OwncastSkin';
import { Player } from '../player/createOwncastPlayer';
import { usePlayerLabels } from '../player/usePlayerLabels';

const meta = {
  title: 'owncast/Player/Skin',
  component: OwncastSkin,
  parameters: {
    docs: {
      description: {
        component:
          'The Owncast control bar and overlays built from Video.js 10 headless components. Rendered here without media, so the controls show their paused state.',
      },
    },
  },
} satisfies Meta<typeof OwncastSkin>;

export default meta;

const Template: StoryFn<typeof OwncastSkin> = args => {
  const labels = usePlayerLabels();
  const [lowLatency, setLowLatency] = useState(args.lowLatency);
  return (
    <Player>
      <Container style={{ position: 'relative', width: 640, aspectRatio: '16 / 9', background: '#000' }}>
        <OwncastSkin
          {...args}
          labels={labels}
          lowLatency={lowLatency}
          onLowLatencyChange={setLowLatency}
        />
      </Container>
    </Player>
  );
};

export const Paused = {
  render: Template,
  args: {
    mutedByAutoplay: false,
    onUnmute: () => {},
    lowLatency: false,
    showLatencyToggle: true,
  },
};

export const MutedByAutoplay = {
  render: Template,
  args: {
    ...Paused.args,
    mutedByAutoplay: true,
  },
};
```

- [ ] **Step 4: Typecheck, lint, Storybook**

Run: `npm run typecheck && npx eslint components/video/OwncastSkin && npx stylelint "components/video/OwncastSkin/*.scss" && npx prettier --check components/video/OwncastSkin`
Expected: exit 0. If stylelint flags the `:not([data-paused]) .pauseIcon` selectors under `selector-not-notation` or similar, follow its suggestion (for example `&:not([data-paused])` nested under a parent selector) rather than disabling the rule.

Run: `npm run build-storybook 2>&1 | tail -5` and confirm success.

- [ ] **Step 5: Do not commit.**

---

### Task 7: OwncastPlayer and PlayerWiring

**Files:**
- Create: `web/components/video/OwncastPlayer/PlayerWiring.tsx`
- Rewrite: `web/components/video/OwncastPlayer/OwncastPlayer.tsx`
- Modify: `web/components/video/OwncastPlayer/OwncastPlayer.module.scss`
- Modify: `web/components/video/OwncastPlayer/OwncastPlayer.stories.tsx` (description only)

**Interfaces:**
- Consumes: everything from Tasks 1 to 6; `ViewerPing` (`../viewer-ping`), `VideoPoster`, `isVideoPlayingAtom`, `clockSkewAtom`, `VideoSettingsServiceContext` (`services/video-settings-service`), `getLocalStorage`/`setLocalStorage`.
- Produces: `OwncastPlayer` with the **unchanged** props `{ source, online, initiallyMuted?, autoplay?, title, className? }`.

- [ ] **Step 1: Write PlayerWiring**

```tsx
// web/components/video/OwncastPlayer/PlayerWiring.tsx
import { FC, useEffect, useRef } from 'react';
import { useSetAtom } from 'jotai';
import { useHotkeys } from 'react-hotkeys-hook';
import type { HlsJsAdapter } from '@videojs/hlsjs-video';
import { usePlayer } from '../player/createOwncastPlayer';
import { isVideoPlayingAtom } from '../../stores/ClientConfigStore';
import { getLocalStorage, setLocalStorage } from '../../../utils/localStorage';
import ViewerPing from '../viewer-ping';
import PlaybackMetrics from '../metrics/playback';

export const PLAYER_VOLUME = 'owncast_volume';

export type PlayerWiringProps = {
  video: HTMLVideoElement | null;
  adapter: HlsJsAdapter | null;
  metrics: PlaybackMetrics;
  clockSkew: number;
  onEngineChange: (engineName: string | undefined) => void;
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
}) => {
  const player = usePlayer();
  const volume = usePlayer(state => state.volume);
  const muted = usePlayer(state => state.muted);
  const setVideoPlaying = useSetAtom(isVideoPlayingAtom);
  const pingRef = useRef<ViewerPing>(new ViewerPing());
  const volumeRestored = useRef(false);

  // Restore the persisted volume once the media is attached. A stored 0 is
  // a mute the viewer chose on an earlier visit.
  useEffect(() => {
    if (!adapter || volumeRestored.current) {
      return;
    }
    const saved = getLocalStorage(PLAYER_VOLUME);
    const parsed = saved === null ? NaN : Number(saved);
    player.setVolume(Number.isFinite(parsed) ? parsed : 1);
    volumeRestored.current = true;
  }, [adapter, player]);

  // Persist volume changes; muted is stored as 0 like the old player did.
  useEffect(() => {
    if (!volumeRestored.current) {
      return;
    }
    setLocalStorage(PLAYER_VOLUME, muted ? 0 : volume);
  }, [volume, muted]);

  // Viewer pings and the playing atom follow the media element's events.
  useEffect(() => {
    if (!video) {
      return undefined;
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

  // Metrics: bind the element, then re-bind the hls.js engine every time the
  // adapter (re)builds it. The adapter fires loadstart right after creating
  // the engine, and there is no dedicated engine-created event.
  useEffect(() => {
    if (video) {
      metrics.attachMedia(video);
    }
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
    if (player.state.paused) {
      player.play().catch(console.error);
    } else {
      player.pause();
    }
  });
  useHotkeys(
    'f',
    () => {
      if (player.state.isFullscreen) {
        player.exitFullscreen().catch(console.error);
      } else {
        player.requestFullscreen().catch(console.error);
      }
    },
    { enableOnContentEditable: false },
  );
  useHotkeys(
    'm',
    () => {
      if (player.state.muted || player.state.volume === 0) {
        player.setMuted(false);
        player.setVolume(0.7);
      } else {
        player.setVolume(0);
      }
    },
    { enableOnContentEditable: false },
  );
  useHotkeys('0', () => player.setVolume(player.state.volume + 0.1), {
    enableOnContentEditable: false,
  });
  useHotkeys('9', () => player.setVolume(player.state.volume - 0.1), {
    enableOnContentEditable: false,
  });

  return null;
};
```

- [ ] **Step 2: Rewrite OwncastPlayer**

Replace the whole file:

```tsx
// web/components/video/OwncastPlayer/OwncastPlayer.tsx
/* eslint-disable react/no-unstable-nested-components */
import { FC, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import classNames from 'classnames';
import { ErrorBoundary, getErrorMessage } from 'react-error-boundary';
import { Container, I18nProvider } from '@videojs/react';
import { HlsJsVideo } from '@videojs/react/media/hlsjs-video';
import type { HlsJsAdapter, HlsSource } from '@videojs/hlsjs-video';
import { Player } from '../player/createOwncastPlayer';
import { playerI18nOverrides, usePlayerLabels } from '../player/usePlayerLabels';
import { buildHlsConfig, LatencyProfile } from '../player/hlsConfig';
import { useAutoplay } from '../player/useAutoplay';
import { readLatencyPreference, writeLatencyPreference } from '../player/latencyPreference';
import { OwncastSkin } from '../OwncastSkin/OwncastSkin';
import { PlayerWiring, PLAYER_VOLUME } from './PlayerWiring';
import { VideoPoster } from '../VideoPoster/VideoPoster';
import PlaybackMetrics from '../metrics/playback';
import { getLocalStorage } from '../../../utils/localStorage';
import { AutoplaySetting, autoplayModeForSetting } from '../../../utils/autoplay';
import { clockSkewAtom, isVideoPlayingAtom } from '../../stores/ClientConfigStore';
import { VideoSettingsServiceContext } from '../../../services/video-settings-service';
import { ComponentError } from '../../ui/ComponentError/ComponentError';
import styles from './OwncastPlayer.module.scss';

export type OwncastPlayerProps = {
  source: string;
  online: boolean;
  initiallyMuted?: boolean;
  autoplay?: AutoplaySetting;
  title: string;
  className?: string;
};

const HLS_TYPE = 'application/vnd.apple.mpegurl';

export const OwncastPlayer: FC<OwncastPlayerProps> = ({
  source,
  online,
  initiallyMuted = false,
  autoplay = AutoplaySetting.Off,
  title,
  className,
}) => {
  const VideoSettingsService = useContext(VideoSettingsServiceContext);
  const videoPlaying = useAtomValue(isVideoPlayingAtom);
  const clockSkew = useAtomValue(clockSkewAtom);
  const labels = usePlayerLabels();

  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [adapter, setAdapter] = useState<HlsJsAdapter | null>(null);
  const [engineName, setEngineName] = useState<string | undefined>(undefined);
  const [lowLatency, setLowLatency] = useState<boolean>(() => readLatencyPreference());
  const [qualityNames, setQualityNames] = useState<Map<number, string>>(new Map());

  // One metrics session per mount; stop() on unmount sends the final report.
  const metricsRef = useRef<PlaybackMetrics | null>(null);
  if (metricsRef.current === null) {
    metricsRef.current = new PlaybackMetrics();
  }
  useEffect(() => {
    const metrics = metricsRef.current;
    return () => {
      metrics?.stop();
      metricsRef.current = null;
    };
  }, []);

  // Admin-configured names for the quality menu.
  useEffect(() => {
    let cancelled = false;
    VideoSettingsService.getVideoQualities().then(qualities => {
      if (!cancelled) {
        setQualityNames(new Map(qualities.map(quality => [quality.index, quality.name])));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [VideoSettingsService]);

  // A persisted volume of 0 is a mute the viewer chose on a previous visit.
  // Restoring it is a manual mute, not an autoplay one, so the big unmute
  // overlay stays away. Read once at render; guarded for SSR.
  const savedVolume = typeof window !== 'undefined' ? getLocalStorage(PLAYER_VOLUME) : null;
  const startedMutedByViewer = savedVolume !== null && Number(savedVolume) === 0;

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const navConnection =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      : undefined;
  const startsInaudible = initiallyMuted || startedMutedByViewer;
  const autoplayMode = autoplayModeForSetting(autoplay, {
    prefersReducedMotion,
    saveData: navConnection?.saveData === true,
    startsInaudible,
  });

  const mutedByAutoplay = useAutoplay(adapter, autoplayMode, startsInaudible);

  const latencyProfile: LatencyProfile = lowLatency ? 'low' : 'default';
  // Changing engine config rebuilds the hls.js engine, which is exactly how
  // the latency toggle takes effect. The metrics instance is stable, so the
  // config only changes with the profile.
  const hlsSource = useMemo<HlsSource>(
    () => ({
      src: source,
      type: HLS_TYPE,
      engine: {
        hlsJs: buildHlsConfig({ latencyProfile, decorator: metricsRef.current }),
      },
    }),
    [source, latencyProfile],
  );

  const handleLowLatencyChange = useCallback((enabled: boolean) => {
    writeLatencyPreference(enabled);
    setLowLatency(enabled);
  }, []);

  const handleUnmute = useCallback(() => {
    if (!adapter) {
      return;
    }
    adapter.muted = false;
    if (adapter.volume === 0) {
      const saved = parseFloat(getLocalStorage(PLAYER_VOLUME) ?? '');
      adapter.volume = saved > 0 ? saved : 0.7;
    }
  }, [adapter]);

  const i18n = useMemo(() => playerI18nOverrides(labels), [labels]);

  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <ComponentError
          componentName="OwncastPlayer"
          message={getErrorMessage(error)}
          retryFunction={resetErrorBoundary}
        />
      )}
    >
      <div className={classNames(styles.container, className)} id="player">
        {online && (
          <I18nProvider locale="en" translations={i18n}>
            <Player title={title}>
              <Container className={styles.player} aria-label={title}>
                <HlsJsVideo
                  ref={setVideo}
                  mediaRef={setAdapter}
                  className={styles.video}
                  source={hlsSource}
                  streamType="live"
                  preload="auto"
                  playsInline
                  muted={initiallyMuted}
                  fallback={null}
                />
                <OwncastSkin
                  labels={labels}
                  mutedByAutoplay={mutedByAutoplay}
                  onUnmute={handleUnmute}
                  lowLatency={lowLatency}
                  onLowLatencyChange={handleLowLatencyChange}
                  showLatencyToggle={engineName === 'hlsjs'}
                  qualityNames={qualityNames}
                />
                <PlayerWiring
                  video={video}
                  adapter={adapter}
                  metrics={metricsRef.current}
                  clockSkew={clockSkew}
                  onEngineChange={setEngineName}
                />
              </Container>
            </Player>
          </I18nProvider>
        )}
        <div className={styles.poster}>
          {!videoPlaying && (
            <VideoPoster online={online} initialSrc="/thumbnail.jpg" src="/thumbnail.jpg" />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
};
```

Notes for the implementer:
- `HlsJsVideo`'s `ref` is the `<video>` element and `mediaRef` receives the adapter; both accept callback refs, which is why `setVideo`/`setAdapter` work directly.
- If `I18nProvider` is not exported from `@videojs/react` root, import it from `@videojs/react/i18n`.
- `metricsRef.current` is non-null during render because it is created synchronously above; if TypeScript complains at the `PlayerWiring` prop, pass `metricsRef.current as PlaybackMetrics`.
- `source` and `title` are the only inputs that change at runtime; `online` toggling unmounts the whole tree, which stops pings and sends the final metrics report through `PlayerWiring` cleanup and the `metrics.stop()` effect.

- [ ] **Step 3: Update the player stylesheet**

Replace `web/components/video/OwncastPlayer/OwncastPlayer.module.scss` with:

```scss
@use '../../../styles/mixins' as *;

.container {
  display: grid;
  width: 100%;
  justify-items: center;
  height: var(--player-container-height);
  aspect-ratio: 16 / 9;

  @media (width <= 1200px) {
    height: 100%;
    max-height: var(--player-container-height);
  }

  // set height of player for tablet
  @include screen(tablet) {
    height: var(--player-container-height);
    max-height: var(--player-container-height);
  }

  .player,
  .poster {
    width: 100%;
    grid-column: 1;
    grid-row: 1;
  }
}

// The Video.js Container: fullscreen target and positioning context for the
// skin's overlays and control bar.
.player {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: #000;
  color: var(--theme-color-components-text-on-light);
  outline: none;

  // Hide the pointer while controls are hidden during playback.
  &:not([data-controls-visible]) {
    cursor: none;
  }
}

.video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
```

- [ ] **Step 4: Update the story description**

In `OwncastPlayer.stories.tsx` add to `parameters`:

```ts
  parameters: {
    docs: {
      description: {
        component:
          'The Owncast live player: Video.js 10 with the hls.js engine and the Owncast skin. Pick a stream from the controls to test real playback.',
      },
    },
  },
```

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint components/video/OwncastPlayer && npx stylelint "components/video/OwncastPlayer/*.scss" && npx prettier --check components/video/OwncastPlayer`
Expected: exit 0. `OwncastPlayer.tsx` no longer imports `video.js`, `VideoJS`, `settings-menu`, or `latencyCompensator`.

- [ ] **Step 6: Run the player in the browser**

From the repo root in one terminal: `go run main.go`. In another: `cd web && npm run dev`. Start a test stream: `./test/ocTestStream.sh` (needs ffmpeg). Open `http://localhost:3000` and verify:
1. The big play button appears; clicking it starts playback and the button disappears.
2. The control bar hides after 2 s of inactivity and reappears on mouse move.
3. Mute, volume slider, fullscreen, and picture-in-picture work; the Live indicator shows.
4. The gear menu lists renditions by their admin names (or `NNNp`) when the test stream has more than one variant, plus the "Minimize latency" toggle; toggling it flips the pill and playback continues (the engine rebuilds).
5. `http://localhost:3000/embed/video?initiallyMuted=true&autoplay=always` starts muted and shows the big unmute overlay; clicking it unmutes.
6. In the Network panel, playlist requests carry `cachebust=` and `CMCD=`; segment requests carry `CMCD=`; `POST /api/metrics/cmcd` bodies include `sta`, `mtp`, `br`, `bl`, and `ltc`.

Record anything that fails as a note in the task report; fix obvious issues in this task.

- [ ] **Step 7: Do not commit.**

---

### Task 8: Remove Video.js 8 and update the remaining references

**Files:**
- Delete: `web/components/video/VideoJS/VideoJS.tsx`, `VideoJS.scss`, `VideoJS.module.scss`, `web/components/video/latencyCompensator.js`, `web/components/video/settings-menu.ts`, `web/components/video/airplay.svg`
- Modify: `web/pages/_app.tsx`, `web/.storybook/preview.js`, `web/package.json`, `web/components/admin/AutoplaySelector.tsx`, `web/components/stores/ClientConfigStore.tsx`, `web/pages/embed/video/index.tsx`
- Modify: `test/automated/browser/cypress/e2e/online/01_online_live.cy.js`, `02_online_video_embed.cy.js`, `07_online_unmute_button.cy.js`

- [ ] **Step 1: Delete the old player modules**

```bash
git rm -q components/video/VideoJS/VideoJS.tsx components/video/VideoJS/VideoJS.scss components/video/VideoJS/VideoJS.module.scss components/video/latencyCompensator.js components/video/settings-menu.ts components/video/airplay.svg
```

(`git rm` only stages the deletion; nothing is committed.)

- [ ] **Step 2: Remove the global player styles**

In `web/pages/_app.tsx` delete these lines (the TODO comment block and both imports):

```ts
// TODO: Move this videojs sass to the player component.
// video.js core styles first so the local overrides below win the cascade.
// This used to be a require() inside VideoJS.tsx to dodge webpack's
// global-css-outside-_app rule, but Turbopack compiles that require to a
// module reference it never emits, crashing every page that loads the
// player from a small chunk graph (the /embed/video pages).
import 'video.js/dist/video-js.css';
import '../components/video/VideoJS/VideoJS.scss';
```

In `web/.storybook/preview.js` delete:

```js
// video.js core styles + local overrides, mirroring pages/_app.tsx. Without
// these the player stories render as an unstyled black rectangle.
import 'video.js/dist/video-js.css';
import '../components/video/VideoJS/VideoJS.scss';
```

- [ ] **Step 3: Remove the dependency**

Run: `npm uninstall video.js`
Expected: `package.json` no longer lists `video.js`; `package-lock.json` updated. Confirm `grep -n '"video.js"' package.json` prints nothing. Check `git diff --stat package-lock.json` is limited to the removal (if `public/mockServiceWorker.js` changed from a postinstall hook, run `git checkout -- public/mockServiceWorker.js`).

- [ ] **Step 4: Fix comments that mention video.js options**

- `web/components/admin/AutoplaySelector.tsx` line 18 area: change "what the player maps to a video.js autoplay option (off -> false," to "what the player maps to an autoplay mode (off -> false,".
- `web/components/stores/ClientConfigStore.tsx` line 89 area: change "whose video.js options are init-only" to "whose player options are init-only".
- `web/pages/embed/video/index.tsx` the comment "Wait for the config too: the player's video.js options (autoplay among them) are init-only, so it must not mount with default config values." becomes "Wait for the config too: the player's autoplay mode is decided at mount, so it must not mount with default config values."

Run `grep -rn "video.js\|videojs\|vjs-" components pages utils .storybook --include=*.ts --include=*.tsx --include=*.js --include=*.scss` and expect no matches except the new `@videojs/*` imports.

- [ ] **Step 5: Update the Cypress selectors**

In `test/automated/browser/cypress/e2e/online/01_online_live.cy.js` and `02_online_video_embed.cy.js` replace `.vjs-big-play-button` with `.owncast-big-play-button`.

In `07_online_unmute_button.cy.js` replace every `.vjs-big-play-button` with `.owncast-big-play-button`, `.vjs-mute-control` with `.owncast-mute-button`, and `.vjs-big-unmute-button` with `.owncast-big-unmute-button`. Also change the comment "Mimic a browser that blocks audible autoplay so video.js takes its muted fallback path." to "Mimic a browser that blocks audible autoplay so the player takes its muted fallback path." Keep the tab indentation those files use.

Note for the implementer: `should('not.be.visible')` passes when the element does not exist in Cypress 12+; the unmute button is now unmounted rather than hidden, which these assertions accept. If the Cypress version in `test/automated/browser/package.json` is older than 12, change those two assertions to `should('not.exist')`.

- [ ] **Step 6: Run knip and the type check**

Run: `npm run typecheck && npm run check:unused`
Expected: exit 0. If knip reports `react-hotkeys-hook` as unused, it is still used by `PlayerWiring.tsx` and `UserDropdown.tsx`; investigate rather than remove. If knip reports `components/video/player/*` exports as unused, remove only the specific unused export (for example `requestKindForContextType` is used by the tests and the builder, keep it).

- [ ] **Step 7: Do not commit.**

---

### Task 9: Full verification

**Files:** none new.

- [ ] **Step 1: Format and lint everything changed**

Run: `npm run format:changed && npm run lint:changed && npx stylelint "components/video/**/*.scss"`
Expected: exit 0. Re-run `npx prettier --check components/video tests types` afterwards; exit 0. Do not run Prettier on `i18n/**/*.json`.

- [ ] **Step 2: Run the CI-equivalent gate**

Run: `npm run check` (lint of changed files, format check, typecheck, knip, Jest, Next build). This takes several minutes; run it in the background and read the tail of the output.
Expected: every stage exits 0. Jest reports the new test files (`hlsConfig`, `useAutoplay`, `latencyPreference`, `playbackMetrics`) passing.

- [ ] **Step 3: Build Storybook**

Run: `npm run build-storybook 2>&1 | tail -5`
Expected: build succeeds with the new `owncast/Player/Skin` and `owncast/Player/Settings menu` stories.

- [ ] **Step 4: Browser smoke test**

Repeat Task 7 Step 6 against the final tree, plus:
- `?lang=de` on `http://localhost:3000` must not break the player (untranslated strings fall back to English).
- Reload with the latency toggle on: the pill shows ON on load and the hls.js config is the low profile (in DevTools console: `document.querySelector('video')` has no public handle to hls.js, so verify via Network: playlist refreshes keep working and playback rate rises briefly after a stall).

- [ ] **Step 5: Update the spec with the recorded decisions**

In `docs/superpowers/specs/2026-11-08-videojs-10-migration-design.md`:
- In "HlsJsVideo configuration", replace the latency profile paragraph with the counts-only profile (`liveSyncDurationCount` 2, `liveMaxLatencyDurationCount` 4, `maxLiveSyncPlaybackRate` 1.08; default = hls.js defaults).
- In "Hotkeys", state that shortcuts remain on `react-hotkeys-hook` calling the store, and why.
- In the metrics table, change the `ltc` row to `hls.playingDate` plus clock skew.
- In "SettingsMenu", describe the variant-name mapping through the level URL.

- [ ] **Step 6: Report**

Summarize: what passed, what was verified in the browser, and anything not verified (for example AirPlay on Safari, iOS native HLS path). Do not commit; the owner reviews the branch.

---

## Self-review against the spec

- Packages, CSS import removal, browser floor: Tasks 1, 8.
- Player tree (`Player`, `Container`, `HlsJsVideo`, skin, wiring): Task 7.
- `createOwncastPlayer`, `hlsConfig`, `useAutoplay`, labels: Tasks 1, 2, 4.
- Volume persistence, hotkeys, ping, playing atom: Task 7 (`PlayerWiring`).
- Skin controls, big play, unmute overlay, buffering, error, tooltips: Task 6.
- Settings menu, quality names, latency toggle, visibility rules: Task 5.
- Metrics data source mapping and request decoration: Tasks 2, 3.
- Latency compensator deleted, preference key kept: Tasks 4, 8.
- Tests (unit, stories, Cypress selectors, `npm run check`, Storybook build): Tasks 2 to 9.
- Spec deviations documented and written back: header section and Task 9.
