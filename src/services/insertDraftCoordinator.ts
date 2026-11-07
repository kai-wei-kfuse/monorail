import { assertQueueHealthy, isPostCommitError, readSerial } from './commit';
import type { Ctx } from './commit';
import { commitInsertDraft, explicitInsertTarget, timerStateToken, timerStateTokenInTx, validateInsertDraftAt } from './homeService';
import type { ExplicitInsertOriginal } from './homeService';

export interface InsertDraft {
  id: string;
  epoch: number;
  owner: 'main' | 'mini';
  ownerSession: string;
  at: string;
  expectedTimer: string;
  phase: 'editing' | 'committing';
  original: ExplicitInsertOriginal;
}

export interface MiniInsertDraftMirror {
  id: string;
  owner: 'main' | 'mini';
  ownerSession: string;
  at: string;
  phase: 'editing' | 'committing';
  originalTitle: string;
  isCard: boolean;
}

export interface InsertDraftCoordinator {
  current(): InsertDraft | null;
  mirror(): MiniInsertDraftMirror | null;
  onChange(listener: (draft: InsertDraft | null, invalidationMessage?: string) => void): () => void;
  begin(input: {
    owner: 'main' | 'mini';
    ownerSession: string;
    at: string;
    epoch?: number;
    expectedTimer?: string;
    entryId?: string | null;
    cardId?: string | null;
  }): Promise<InsertDraft>;
  cancel(input: { draftId: string; epoch?: number }): Promise<{ cancelled: boolean }>;
  cancelDraftByOwner(owner: 'main' | 'mini', ownerSession?: string): boolean;
  onReadySession(miniSession?: string): void;
  commit(input: {
    draftId: string;
    owner: 'main' | 'mini';
    ownerSession: string;
    epoch?: number;
    text: string;
    project?: string;
  }): Promise<string>;
  dispose(): void;
}

