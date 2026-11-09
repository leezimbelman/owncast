# Migrate the viewer player to Video.js 10

Upstream issue: https://github.com/owncast/owncast/issues/5240

## Goal

Replace the Video.js 8 player (VHS engine, imperative component API) with
Video.js 10 (`@videojs/react`, hls.js engine) while keeping every viewer-facing
behavior the player has today: live playback, manual quality selection, the
"Minimize latency" toggle, the persistent unmute overlay, AirPlay, keyboard
shortcuts, volume persistence, viewer pings, and CMCD metrics reporting to the
backend.

## Decisions

- **Engine:** `@videojs/hlsjs-video` (hls.js 1.7.3). It is the documented
  replacement for VHS and supports MPEG-TS segments, which Owncast produces.
- **Latency compensation:** delete `latencyCompensator.js`. The "Minimize
  latency" toggle maps to hls.js live-sync configuration instead.
- **UI:** build the Owncast skin from Video.js 10 headless components with the
  project's existing SCSS. Do not install the packaged skin source: it requires
  the shadcn CLI and Tailwind CSS 4.3, which this project does not use, and the
  v10 docs state that no CSS approach is required for a custom skin.
- **Metrics contract:** the CMCD v2 payload, event names, request-mode query
  decoration, and the `/api/metrics/cmcd` endpoint are unchanged. Only the
  data sources move from VHS to hls.js.
- **No PR until the author reviews.** Work lands on branch `feat/videojs-10`
  in the `leezimbelman/owncast` fork.

## Dependencies

Remove `video.js`. Add `@videojs/react@10.3.0` and
`@videojs/hlsjs-video@10.3.0`. Both require React 18 or 19; the project is on
React 18.3.1. Remove the `video.js/dist/video-js.css` and `VideoJS.scss`
imports from `web/pages/_app.tsx`; player styles become component-scoped SCSS.

Browser support floor becomes Video.js 10's: Chrome and Edge 111, Firefox 121,
Safari 16.4 (desktop and iOS).

ESLint: `@videojs/react/icons` and `@videojs/react/media/hlsjs-video` are
declared as `import/core-modules` in `web/eslint.config.mjs`. The bundled
TypeScript import resolver cannot read the package's `exports` map, so without
the declaration `import/no-unresolved` and `import/no-extraneous-dependencies`
report these subpath imports as missing.

## Architecture

```
OwncastPlayer (public component, props unchanged)
  ErrorBoundary -> ComponentError
  <Player>                       createPlayer({ features: [...liveVideoFeatures, qualityFeature] })
    <Container>                  fullscreen + activity target, Owncast SCSS sizing
      <HlsJsVideo>               src, autoPlay/muted, playsInline, source.engine.hlsJs config, mediaRef
      <OwncastSkin>              control bar + overlays (headless components + SCSS)
      <PlayerWiring>             null-rendering side effects: volume persistence,
                                 viewer ping, playing atom, metrics engine binding,
                                 hotkeys (space, f, i, m, 9, 0 via react-hotkeys-hook)
  <VideoPoster>                  unchanged
```

`OwncastPlayer` itself runs `useAutoplay` (the `'any'` / `'play'` modes) on the
media adapter and passes `mutedByAutoplay` to the skin.

Side services wired once the media attaches:

- `ViewerPing` (unchanged): start on `playing`, stop on `pause`, `ended`, and
  unmount.
- `PlaybackMetrics` (rewritten data layer): one instance per player mount,
  created in an effect rather than during render so React strict mode's
  simulated remount gets a fresh, running instance. The player waits for it,
  so the hls.js config is built with the final instance. `PlayerWiring` binds
  it to the media element and to the current hls.js engine on every adapter
  `loadstart` (the adapter fires one after each engine rebuild) and unbinds
  (`detachMedia()`, `setEngine(null)`) when the Player subtree unmounts;
  `stop()` on unmount of `OwncastPlayer` sends the final report.
- `isVideoPlayingAtom` and `clockSkewAtom` integration unchanged.

### Files

