import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { strings } from '../strings';
import { colours, spacing } from '../theme/tokens';
import { Body, Button } from '../ui';

const s = strings.importInvoice.review;
const closeLabel = strings.invoice.payment.close;

export type PhotoState = 'off' | 'loading' | 'ready' | 'removed' | 'error';

/** Fetches a private photo WITH the login token and hands back a short-lived in-memory URL (so the
 * token never goes into a URL). `path` null turns it off (e.g. a PDF import has no photo). */
export function usePhotoUrl(path: string | null): { url: string | null; state: PhotoState } {
  const { authedFetch } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<PhotoState>(path ? 'loading' : 'off');

  useEffect(() => {
    if (!path) {
      setUrl(null);
      setState('off');
      return;
    }
    let cancelled = false;
    let made: string | null = null;
    setState('loading');
    authedFetch<Blob>(path, { responseType: 'blob' })
      .then((blob) => {
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setUrl(null);
        setState(
          err instanceof ApiError && (err.code === 'PHOTO_REMOVED' || err.code === 'NO_PHOTO')
            ? 'removed'
            : 'error',
        );
      });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path, authedFetch]);

  return { url, state };
}

/** Full-screen viewer for an already-fetched photo URL. */
export function PhotoModal({
  url,
  visible,
  onClose,
}: {
  url: string | null;
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.body}>
          {url
            ? React.createElement('img', {
                src: url,
                alt: s.photoViewerTitle,
                style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
              })
            : null}
        </View>
        <Body style={styles.note}>{s.photoViewerNote}</Body>
        <View style={styles.footer}>
          <Button label={closeLabel} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.text, padding: spacing.md, gap: spacing.md },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  note: { color: colours.card, textAlign: 'center' },
  footer: { width: '100%', maxWidth: 480, alignSelf: 'center' },
});
