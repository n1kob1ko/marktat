import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentToast, runToastAction, settleToast, showToast, subscribeToast, undoable, UNDO_DURATION, TOAST_DURATION } from './toast';

afterEach(() => settleToast());

describe('undoable', () => {
  it('führt die Änderung erst aus, wenn der Hinweis ohne „Rückgängig“ endet', () => {
    const commit = vi.fn();
    const undo = vi.fn();
    const id = undoable({ message: 'Suche gelöscht.', commit, undo });
    expect(currentToast()).toMatchObject({ id, message: 'Suche gelöscht.', actionLabel: 'Rückgängig', duration: UNDO_DURATION });
    expect(commit).not.toHaveBeenCalled();

    settleToast(id);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
    expect(currentToast()).toBeNull();
    // ein zweites Ende ändert nichts mehr
    settleToast(id);
    runToastAction(id);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it('nimmt die Änderung mit „Rückgängig“ zurück und führt sie dann nie aus', () => {
    const commit = vi.fn();
    const undo = vi.fn();
    const id = undoable({ message: 'Entfernt.', commit, undo });
    runToastAction(id);
    expect(undo).toHaveBeenCalledTimes(1);
    settleToast(id);
    expect(commit).not.toHaveBeenCalled();
  });

  it('schließt den alten Hinweis ab, wenn ein neuer kommt', () => {
    const first = vi.fn();
    const second = vi.fn();
    undoable({ message: 'Eins', commit: first, undo: vi.fn() });
    undoable({ message: 'Zwei', commit: second, undo: vi.fn() });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(currentToast()?.message).toBe('Zwei');
  });
});

describe('showToast', () => {
  it('zeigt einfache Hinweise ohne Knopf und meldet Änderungen', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToast(listener);
    const id = showToast({ message: 'Hat nicht geklappt.', tone: 'danger' });
    expect(currentToast()).toMatchObject({ tone: 'danger', actionLabel: undefined, duration: TOAST_DURATION });
    expect(listener).toHaveBeenCalledTimes(1);
    // ohne Knopf gibt es nichts auszulösen – und ein fremder Hinweis wird nicht beendet
    runToastAction(id);
    settleToast(id + 1);
    expect(currentToast()?.id).toBe(id);
    unsubscribe();
    settleToast();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
