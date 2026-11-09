import { createPlayer, liveVideoFeatures, qualityFeature } from '@videojs/react';

// One store definition for the whole app. liveVideoFeatures deliberately
// omits quality selection, so it is added back: Owncast streams several
// renditions and the settings menu lets viewers pick one.
export const { Player, usePlayer, useMedia } = createPlayer({
  features: [...liveVideoFeatures, qualityFeature],
  displayName: 'OwncastPlayer',
});
