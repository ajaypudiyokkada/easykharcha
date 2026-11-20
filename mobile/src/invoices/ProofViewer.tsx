import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { strings } from '../strings';
import { colours, spacing } from '../theme/tokens';
import { Body, Button } from '../ui';

const s = strings.invoice.payment;

type Props = { invoiceId: number; visible: boolean; onClose: () => void };

/** Full-screen payment proof. The photo is fetched with the login token (the endpoint is private)
 * and shown from a short-lived in-memory URL, so the token is never put in a URL. */
export function ProofViewer({ invoiceId, visible, onClose }: Props) {
  const { authedFetch, businesses } = useAuth();
  const businessId = businesses[0]?.id;
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !businessId) return;
    let cancelled = false;
    let made: string | null = null;
    setUrl(null);
    setMessage(null);
    authedFetch<Blob>(`/businesses/${businessId}/invoices/${invoiceId}/payment-proof/`, {
      responseType: 'blob',
    })
      .then((blob) => {
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch((err) => {
        if (cancelled) return;
        setMessage(
          err instanceof ApiError && err.code === 'PROOF_REMOVED'
            ? s.proofRemoved
            : s.proofLoadFailed,
        );
      });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [visible, businessId, invoiceId, authedFetch]);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.body}>
          {url
            ? React.createElement('img', {
                src: url,
                alt: s.thumbAlt,
                style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
              })
            : null}
          {message ? <Body style={styles.message}>{message}</Body> : null}
          {!url && !message ? <Body style={styles.message}>...</Body> : null}
        </View>
        <View style={styles.footer}>
          <Button label={s.close} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.text, padding: spacing.md, gap: spacing.md },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  message: { color: colours.card, textAlign: 'center' },
  footer: { width: '100%', maxWidth: 480, alignSelf: 'center' },
});
