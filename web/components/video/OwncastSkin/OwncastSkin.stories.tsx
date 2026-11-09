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
      <Container
        style={{ position: 'relative', width: 640, aspectRatio: '16 / 9', background: '#000' }}
      >
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
