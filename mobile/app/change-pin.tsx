import { router } from 'expo-router';
import React, { useState } from 'react';

import { post } from '../src/api/client';
import { useSession } from '../src/state/session';
import { Body, Button, Card, ErrorNotice, Field, Notice, Screen, Title } from '../src/ui';

export default function ChangePin() {
  const { user, refreshSession } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await post('/auth/change-pin', { current_pin: current, new_pin: next });
      await refreshSession();
      setDone(true);
      router.replace('/');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Change PIN</Title>
      {user?.must_change_pin ? (
        <Notice tone="warning">
          You are using the starting PIN your Owner set. Choose your own before you carry on.
        </Notice>
      ) : null}

      <Card>
        <Field label="Current PIN" value={current} onChangeText={setCurrent} keyboardType="number-pad" secureTextEntry maxLength={8} />
        <Field label="New PIN" value={next} onChangeText={setNext} keyboardType="number-pad" secureTextEntry maxLength={8} />
        <Field label="Confirm new PIN" value={confirm} onChangeText={setConfirm} keyboardType="number-pad" secureTextEntry maxLength={8} />
        {mismatch ? <Notice tone="danger">The two new PINs do not match.</Notice> : null}
        <ErrorNotice error={error} />
        <Button
          label={done ? 'Saved' : 'Save new PIN'}
          onPress={submit}
          busy={busy}
          disabled={!current || !next || mismatch}
        />
      </Card>
      <Body muted>Your PIN is stored hashed. Nobody — including an Owner — can read it back.</Body>
    </Screen>
  );
}
