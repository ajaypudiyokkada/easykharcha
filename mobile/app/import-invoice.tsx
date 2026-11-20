import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '../src/api/client';
import type { InvoiceImport } from '../src/api/invoiceImports';
import type { Invoice } from '../src/api/invoices';
import { useAuth } from '../src/auth/AuthContext';
import { can } from '../src/auth/permissions';
import { pickFiles } from '../src/forms/filePicker';
import {
  MAX_PDF_BYTES,
  resizeImageForUpload,
  validateImageType,
} from '../src/forms/menuFileValidation';
import { InvoiceBody } from '../src/invoices/InvoiceBody';
import { ReviewStage } from '../src/invoices/import/ReviewStage';
import {
  importProgressStorage,
  newProgress,
  type ImportProgress,
} from '../src/invoices/importStore';
import { businessToday } from '../src/invoices/validate';
import { strings } from '../src/strings';
import { colours, fonts, radii, spacing } from '../src/theme/tokens';
import { Body, Button, ConfirmDialog, Heading, Icon, NoAccess, Screen, Small } from '../src/ui';
import { MIN_TOUCH_TARGET } from '../src/ui/constants';

const s = strings.importInvoice;

const POLL_MS = 2000;
const SLOW_AFTER_MS = 30_000;
const TOO_LONG_AFTER_MS = 180_000;
const MAX_FILE_BYTES = MAX_PDF_BYTES;

type Stage =
  | { kind: 'loading' }
  | { kind: 'start' }
  | { kind: 'badFile'; problem: 'wrong_type' | 'too_big' }
  | { kind: 'preview'; file: File; previewUrl: string | null; isPdf: boolean }
  | { kind: 'uploading' }
  | { kind: 'reading'; imp: InvoiceImport }
  | { kind: 'failed'; code: string; reason: string }
  | { kind: 'review'; imp: InvoiceImport }
  | { kind: 'success'; invoice: Invoice };

