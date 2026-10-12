import React from 'react';

import { ComingSoonScreen } from '../src/screens/ComingSoonScreen';
import { strings } from '../src/strings';

// Reusing the setup wizard's own /setup/5 as an ongoing team-management screen isn't a clean fit —
// it's framed as "step 5 of 6" with wizard Next/Back navigation, not a standalone management page.
// Per Step 9's own fallback ("if that's not possible in this step, show Coming soon"), this is that
// fallback, deliberately — see docs/STATUS.md.
export default function Team() {
  return <ComingSoonScreen featureName={strings.nav.team} navKey="team" />;
}
