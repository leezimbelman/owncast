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
