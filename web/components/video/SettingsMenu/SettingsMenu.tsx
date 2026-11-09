import { FC, useCallback } from 'react';
import classNames from 'classnames';
import { Menu, QualityRadioGroup } from '@videojs/react';
import type { MediaVideoRendition } from '@videojs/react';
import { CheckIcon, GearIcon } from '@videojs/react/icons';
import type { HlsJsAdapter } from '@videojs/hlsjs-video';
import { useMedia, usePlayer } from '../player/createOwncastPlayer';
import { PlayerLabels } from '../player/usePlayerLabels';
import { renditionLabel } from '../player/renditionLabel';
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

  // Rendition ids are hls.js level indices; the level URL identifies the
  // Owncast variant (see renditionLabel).
  const formatRendition = useCallback(
    (rendition: MediaVideoRendition): string =>
      renditionLabel(
        rendition,
        media?.engine?.levels?.[Number(rendition.id)]?.url?.[0],
        qualityNames,
      ),
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
                  // A single child: two would reach the library as an
                  // unkeyed array and trigger React's missing-key warning.
                  <Menu.RadioItem {...props} className={styles.item}>
                    <span className={styles.itemRow}>
                      <span>{item.label}</span>
                      <Menu.ItemIndicator className={styles.indicator}>
                        <CheckIcon aria-hidden="true" />
                      </Menu.ItemIndicator>
                    </span>
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
              <span className={styles.itemRow}>
                <span>{labels.minimizeLatency}</span>
                <span className={classNames(styles.pill, lowLatency && styles.pillOn)}>
                  {lowLatency ? labels.on : labels.off}
                </span>
              </span>
            </Menu.CheckboxItem>
          )}
        </Menu.Content>
      </Menu.Popup>
    </Menu.Root>
  );
};
