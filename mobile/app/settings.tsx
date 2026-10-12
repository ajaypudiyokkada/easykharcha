import React from 'react';

import { ComingSoonScreen } from '../src/screens/ComingSoonScreen';
import { strings } from '../src/strings';

// Same call as /team.tsx — see that file's comment.
export default function Settings() {
  return <ComingSoonScreen featureName={strings.nav.settings} navKey="settings" />;
}
