import React from 'react';

import { ComingSoonScreen } from '../src/screens/ComingSoonScreen';
import { strings } from '../src/strings';

export default function Alerts() {
  return <ComingSoonScreen featureName={strings.nav.alerts} navKey="alerts" />;
}
