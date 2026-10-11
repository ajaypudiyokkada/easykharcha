import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import {
  Banner,
  Body,
  BottomActionBar,
  Button,
  Card,
  Checkbox,
  Heading,
  Icon,
  MobileField,
  Muted,
  PasswordField,
  Screen,
  Small,
  StepHeader,
  TextField,
} from '../../src/ui';
import { colours, fonts, radii, spacing } from '../../src/theme/tokens';

/**
 * Every component from Step 2, in every state, in the kit's own ordering — so the kit and the real
 * implementation can be checked side by side. Dev-only: `__DEV__` is React Native's standard flag for
 * exactly this, false in a release build, so this route renders nothing there.
 */
export default function ComponentKit() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <KitScreen />;
}

function KitScreen() {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('easy1234');
  const [checked, setChecked] = useState(false);
  const [step, setStep] = useState(3);

  return (
    <Screen
      bottomBar={
        <BottomActionBar
          primaryLabel="Save and continue"
          onPrimaryPress={() => {}}
          skipLabel="Skip for now"
          onSkipPress={() => {}}
        />
      }
    >
      <View>
        <Heading level={1}>EasyKharcha component kit</Heading>
        <Muted>Dev-only — every Step 2 component, every state.</Muted>
      </View>

      <Section
        title="1. Text"
        description="Heading levels, Body, Small, Muted — sizes from tokens.ts."
      >
        <Demo label="Heading level 1">
          <Heading level={1}>Today&rsquo;s stock</Heading>
        </Demo>
        <Demo label="Heading level 2">
          <Heading level={2}>Today&rsquo;s stock</Heading>
        </Demo>
        <Demo label="Heading level 3">
          <Heading level={3}>Today&rsquo;s stock</Heading>
        </Demo>
        <Demo label="Body">
          <Body>12 items counted. 2 still need checking.</Body>
        </Demo>
        <Demo label="Small">
          <Small>12 items counted. 2 still need checking.</Small>
        </Demo>
        <Demo label="Muted">
          <Muted>12 items counted. 2 still need checking.</Muted>
        </Demo>
      </Section>

      <Section title="2. Buttons" description="All actions are at least 52px tall.">
        <Button label="Primary action" variant="primary" onPress={() => {}} />
        <Button label="Secondary action" variant="secondary" onPress={() => {}} />
        <Button label="Text link" variant="link" onPress={() => {}} />
        <Button label="Disabled" variant="primary" disabled onPress={() => {}} />
        {/* Static, like the kit's own aria-busy="true" demo button — a gallery shows every state
            at once, not behind a click. */}
        <Button label="Loading" variant="primary" loading onPress={() => {}} />
      </Section>

      <Section title="3. Text inputs" description="Label, hint and state text stay visible.">
        <Demo label="Empty">
          <TextField
            label="Business name"
            value=""
            onChangeText={() => {}}
            placeholder="e.g. Sahana Foods"
            hint="Use the name your customers know."
          />
        </Demo>
        <Demo label="Focused (tap the field to see it live)">
          <TextField
            label="City"
            value="Bengaluru"
            onChangeText={() => {}}
            hint="Used for your business profile."
          />
        </Demo>
        <Demo label="Filled">
          <TextField label="Owner name" value="Anita Rao" onChangeText={() => {}} />
        </Demo>
        <Demo label="Error">
          <TextField
            label="GST number"
            value="ABC123"
            onChangeText={() => {}}
            error="Check this number and try again."
          />
        </Demo>
        <Demo label="Success">
          <TextField
            label="Business name"
            value="Maya Bakes"
            onChangeText={() => {}}
            success="Looks good."
          />
        </Demo>
      </Section>

      <Section title="4. Mobile number" description="India-first entry with a fixed +91 prefix.">
        <MobileField
          label="Mobile number"
          value={mobile}
          onChangeText={setMobile}
          placeholder="98765 43210"
          hint="10-digit mobile number."
        />
      </Section>

      <Section title="5. Password" description="Strength is shown with words as well as colour.">
        <PasswordField label="Create password" value={password} onChangeText={setPassword} />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Demo label="Weak">
              <PasswordField label="Password" value="abc" onChangeText={() => {}} />
            </Demo>
          </View>
          <View style={{ flex: 1 }}>
            <Demo label="Strong">
              <PasswordField label="Password" value="Easy12345!" onChangeText={() => {}} />
            </Demo>
          </View>
        </View>
      </Section>

      <Section
        title="6. Checkbox"
        description="A two-line label; the whole row is tappable at 48px."
      >
        <Checkbox
          checked={checked}
          onChange={setChecked}
          title="I agree to save this stock count."
          helpText="You can still edit it later."
        />
      </Section>

      <Section title="7. Stepper header" description="Progress stays clear without feeling heavy.">
        <StepHeader
          current={step}
          total={6}
          onBack={() => setStep((s) => Math.max(1, s - 1))}
          onSaveForLater={() => {}}
        />
        <Button
          label="Advance step (demo only)"
          variant="secondary"
          onPress={() => setStep((s) => (s % 6) + 1)}
        />
      </Section>

      <Section title="8. Banners" description="Status always includes an icon and words.">
        <Banner kind="success">Saved successfully. Your stock count is up to date.</Banner>
        <Banner kind="error">Couldn&rsquo;t save. Check your connection and try again.</Banner>
        <Banner kind="warning">2 items need attention before you finish.</Banner>
        <Banner kind="info">You can add more items later.</Banner>
      </Section>

      <Section title="9. Card" description="A simple container for everyday information.">
        <Card>
          <Heading level={3}>Today&rsquo;s stock</Heading>
          <Muted>12 items counted. 2 still need checking.</Muted>
        </Card>
      </Section>

      <Section
        title="10. Sticky bottom action"
        description="See the bar at the bottom of this screen."
      >
        <Muted>BottomActionBar is rendered once, sticky, for the whole screen — see below.</Muted>
      </Section>

      <Section
        title="11. Icons"
        description="One SVG set (lucide-react-native), never text glyphs."
      >
        <View style={{ flexDirection: 'row', gap: spacing.xl, alignItems: 'center' }}>
          <IconSample name="back" label="back" />
          <IconSample name="success" label="success" />
          <IconSample name="error" label="error" />
          <IconSample name="info" label="info" />
        </View>
      </Section>

      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: spacing.lg }}>
      <View>
        <Heading level={2}>{title}</Heading>
        <Muted>{description}</Muted>
      </View>
      <View style={{ gap: spacing.lg }}>{children}</View>
    </View>
  );
}

function Demo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        borderWidth: 2,
        borderColor: colours.mint,
        borderRadius: radii.lg,
        padding: spacing.lg,
        gap: spacing.sm,
      }}
    >
      <Small style={{ color: colours.muted, fontFamily: fonts.bodyExtraBold }}>{label}</Small>
      {children}
    </View>
  );
}

function IconSample({
  name,
  label,
}: {
  name: 'back' | 'success' | 'error' | 'info';
  label: string;
}) {
  return (
    <View style={{ alignItems: 'center', gap: spacing.xs }}>
      <Icon name={name} size={spacing.xl} />
      <Small>{label}</Small>
    </View>
  );
}
