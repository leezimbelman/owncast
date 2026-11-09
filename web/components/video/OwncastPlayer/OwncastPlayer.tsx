import { FC, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import classNames from 'classnames';
import { ErrorBoundary, getErrorMessage } from 'react-error-boundary';
import { useSelectedLanguage } from 'next-export-i18n';
import { Container, I18nProvider } from '@videojs/react';
import { HlsJsVideo } from '@videojs/react/media/hlsjs-video';
import type { HlsJsAdapter, HlsSource } from '@videojs/hlsjs-video';
import { Player } from '../player/createOwncastPlayer';
import { playerI18nOverrides, usePlayerLabels } from '../player/usePlayerLabels';
import { buildHlsConfig, LatencyProfile } from '../player/hlsConfig';
import { useAutoplay } from '../player/useAutoplay';
import { readSavedVolume } from '../player/volumePersistence';
import { readLatencyPreference, writeLatencyPreference } from '../player/latencyPreference';
import { OwncastSkin } from '../OwncastSkin/OwncastSkin';
import { PlayerWiring } from './PlayerWiring';
import { VideoPoster } from '../VideoPoster/VideoPoster';
import PlaybackMetrics from '../metrics/playback';
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
  // The player's built-in strings and lang/dir follow Owncast's language.
  const { lang } = useSelectedLanguage();

  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [adapter, setAdapter] = useState<HlsJsAdapter | null>(null);
  const [engineName, setEngineName] = useState<string | undefined>(undefined);
  const [lowLatency, setLowLatency] = useState<boolean>(() => readLatencyPreference());
  const [qualityNames, setQualityNames] = useState<Map<number, string>>(new Map());

  // One metrics session per mount; stop() on unmount sends the final report.
  // Created in an effect rather than during render so React strict mode's
  // simulated remount gets a fresh, running instance instead of the stopped
  // one. The player waits for it, so the hls.js config is only ever built
  // with the final instance and the engine is not rebuilt at startup.
  const [metrics, setMetrics] = useState<PlaybackMetrics | null>(null);
  useEffect(() => {
    const instance = new PlaybackMetrics();
    setMetrics(instance);
    return () => {
      instance.stop();
    };
  }, []);

  // Admin-configured names for the quality menu.
  useEffect(() => {
    let cancelled = false;
    VideoSettingsService.getVideoQualities()
      .then(qualities => {
        if (!cancelled) {
          setQualityNames(new Map(qualities.map(quality => [quality.index, quality.name])));
        }
      })
      .catch(() => {
        // The service logs its own errors.
      });
    return () => {
      cancelled = true;
    };
  }, [VideoSettingsService]);

  // A persisted volume of 0 is a mute the viewer chose on a previous visit.
  // Restoring it is a manual mute, not an autoplay one, so the big unmute
  // overlay stays away. Read once at mount: the wiring persists the volume
  // as it changes, and autoplay inputs must stay stable for the session.
  const [startedMutedByViewer] = useState<boolean>(() => readSavedVolume() === 0);
  const startsInaudible = initiallyMuted || startedMutedByViewer;

  const autoplayMode = useMemo(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const navConnection =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
        : undefined;
    return autoplayModeForSetting(autoplay, {
      prefersReducedMotion,
      saveData: navConnection?.saveData === true,
      startsInaudible,
    });
  }, [autoplay, startsInaudible]);

  // Only the viewer's own earlier mute suppresses the unmute overlay. An
  // embed's initiallyMuted is the embedder's choice, so the viewer still
  // gets the big unmute affordance, as with the Video.js 8 player.
  const mutedByAutoplay = useAutoplay(adapter, autoplayMode, startedMutedByViewer);

  const latencyProfile: LatencyProfile = lowLatency ? 'low' : 'default';
  // Changing engine config rebuilds the hls.js engine, which is exactly how
  // the latency toggle takes effect. The metrics instance is stable once
  // created, so the config only changes with the profile.
  const hlsSource = useMemo<HlsSource>(
    () => ({
      src: source,
      type: HLS_TYPE,
      engine: {
        hlsJs: buildHlsConfig({ latencyProfile, decorator: metrics }),
      },
    }),
    [source, latencyProfile, metrics],
  );

  // The engine rebuild swaps in a new MediaSource, which leaves the element
  // paused. Resume after the rebuild when the viewer was watching, so the
  // toggle does not stop playback. useAutoplay deliberately ignores later
  // loadstarts, so this is the only place that restarts it.
  // If that resume is rejected, bumping resumeFailedSignal tells
  // PlayerWiring, which owns the viewer pings and the playing atom, to stop
  // them.
  const resumeAfterRebuild = useRef(false);
  const [resumeFailedSignal, setResumeFailedSignal] = useState(0);
  useEffect(() => {
    if (!adapter) {
      return undefined;
    }
    const resume = () => {
      if (resumeAfterRebuild.current) {
        resumeAfterRebuild.current = false;
        adapter.play().catch(error => {
          console.error(error);
          setResumeFailedSignal(count => count + 1);
        });
      }
    };
    adapter.addEventListener('loadstart', resume);
    return () => adapter.removeEventListener('loadstart', resume);
  }, [adapter]);

  const handleLowLatencyChange = useCallback(
    (enabled: boolean) => {
      resumeAfterRebuild.current = adapter !== null && !adapter.paused;
      writeLatencyPreference(enabled);
      setLowLatency(enabled);
    },
    [adapter],
  );

  const handleUnmute = useCallback(() => {
    if (!adapter) {
      return;
    }
    adapter.muted = false;
    if (adapter.volume === 0) {
      const saved = readSavedVolume();
      adapter.volume = saved !== null && saved > 0 ? saved : 0.7;
    }
  }, [adapter]);

  const i18n = useMemo(() => playerI18nOverrides(labels), [labels]);

  return (
    <ErrorBoundary
      // eslint-disable-next-line react/no-unstable-nested-components
      fallbackRender={({ error, resetErrorBoundary }) => (
        <ComponentError
          componentName="OwncastPlayer"
          message={getErrorMessage(error)}
          retryFunction={resetErrorBoundary}
        />
      )}
    >
      <div className={classNames(styles.container, className)} id="player">
        {online && metrics && (
          <I18nProvider locale={lang || 'en'} translations={i18n}>
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
                  metrics={metrics}
                  clockSkew={Number(clockSkew)}
                  onEngineChange={setEngineName}
                  startedMutedByViewer={startedMutedByViewer}
                  resumeFailedSignal={resumeFailedSignal}
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