| Path | Change |
| --- | --- |
| `web/components/video/VideoJS/*` | Delete. Replaced by the player tree above. |
| `web/components/video/latencyCompensator.js` | Delete. |
| `web/components/video/settings-menu.ts` | Delete. Replaced by `SettingsMenu/`. |
| `web/components/video/OwncastPlayer/OwncastPlayer.tsx` | Rewrite around `createPlayer`, `Container`, `HlsJsVideo`. Same props. |
| `web/components/video/OwncastPlayer/OwncastPlayer.module.scss` | Keep container sizing; absorb player frame rules from the deleted `VideoJS.module.scss`. |
| `web/components/video/player/createOwncastPlayer.ts` | New. Calls `createPlayer` once at module scope and exports `Player`, `usePlayer`, `useMedia`. |
| `web/components/video/player/hlsConfig.ts` | New. Builds the hls.js config: cachebuster + CMCD `xhrSetup`, ABR tuning, and the latency profile. Pure function, unit tested. |
| `web/components/video/player/useAutoplay.ts` | New. Implements the `'any'` and `'play'` modes and exposes `mutedByAutoplay`. Unit tested. |
| `web/components/video/player/volumePersistence.ts` | New. Pure helpers for `owncast_volume` (mute stored as 0): read, save, the persist rule, and audible-playback detection. Unit tested. |
| `web/components/video/player/latencyPreference.ts` | New. Reads and writes the "Minimize latency" preference (`latencyCompensatorEnabled`). Unit tested. |
| `web/components/video/player/usePlayerLabels.ts` | New. All player strings translated with English fallbacks. Unit tested. |
| `web/components/video/OwncastPlayer/PlayerWiring.tsx` | New. Null-rendering component for volume persistence, viewer ping, playing atom, metrics engine binding, and the six hotkeys. |
| `web/eslint.config.mjs` | Declare the two `@videojs/react` subpath imports as `import/core-modules`. |
| `web/components/video/OwncastSkin/OwncastSkin.tsx` + `.module.scss` + story | New. Control bar, big play button, unmute overlay, buffering indicator, error message. |
| `web/components/video/SettingsMenu/SettingsMenu.tsx` + `.module.scss` + story | New. Quality radio group and latency toggle. |
| `web/components/video/metrics/playback.js` | Keep payload logic; replace VHS reads with hls.js reads; bind the element and engine through `attachMedia(el)` / `setEngine(hls)`. |
| `web/tests/playbackMetrics.test.ts` | Rewrite fakes for the new constructor; keep the three cases; add request decoration case. |
| `web/tests/hlsConfig.test.ts`, `web/tests/useAutoplay.test.ts`, `web/tests/latencyPreference.test.ts`, `web/tests/volumePersistence.test.ts`, `web/tests/usePlayerLabels.test.tsx` | New. |
| `web/pages/_app.tsx` | Drop the two global player style imports and the TODO comment. |
| `web/utils/autoplay.ts` | Keep the public enum and `resolveAutoplaySetting`; rename the mode type to drop the Video.js reference. |
| `web/components/admin/AutoplaySelector.tsx`, `web/components/stores/ClientConfigStore.tsx`, `web/pages/embed/video/index.tsx` | Comment-only updates where they mention video.js options. |
| `test/automated/browser/cypress/e2e/online/01_online_live.cy.js`, `02_online_video_embed.cy.js`, `07_online_unmute_button.cy.js` | Update selectors to the new class names. |
| `web/i18n/en/translation.json` | Add keys for new control labels (settings, quality, auto, minimize latency, live, go live, error message). Tab-indented edit. |

## Components

### Player store

`createOwncastPlayer.ts` calls `createPlayer({ features: [...liveVideoFeatures, qualityFeature] })`
once. Component and feature export names in this document come from the v10
docs index; the implementation plan verifies each against the installed
`@videojs/react@10.3.0` type definitions before use. `liveVideoFeatures` already includes playback, volume, fullscreen,
picture-in-picture, controls visibility, and live state; the quality feature is
added because the live bundle omits it. The module exports `Player`,
`usePlayer`, and `useMedia` for the skin and hooks.

### HlsJsVideo configuration

`hlsConfig.ts` exports `buildHlsConfig({ latencyProfile, decorator })` returning the
`source.engine.hlsJs` object:

