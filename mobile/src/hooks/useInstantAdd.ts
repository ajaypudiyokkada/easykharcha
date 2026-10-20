import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';

let nextTempId = -1;

/**
 * Step 19: "Add item" (stock or sell) saves immediately, not at the end of a batch — the new item
 * shows at the top of the list the instant Add is tapped (a negative, obviously-fake temp id),
 * swapped for the real server row once the request resolves, and removed again if it fails. The
 * draft clears and refocuses on success; on failure it's left exactly as typed, so a flaky network
 * never costs anyone their typing.
 */
export function useInstantAdd<TItem extends { id: number }, TDraft>(options: {
  items: TItem[];
  setItems: (updater: (current: TItem[]) => TItem[]) => void;
  emptyDraft: TDraft;
  toOptimistic: (draft: TDraft) => TItem;
  save: (draft: TDraft) => Promise<TItem>;
}) {
  const { setItems, emptyDraft, toOptimistic, save } = options;
  const [draft, setDraftState] = useState<TDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const nameFieldRef = useRef<TextInput>(null);

  function setDraft(patch: Partial<TDraft>) {
    setDraftState((current) => ({ ...current, ...patch }));
  }

  async function add(): Promise<TItem> {
    setSaving(true);
    const tempId = nextTempId--;
    const optimistic = { ...toOptimistic(draft), id: tempId };
    setItems((current) => [optimistic, ...current]);
    try {
      const created = await save(draft);
      setItems((current) => current.map((item) => (item.id === tempId ? created : item)));
      setDraftState(emptyDraft);
      nameFieldRef.current?.focus();
      return created;
    } catch (err) {
      setItems((current) => current.filter((item) => item.id !== tempId));
      throw err;
    } finally {
      setSaving(false);
    }
  }

  return { draft, setDraft, setDraftState, saving, add, nameFieldRef };
}
