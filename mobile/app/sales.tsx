import React from 'react';

import { ComingSoonScreen } from '../src/screens/ComingSoonScreen';
import { strings } from '../src/strings';

export default function Sales() {
  return <ComingSoonScreen featureName={strings.nav.sales} navKey="sales" />;
}