export default function ImportInvoice() {
  const router = useRouter();
  const { status, user, businesses, authedFetch } = useAuth();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const business = businesses[0];
  const permissions = business?.permissions ?? [];
  const timezone = business?.timezone ?? 'Asia/Kolkata';
  const returnTo = params.returnTo === 'sales' ? 'sales' : 'home';
  const backPath = returnTo === 'sales' ? '/sales' : '/home';
  const hubPath = `/record-sale?returnTo=${returnTo}`;
  const manualPath = `/record-sale?returnTo=${returnTo}&open=manual`;
  const today = businessToday(timezone);

  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [stopVisible, setStopVisible] = useState(false);
  const [leaveVisible, setLeaveVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const uploadingRef = useRef(false);

  const startFresh = useCallback(() => {
    setProgress(null);
    setStage({ kind: 'start' });
  }, []);

  // Resume an import that was in flight when the page was reloaded.
  useEffect(() => {
    if (!business) return;
    let cancelled = false;
    (async () => {
      const saved = await importProgressStorage.load(business.id);
      if (!saved) {
        if (!cancelled) setStage({ kind: 'start' });
        return;
      }
      try {
        const imp = await authedFetch<InvoiceImport>(
          `/businesses/${business.id}/invoice-imports/${saved.importId}/`,
        );
        if (cancelled) return;
        if (imp.status === 'ready') {
          setProgress(saved);
          setStage({ kind: 'review', imp });
        } else if (imp.status === 'queued' || imp.status === 'reading') {
          setProgress(saved);
          setStage({ kind: 'reading', imp });
        } else {
          await importProgressStorage.clear(business.id);
          if (imp.status === 'failed') {
            setStage({ kind: 'failed', code: imp.error_code, reason: imp.error_reason });
          } else {
            setStage({ kind: 'start' });
          }
        }
      } catch {
        // Gone (404) or unreachable: start over rather than get stuck.
        await importProgressStorage.clear(business.id);
        if (!cancelled) setStage({ kind: 'start' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once per business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  // Keep the review choices on the device.
  useEffect(() => {
    if (business && progress && stage.kind === 'review') {
      void importProgressStorage.save(business.id, progress);
    }
  }, [business, progress, stage.kind]);

  // Poll while reading; stops when the screen closes or the read ends.
  const readingId = stage.kind === 'reading' ? stage.imp.id : null;
  useEffect(() => {
    if (readingId === null || !business) return;
    let stopped = false;
    const tick = async () => {
      setNow(Date.now());
      try {
        const imp = await authedFetch<InvoiceImport>(
          `/businesses/${business.id}/invoice-imports/${readingId}/`,
        );
        if (stopped) return;
        if (imp.status === 'ready') {
          setStage({ kind: 'review', imp });
        } else if (imp.status === 'failed') {
          await importProgressStorage.clear(business.id);
          setStage({ kind: 'failed', code: imp.error_code, reason: imp.error_reason });
        } else if (imp.status === 'abandoned' || imp.status === 'confirmed') {
          await importProgressStorage.clear(business.id);
          setStage({ kind: 'start' });
        }
      } catch {
        // A blip: the next tick tries again.
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [readingId, business, authedFetch]);

  async function chooseFile(camera: boolean, pdf: boolean) {
    const files = await pickFiles({
      accept: pdf ? 'application/pdf' : 'image/jpeg,image/png,image/webp',
      capture: camera ? 'environment' : undefined,
    });
    const file = files[0];
    if (!file) return;
    const isPdf = file.type === 'application/pdf';
    // The PDF button takes only a PDF; the photo buttons only JPEG, PNG or WebP.
    if (pdf ? !isPdf : validateImageType(file)) {
      setStage({ kind: 'badFile', problem: 'wrong_type' });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStage({ kind: 'badFile', problem: 'too_big' });
      return;
    }
    const previewUrl = isPdf ? null : URL.createObjectURL(file);
    setStage({ kind: 'preview', file, previewUrl, isPdf });
  }

  function dropPreview() {
    if (stage.kind === 'preview' && stage.previewUrl) URL.revokeObjectURL(stage.previewUrl);
  }

  async function upload() {
    if (stage.kind !== 'preview' || !business || uploadingRef.current) return;
    const { file, isPdf } = stage;
    uploadingRef.current = true;
    dropPreview();
    setStage({ kind: 'uploading' });
    try {
      // Photos are shrunk to about 1600px; a PDF is never touched.
      const toSend = isPdf ? file : await resizeImageForUpload(file);
      const form = new FormData();
      form.append('file', toSend, toSend.name);
      const imp = await authedFetch<InvoiceImport>(`/businesses/${business.id}/invoice-imports/`, {
        method: 'POST',
        body: form,
      });
      if (imp.status === 'failed') {
        setStage({ kind: 'failed', code: imp.error_code, reason: imp.error_reason });
        return;
      }
      const fresh = newProgress(imp.id);
      setProgress(fresh);
      await importProgressStorage.save(business.id, fresh);
      setNow(Date.now());
      setStage(imp.status === 'ready' ? { kind: 'review', imp } : { kind: 'reading', imp });
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 400 &&
        (err.code === 'FILE_TOO_LARGE' ||
          err.code === 'INVALID_FILE' ||
          err.code === 'TOO_MANY_PAGES')
      ) {
        setStage({
          kind: 'badFile',
          problem: err.code === 'FILE_TOO_LARGE' ? 'too_big' : 'wrong_type',
        });
      } else {
        setStage({ kind: 'failed', code: 'UPLOAD', reason: '' });
      }
    } finally {
      uploadingRef.current = false;
    }
  }

  async function abandon(next: 'hub' | 'start' | 'manual') {
    if (!business) return;
    setBusy(true);
    const id = stage.kind === 'reading' || stage.kind === 'review' ? stage.imp.id : null;
    if (id !== null) {
      try {
        await authedFetch(`/businesses/${business.id}/invoice-imports/${id}/`, {
          method: 'DELETE',
        });
      } catch {
        // Nothing more to do: the unconfirmed import is cleaned up on its own later.
      }
    }
    await importProgressStorage.clear(business.id);
    setBusy(false);
    setStopVisible(false);
    setLeaveVisible(false);
    if (next === 'hub') router.replace(hubPath);
    else if (next === 'manual') router.replace(manualPath);
    else startFresh();
  }

  async function finishSuccess(another: boolean) {
    if (business) await importProgressStorage.clear(business.id);
    if (another) startFresh();
    else router.replace(`${backPath}?saved=sales`);
  }

  if (status === 'bootstrapping') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.primary} />
      </View>
    );
  }
  if (status === 'signedOut' || !user) {
    return <Redirect href="/login" />;
  }
  if (!can(permissions, 'sales.create') || !business) {
    return (
      <Screen>
        <Header title={s.title} onBack={() => router.replace(hubPath)} />
        <NoAccess />
      </Screen>
    );
  }

  const elapsed = stage.kind === 'reading' ? now - Date.parse(stage.imp.created_at) : 0;

  switch (stage.kind) {
    case 'loading':
      return (
        <Screen>
          <View style={styles.center}>
            <ActivityIndicator color={colours.primary} />
            <Body style={styles.muted}>{s.opening}</Body>
          </View>
        </Screen>
      );

    case 'start':
      return (
        <Screen>
          <View style={styles.page}>
            <Header title={s.title} onBack={() => router.replace(hubPath)} />
            <Small style={styles.muted}>{s.subtitle}</Small>
            <Button label={s.takePhoto} variant="primary" onPress={() => chooseFile(true, false)} />
            <Button
              label={s.choosePhoto}
              variant="secondary"
              onPress={() => chooseFile(false, false)}
            />
            <Button
              label={s.choosePdf}
              variant="secondary"
              onPress={() => chooseFile(false, true)}
            />
            <View style={styles.card}>
              <Body style={styles.bold}>{s.tipsTitle}</Body>
              {s.tips.map((tip, index) => (
                <View key={tip} style={styles.row}>
                  <View style={styles.tipNo}>
                    <Small style={styles.tipNoText}>{index + 1}</Small>
                  </View>
                  <Small style={styles.flex}>{tip}</Small>
                </View>
              ))}
            </View>
            <Small style={styles.muted}>{s.privacyNote}</Small>
            <Button label={s.back} variant="secondary" onPress={() => router.replace(hubPath)} />
          </View>
        </Screen>
      );

    case 'badFile': {
      const copy = stage.problem === 'too_big' ? s.tooBig : s.wrongType;
      return (
        <Screen>
          <View style={styles.page}>
            <Notice icon="warning" title={copy.title} body={copy.body} />
            <Button label={copy.action} variant="primary" onPress={startFresh} />
            <Button label={s.back} variant="secondary" onPress={() => router.replace(hubPath)} />
          </View>
        </Screen>
      );
    }

    case 'preview':
      return (
        <Screen>
          <View style={styles.page}>
            <Header
              title={s.preview.title}
              onBack={() => {
                dropPreview();
                startFresh();
              }}
            />
            <Small style={styles.muted}>{s.preview.body}</Small>
            {stage.isPdf ? (
              <View style={[styles.card, styles.row]}>
                <Icon name="document" size={28} colour={colours.primary} />
                <View style={styles.flex}>
                  <Body style={styles.bold}>{stage.file.name}</Body>
                  <Small style={styles.muted}>{s.preview.pdfReady}</Small>
                </View>
              </View>
            ) : stage.previewUrl ? (
              <View style={styles.previewBox}>
                {React.createElement('img', {
                  src: stage.previewUrl,
                  alt: s.preview.alt,
                  style: { maxWidth: '100%', maxHeight: 420, objectFit: 'contain' },
                })}
              </View>
            ) : null}
            <Button
              label={stage.isPdf ? s.preview.usePdf : s.preview.use}
              variant="primary"
              onPress={upload}
            />
            <Button
              label={s.preview.retake}
              variant="secondary"
              onPress={() => {
                dropPreview();
                startFresh();
              }}
            />
          </View>
        </Screen>
      );

    case 'uploading':
      return (
        <Screen>
          <View style={styles.center}>
            <ActivityIndicator color={colours.primary} />
            <Heading level={2}>{s.uploading.title}</Heading>
            <Body style={styles.muted}>{s.uploading.body}</Body>
          </View>
        </Screen>
      );

    case 'reading': {
      const tooLong = elapsed >= TOO_LONG_AFTER_MS;
      const slow = elapsed >= SLOW_AFTER_MS;
      return (
        <Screen>
          <View style={styles.center}>
            {tooLong ? (
              <>
                <Heading level={2}>{s.tooLong.title}</Heading>
                <Body style={styles.muted}>{s.tooLong.body}</Body>
                <Button label={s.tryAgain} variant="primary" onPress={() => abandon('start')} />
                <Button
                  label={s.enterManually}
                  variant="secondary"
                  onPress={() => router.replace(manualPath)}
                />
              </>
            ) : slow ? (
              <>
                <Heading level={2}>{s.slow.title}</Heading>
                <Body style={styles.muted}>{s.slow.body}</Body>
                <Button label={s.slow.wait} variant="primary" onPress={() => setNow(Date.now())} />
                <Button
                  label={s.enterManually}
                  variant="secondary"
                  onPress={() => router.replace(manualPath)}
                />
                <Button
                  label={s.reading.cancel}
                  variant="secondary"
                  onPress={() => setStopVisible(true)}
                />
              </>
            ) : (
              <>
                <ActivityIndicator color={colours.primary} />
                <Heading level={2}>{s.reading.title}</Heading>
                <Body style={styles.muted}>{s.reading.body}</Body>
                <Button
                  label={s.reading.cancel}
                  variant="secondary"
                  onPress={() => setStopVisible(true)}
                />
              </>
            )}
          </View>
          <ConfirmDialog
            visible={stopVisible}
            title={s.stop.title}
            body={s.stop.body}
            confirmLabel={s.stop.yes}
            cancelLabel={s.stop.no}
            confirmLoading={busy}
            onConfirm={() => abandon('hub')}
            onCancel={() => setStopVisible(false)}
          />
        </Screen>
      );
    }

    case 'failed': {
      if (stage.code === 'DAILY_LIMIT') {
        return (
          <Screen>
            <View style={styles.page}>
              <Notice icon="info" title={s.dailyLimit.title} body={s.dailyLimit.body} />
              <Button
                label={s.enterManually}
                variant="primary"
                onPress={() => router.replace(manualPath)}
              />
              <Button
                label={s.dailyLimit.done}
                variant="secondary"
                onPress={() => router.replace(hubPath)}
              />
            </View>
          </Screen>
        );
      }
      if (stage.code === 'NOT_READABLE') {
        const reasons = Object.values(s.notReadable.reasons);
        const specific = s.notReadable.reasons[stage.reason];
        return (
          <Screen>
            <View style={styles.page}>
              <Notice
                icon="warning"
                title={s.notReadable.title}
                body={specific ?? s.notReadable.lead}
              />
              {specific ? <Small style={styles.muted}>{s.notReadable.lead}</Small> : null}
              <View style={styles.card}>
                {reasons.map((reason) => (
                  <Small key={reason}>• {reason}</Small>
                ))}
              </View>
              <Button label={s.notReadable.tryAnother} variant="primary" onPress={startFresh} />
              <Button
                label={s.enterManually}
                variant="secondary"
                onPress={() => router.replace(manualPath)}
              />
            </View>
          </Screen>
        );
      }
      return (
        <Screen>
          <View style={styles.page}>
            <Notice icon="warning" title={s.failed.title} body={s.failed.body} />
            <Button label={s.tryAgain} variant="primary" onPress={startFresh} />
            <Button
              label={s.enterManually}
              variant="secondary"
              onPress={() => router.replace(manualPath)}
            />
          </View>
        </Screen>
      );
    }

    case 'review':
      return (
        <Screen>
          {progress ? (
            <ReviewStage
              imp={stage.imp}
              businessId={business.id}
              today={today}
              progress={progress}
              onProgress={setProgress}
              onConfirmed={(invoice) => {
                void importProgressStorage.clear(business.id);
                setStage({ kind: 'success', invoice });
              }}
              onManual={() => abandon('manual')}
              onBack={() => setLeaveVisible(true)}
            />
          ) : null}
          <ConfirmDialog
            visible={leaveVisible}
            title={s.review.leaveTitle}
            body={s.review.leaveBody}
            confirmLabel={s.review.leaveDelete}
            cancelLabel={s.review.leaveKeep}
            confirmLoading={busy}
            onConfirm={() => abandon('hub')}
            onCancel={() => {
              setLeaveVisible(false);
              router.replace(hubPath);
            }}
          />
        </Screen>
      );

    case 'success': {
      const invoice = stage.invoice;
      const notRecorded = invoice.lines_total - invoice.lines_recorded;
      const partly = invoice.partly_recorded;
      return (
        <Screen>
          <View style={styles.page}>
            <View style={styles.successIcon}>
              <Icon name="success" size={32} colour={colours.card} />
            </View>
            <Heading level={2}>{partly ? s.success.titlePartly : s.success.title}</Heading>
            <Body style={styles.muted}>{partly ? s.success.bodyPartly : s.success.body}</Body>
            <View style={styles.row}>
              <View style={styles.badge}>
                <Small style={styles.badgeText}>{s.success.fromBill}</Small>
              </View>
              {partly ? (
                <View style={[styles.badge, styles.badgeWarn]}>
                  <Small style={styles.badgeWarnText}>{s.success.partly}</Small>
                </View>
              ) : null}
            </View>
            {partly ? (
              <Small style={styles.muted}>{s.success.notRecorded(notRecorded)}</Small>
            ) : null}
            <InvoiceBody invoice={invoice} />
            <Button label={s.success.done} variant="primary" onPress={() => finishSuccess(false)} />
            <Button
              label={s.success.another}
              variant="secondary"
              onPress={() => finishSuccess(true)}
            />
          </View>
        </Screen>
      );
    }
  }
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={styles.backBtn}
      >
        <Icon name="back" size={22} colour={colours.text} />
      </Pressable>
      <View style={styles.flex}>
        <Heading level={2}>{title}</Heading>
      </View>
    </View>
  );
}

function Notice({ icon, title, body }: { icon: 'warning' | 'info'; title: string; body: string }) {
  return (
    <View style={styles.notice}>
      <View style={styles.noticeIcon}>
        <Icon name={icon} size={28} colour={colours.warning} />
      </View>
      <Heading level={2}>{title}</Heading>
      <Body style={styles.muted}>{body}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.background,
  },
  page: { gap: spacing.md },
  center: { gap: spacing.md, alignItems: 'stretch', paddingVertical: spacing.xl },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  muted: { color: colours.muted },
  bold: { fontFamily: fonts.bodyExtraBold },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  backBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  card: {
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colours.card,
  },
  tipNo: {
    width: 24,
    height: 24,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipNoText: { color: colours.primary, fontFamily: fonts.bodyExtraBold },
  previewBox: {
    alignItems: 'center',
    padding: spacing.sm,
    borderWidth: 2,
    borderColor: colours.mint,
    borderRadius: radii.lg,
    backgroundColor: colours.card,
  },
  notice: { alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.md },
  noticeIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: colours.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colours.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colours.mint,
  },
  badgeText: { color: colours.primary, fontFamily: fonts.bodyExtraBold },
  badgeWarn: { backgroundColor: colours.background, borderWidth: 1, borderColor: colours.warning },
  badgeWarnText: { color: colours.warning, fontFamily: fonts.bodyExtraBold },
});