export function createInsertDraftCoordinator(ctx: Ctx): InsertDraftCoordinator {
  let draft: InsertDraft | null = null;
  const listeners = new Set<(draft: InsertDraft | null, invalidationMessage?: string) => void>();

  const notify = (invalidationMessage?: string) => {
    const snap = draft ? structuredClone(draft) : null;
    for (const listener of listeners) listener(snap, invalidationMessage);
  };

  const loadCurrentData = async () => {
    const snap = ctx.snapshot();
    if (snap) {
      return {
        state: snap.state,
        entries: snap.entries,
        cards: snap.cards,
        tasks: snap.tasks,
        settings: snap.settings,
      };
    }
    const [state, cardFiles, taskFiles] = await Promise.all([
      ctx.repos.state.read(),
      ctx.repos.cards.list(),
      ctx.repos.tasks.list(),
    ]);
    return {
      state,
      entries: ctx.repos.times.snapshot(),
      cards: cardFiles.map(f => f.value),
      tasks: taskFiles.map(f => f.value),
      settings: ctx.settings,
    };
  };

  const offSnapshot = ctx.onSnapshot(snapshot => {
    if (!draft) return;
    const open = snapshot.entries.find(e => e.id === snapshot.state.open_entry) ?? null;
    const card = snapshot.cards.find(c => c.id === snapshot.state.current_card) ?? null;
    const token = timerStateToken(snapshot.state, open, card);
    const orig = explicitInsertTarget({
      state: snapshot.state,
      entries: snapshot.entries,
      cards: snapshot.cards,
      tasks: snapshot.tasks,
      settings: snapshot.settings,
      at: draft.at,
    });
    if (token !== draft.expectedTimer || !orig || orig.entryId !== draft.original.entryId || orig.cardId !== draft.original.cardId) {
      draft = null;
      notify('原来的事已变化，插入未记下');
      return;
    }
    if (orig.title !== draft.original.title || JSON.stringify(orig.over) !== JSON.stringify(draft.original.over)) {
      draft = { ...draft, original: orig };
      notify();
    }
  });

  return {
    current: () => (draft ? structuredClone(draft) : null),
    mirror: () => (draft ? {
      id: draft.id,
      owner: draft.owner,
      ownerSession: draft.ownerSession,
      at: draft.at,
      phase: draft.phase,
      originalTitle: draft.original.title,
      isCard: draft.original.cardId !== null,
    } : null),
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    begin(input) {
      return readSerial(ctx, async () => {
        if (input.epoch !== undefined && input.epoch !== ctx.mainEpoch) {
          throw new Error('主窗口已重新载入，请再操作一次');
        }
        if (draft) {
          if (draft.owner === input.owner && draft.ownerSession === input.ownerSession && draft.phase === 'editing') {
            return structuredClone(draft);
          }
          throw new Error('另一窗口正在写插入事件');
        }
        const data = await loadCurrentData();
        if (input.entryId !== undefined && input.entryId !== data.state.open_entry) {
          throw new Error('已经换成别的事了');
        }
        if (input.cardId !== undefined && input.cardId !== data.state.current_card) {
          throw new Error('已经换成别的事了');
        }
        const open = data.entries.find(e => e.id === data.state.open_entry) ?? null;
        const card = data.cards.find(c => c.id === data.state.current_card) ?? null;
        const actualTimer = timerStateToken(data.state, open, card);
        if (input.expectedTimer !== undefined && input.expectedTimer !== actualTimer) {
          throw new Error('原来的事已变化，请再点一次插入事件');
        }
        const orig = explicitInsertTarget({ ...data, at: input.at });
        if (!orig) throw new Error('当前状态不能插入事件');
        validateInsertDraftAt(input.at, orig.openStartedAt, orig.paused, ctx.now());
        draft = {
          id: ctx.id(),
          epoch: ctx.mainEpoch,
          owner: input.owner,
          ownerSession: input.ownerSession,
          at: input.at,
          expectedTimer: actualTimer,
          phase: 'editing',
          original: orig,
        };
        notify();
        return structuredClone(draft);
      });
    },
    cancel(input) {
      return readSerial(ctx, async () => {
        if (input.epoch !== undefined && input.epoch !== ctx.mainEpoch) {
          throw new Error('主窗口已重新载入，请再操作一次');
        }
        if (!draft || draft.id !== input.draftId) return { cancelled: false };
        if (draft.phase === 'committing') throw new Error('正在记下这条插入事件，请稍候');
        draft = null;
        notify();
        return { cancelled: true };
      });
    },
    cancelDraftByOwner(owner, ownerSession) {
      if (!draft || draft.owner !== owner || draft.phase !== 'editing') return false;
      if (ownerSession !== undefined && draft.ownerSession !== ownerSession) return false;
      draft = null;
      notify();
      return true;
    },
    onReadySession(miniSession) {
      if (!draft || draft.owner !== 'mini' || draft.phase !== 'editing') return;
      if (miniSession === undefined || draft.ownerSession !== miniSession) {
        draft = null;
        notify();
      }
    },
    async commit(input) {
      if (input.epoch !== undefined && input.epoch !== ctx.mainEpoch) {
        throw new Error('主窗口已重新载入，请再操作一次');
      }
      if (!draft || draft.id !== input.draftId) {
        throw new Error('草稿已结束或已失效');
      }
      if (draft.owner !== input.owner || draft.ownerSession !== input.ownerSession) {
        throw new Error('另一窗口正在写插入事件');
      }
      if (draft.phase === 'committing') {
        throw new Error('正在记下这条插入事件，请勿重复提交');
      }
      const targetAt = draft.at;
      const expectedTimer = draft.expectedTimer;
      draft = { ...draft, phase: 'committing' };
      notify();
      try {
        return await commitInsertDraft(ctx, {
          at: targetAt,
          text: input.text,
          project: input.project,
          expectedTimer,
          source: { kind: 'manual', via: input.owner, ...(input.owner === 'main' ? { page: 'home' as const } : {}) },
          beforeCommit: tx => {
            if (input.epoch !== undefined && input.epoch !== ctx.mainEpoch) {
              throw new Error('主窗口已重新载入，请再操作一次');
            }
            if (!draft || draft.id !== input.draftId || draft.phase !== 'committing') {
              throw new Error('草稿已结束或已失效');
            }
            if (draft.owner !== input.owner || draft.ownerSession !== input.ownerSession) {
              throw new Error('另一窗口正在写插入事件');
            }
            if (timerStateTokenInTx(tx) !== draft.expectedTimer) {
              draft = null;
              notify('原来的事已变化，插入未记下');
              throw new Error('原来的事已变化，插入未记下');
            }
          },
          onCommitted: () => {
            // Consumed after transact and before projection/publish so the published view sees new insert + null draft atomically.
            if (draft?.id === input.draftId) {
              draft = null;
              notify();
            }
          },
        });
      } catch (error) {
        if (isPostCommitError(error)) {
          if (draft?.id === input.draftId) draft = null;
          notify();
          throw error;
        }
        try {
          assertQueueHealthy(ctx);
        } catch {
          // Journal or snapshot is blocked after a partial write; keep draft non-submittable without resetting to editing.
          throw error;
        }
        if (draft?.id === input.draftId) {
          const snap = ctx.snapshot();
          if (snap) {
            const open = snap.entries.find(e => e.id === snap.state.open_entry) ?? null;
            const card = snap.cards.find(c => c.id === snap.state.current_card) ?? null;
            const actualTimer = timerStateToken(snap.state, open, card);
            if (actualTimer !== draft.expectedTimer) {
              draft = null;
              notify('原来的事已变化，插入未记下');
              throw error;
            }
          }
          draft = { ...draft, phase: 'editing' };
          notify();
        }
        throw error;
      }
    },
    dispose() {
      offSnapshot();
      listeners.clear();
    },
  };
}
