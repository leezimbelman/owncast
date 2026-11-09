// web/components/video/OwncastSkin/OwncastSkin.tsx
import { FC, ReactElement } from 'react';
import classNames from 'classnames';
import {
  AirPlayButton,
  BufferingIndicator,
  Controls,
  FullscreenButton,
  Gesture,
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
const WithTooltip: FC<{ button: ReactElement; shortcut?: string }> = ({ button, shortcut }) => (
  <Tooltip.Root side="top">
    <Tooltip.Trigger render={button} />
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

      {/* Click to play/pause (mouse only, as in the packaged skin, so a touch
          tap never pauses) and double-click for fullscreen, as before. Gestures
          bind to the Container; the coordinator never claims taps on buttons
          or sliders, so the big play/unmute overlays keep their own clicks. */}
      <Gesture type="tap" action="togglePaused" pointer="mouse" />
      <Gesture type="doubletap" action="toggleFullscreen" />
    </>
  );
};