- `xhrSetup(xhr, url)`: for `.m3u8` requests append a random `cachebust`
  query value (same behavior as today's VHS request hook). For `.m3u8` and
  `.ts` requests append the CMCD query produced by `decorator.decorateUrl(url, kind)`
  (the `PlaybackMetrics` instance).
  Open the XHR with the rewritten URL.
- ABR: `startLevel: 0` keeps today's low-initial-playlist startup. Leave
  hls.js EWMA defaults; they replace `experimentalBufferBasedABR`.
  `manifestLoadPolicy` retry count set to mirror `maxPlaylistRetries: 30`.
- Latency profile, segment counts only. Default: hls.js defaults
  (`liveSyncDurationCount` 3, `liveMaxLatencyDurationCount` Infinity,
  `maxLiveSyncPlaybackRate` 1). Low latency: `liveSyncDurationCount` 2,
  `liveMaxLatencyDurationCount` 4, `maxLiveSyncPlaybackRate` 1.08 (the old
  compensator's speed cap). hls.js rejects a config that mixes the seconds
  form (`liveSyncDuration`) with the counts form, and counts track the
  configured segment duration automatically, so there is no `LEVEL_LOADED`
  switch-over.

Changing the latency profile changes the `source.engine` object, which v10
documents as the only change that recreates the engine. The source object is
memoized so re-renders do not recreate it. When the toggle rebuilds the
engine, `OwncastPlayer` records whether playback was running at the moment of
the toggle and calls `play()` on the next adapter `loadstart` only in that
case; a paused player stays paused.

### OwncastSkin

Headless components arranged in a bottom control bar, styled with the theme
variables already used in `VideoJS.scss` (`--theme-color-components-text-on-light`,
`--theme-color-background-main`, `--theme-color-action`,
`--theme-color-components-video-live-indicator`, `--theme-rounded-corners`):

- Left: `PlayButton`, `MuteButton` + horizontal `VolumeSlider` (100px wide,
  as today).
- Center: `LiveButton` rendered with the live indicator color at the edge and
  a "Go live" label when behind.
- Right: `SettingsMenu`, `AirPlayButton` (returns null when unsupported),
  `PiPButton`, `FullscreenButton`.
- No time slider or time displays.
- Overlays inside `Container`: big centered play button shown while paused
  (class `owncast-big-play-button`), full-frame unmute overlay (class
  `owncast-big-unmute-button`) shown only while `mutedByAutoplay` is true and
  playback is inaudible, `BufferingIndicator`, and a localized error message
  when the media element reports an error.
- Every button gets a `Tooltip` whose text is the translated label plus the
  shortcut suffix, reproducing the current custom tooltip behavior.
- `Controls` handles auto-hide with user activity.
- `Gesture` bindings on the `Container`, as the Video.js 8 player had: a
  mouse click (`type="tap"`, `pointer="mouse"`) toggles play/pause and a
  double-click or double-tap (`type="doubletap"`) toggles fullscreen. The
  gesture coordinator never claims taps on buttons or sliders, so the
  overlays and the control bar keep their own clicks.

### SettingsMenu

A v10 `Menu` opened from a gear button:

- `QualityRadioGroup` with "Auto" plus one entry per rendition, labelled with
  the admin-configured variant name from `/api/video/variants`. The rendition
  id is the hls.js level index; that level's URL (`level.url[0]`) contains
  `/hls/<variantIndex>/`, and the variant index selects the name. Fallback
  labels are `<height>p`, then `<kbps> kbps`. Hidden when the stream has one
  rendition.
- Separator, then the "Minimize latency" item with the ON/OFF pill. Clicking
  it flips the stored preference (`latencyCompensatorEnabled` localStorage
  key, kept for continuity) and the engine latency profile.
- Visibility rules match today: one rendition shows only the latency item;
  several renditions show both.

### Autoplay

`useAutoplay(media, mode, startedMutedByViewer)` where `mode` comes from the
existing `autoplayModeForSetting`. `false`: nothing. `'play'`: on `loadstart`
call `play()`; on rejection stay paused. `'any'`: on `loadstart` call
`play()`; on rejection set `muted = true` and call `play()` again.

Autoplay runs at most once per player mount, on the first `loadstart`. The
adapter fires `loadstart` again whenever the engine is rebuilt (for example by
the latency toggle); that later event does not re-run autoplay, so it never
resumes a stream the viewer paused or treats the viewer's own mute as an
autoplay mute. Resuming after a rebuild is handled separately (see
"HlsJsVideo configuration").

The hook returns `mutedByAutoplay`, true when the fallback mute happened or
the player started inaudibly without a viewer-chosen mute, and cleared the
moment the player becomes audible. The "viewer chose silence" input is
`startedMutedByViewer` (a persisted viewer mute, `owncast_volume` of 0), not
the broader "starts inaudible" flag, so an embed opened with `initiallyMuted`
shows the unmute overlay. This replaces the `autoplay-success` event logic.

### Volume persistence

`PlayerWiring` restores `owncast_volume` once the media attaches and saves it
on change, using the helpers in `web/components/video/player/volumePersistence.ts`
(mute stored as 0). Audible volume changes are always saved. A mute is saved
only if the player was heard at least once during this mount, or the session
started from a persisted viewer mute. A mute imposed by the player (autoplay
fallback, `initiallyMuted` embed) is therefore never written over the viewer's
saved volume.

### Hotkeys

`PlayerWiring` registers space (toggle play), f (fullscreen), i (toggle
picture-in-picture, the shortcut the PiP tooltip advertises), m (toggle mute,
restoring 0.7 when unmuting from 0), 0 (volume +0.1), 9 (volume -0.1) with
`react-hotkeys-hook`, as before, and each handler calls the v10 player store
(and does nothing until the store has a media target). The shortcuts stay
document-level and ignore inputs and contenteditable targets, exactly as
today. v10's `useHotkey` is not used because it scopes shortcuts to the player
container, which would stop them working while focus is elsewhere on the page
(for example after clicking into chat) and so change viewer-facing behavior.

### PlaybackMetrics

Same class, same report shape, same timers. The lifecycle is now:

- `new PlaybackMetrics()` takes no arguments; `OwncastPlayer` creates one per
  mount and passes it to `buildHlsConfig` as the request decorator.
- `attachMedia(el)` binds the media element's events (re-attaching to a new
  element detaches the old one); `detachMedia()` unbinds them.
- `setEngine(hls | null)` binds the current hls.js engine, called on every
  adapter `loadstart` and with `null` on teardown.
- `decorateUrl(url, kind)` appends the request-mode CMCD query to playlist
  and segment URLs (`kind` is `'playlist'` or `'segment'`).
- `stop()` clears the event report timer, sends a terminal `ps` report when
  playback had started and has not ended, and detaches both the element and
  the engine.

Sources:

| CMCD key | Old source | New source |
| --- | --- | --- |
| `mtp` | `tech.vhs.systemBandwidth` | `hls.bandwidthEstimate` |
| `br` | `vhs.playlists.media().attributes.BANDWIDTH` | `hls.levels[hls.currentLevel].bitrate` |
| `bl` | `player.buffered()` | `mediaElement.buffered` |
| `ltc` | segment program-date-time lookup | `hls.playingDate` (program-date-time of the playing position) against `Date.now()` plus the server clock skew, with the same validity bounds |
| `pr` | `player.playbackRate()` | `mediaElement.playbackRate` |
| `df` | `tech.el().getVideoPlaybackQuality()` | `mediaElement.getVideoPlaybackQuality()` |
| `ttlb` | wrapped `videojs.Vhs.xhr` | `FRAG_LOADED` event: `frag.stats.loading.end - frag.stats.loading.start` |
| `ec` | `player.error().code` | `mediaElement.error.code` |

Events (`play`, `playing`, `pause`, `ended`, `error`, `stalled`, `waiting`,
`canplaythrough`) attach to the media element. `stop()` removes them and
detaches the `FRAG_LOADED` listener. `decorateUrl(url, kind)` adds the
request-mode keys (`ot`, `sf`, `st`, `su`, plus common keys) for `hlsConfig`.

## Error handling

- The `ErrorBoundary` around the player and `ComponentError` fallback stay.
- hls.js network errors retry per its load policies; fatal errors surface on
  the media element `error` event. The skin shows a short translated message
  and the existing offline/poster flow takes over when the stream ends.
- Metrics decoration is wrapped in try/catch so it can never block a request,
  as today.
- Storage access is guarded; playback works with localStorage blocked.

## Testing

- Unit (`npm test`): rewritten `playbackMetrics.test.ts` (three existing
  cases plus request-mode decoration), new `hlsConfig.test.ts` (cachebuster,
  CMCD query, latency profiles), new `useAutoplay.test.ts` (three modes,
  fallback mute, flag clearing).
- Storybook: `OwncastPlayer` story kept; new `OwncastSkin` and `SettingsMenu`
  stories; `npm run build-storybook` passes.
- Browser (Cypress): update the three online specs to `owncast-*` selectors.
- Gate: `cd web && npm run check` (lint, format, typecheck, knip, tests,
  build) passes. knip must not report `video.js` leftovers or unused new
  files.
- Manual: run `go run main.go`, `cd web && npm run dev`, and
  `./test/ocTestStream.sh`; verify playback, quality switching, latency
  toggle, unmute overlay, hotkeys, embed page at `/embed/video`, and that
  `/api/metrics/cmcd` receives reports with `ltc`, `mtp`, and `br`.

## Out of scope

- The Owncast Directory's lightweight player lives in another repository.
- No backend or public API changes; native clients are unaffected.
- No visual redesign beyond reproducing the current look with new markup.
