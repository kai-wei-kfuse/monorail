import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  IdeaWindowCommand,
  IdeaWindowCommittedEvent,
  IdeaWindowReply,
} from '../shared/ideaWindow';

export interface IdeaWindowOpenResult {
  label: string;
  windowSession: string;
  mainEpoch: number;
  created: boolean;
}

export interface IdeaWindowHello {
  label: string;
  windowSession: string;
  mainEpoch: number;
  kind: 'record' | 'draft';
  recordId: string | null;
  draftId: string | null;
  draftVersion: number | null;
  createOperationId: string | null;
  draftSnapshot: unknown | null;
}

export interface DraftCheckEventPayload {
  targetLabel: string;
  requestId: string;
  generation: number;
}

export interface MaintenanceCheckResultDto {
  ok: boolean;
  requestId?: string | null;
  error?: string | null;
}

export class MaintenanceCheckError extends Error {
  readonly requestId: string | null;
  constructor(message: string, requestId: string | null = null) {
    super(message);
    this.name = 'MaintenanceCheckError';
    this.requestId = typeof requestId === 'string' && requestId.trim() ? requestId.trim() : null;
  }
}

export function getOwnedCheckRequestId(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const reqId = (error as { requestId?: unknown }).requestId;
  return typeof reqId === 'string' && reqId.trim() ? reqId.trim() : null;
}

export interface DraftCheckStateTracker {
  /**
   * Validates that `payload` carries non-empty `targetLabel`, non-empty `requestId`, and a
   * positive safe integer `generation`, matches `expectedWindowLabel`, has not yet been
   * ACKed or closed by this tracker, and has a strictly newer `generation` than any
   * previously seen or closed round. Sets the active locked round to `(requestId, generation)`
   * and returns `requestId`; otherwise returns `null`.
   */
  acceptCheck(payload: unknown, expectedWindowLabel: string | null | undefined): string | null;
  /**
   * Validates that `payload` carries non-empty `targetLabel`, non-empty `requestId`, and a
   * positive safe integer `generation`, and matches `expectedWindowLabel`. If no round is
   * currently active, permanently closes `(requestId, generation)` so a delayed check for
   * that round cannot lock later. If a round is active, only unlocks when BOTH `requestId`
   * AND `generation` match the active locked round.
   */
  acceptRestore(payload: unknown, expectedWindowLabel: string | null | undefined): boolean;
  getActiveRequestId(): string | null;
}

function parsePositiveSafeInteger(val: unknown): number | null {
  if (typeof val !== 'number' || !Number.isSafeInteger(val) || val <= 0) {
    return null;
  }
  return val;
}

export function createDraftCheckTracker(): DraftCheckStateTracker {
  let activeRequestId: string | null = null;
  let activeGeneration = 0;
  let maxSeenGeneration = 0;
  let closedGeneration = 0;
  const ackedRequestIds = new Set<string>();
  const closedRequestIds = new Set<string>();
  const generationByRequestId = new Map<string, number>();
  return {
    acceptCheck(payload: unknown, expectedWindowLabel: string | null | undefined): string | null {
      if (!expectedWindowLabel) return null;
      const p = payload as Partial<DraftCheckEventPayload> | null | undefined;
      if (
        !p ||
        typeof p.targetLabel !== 'string' ||
        !p.targetLabel ||
        typeof p.requestId !== 'string' ||
        !p.requestId.trim()
      ) {
        return null;
      }
      if (p.targetLabel !== expectedWindowLabel) {
        return null;
      }
      const gen = parsePositiveSafeInteger(p.generation);
      if (gen === null) {
        return null;
      }
      const reqId = p.requestId.trim();
      if (ackedRequestIds.has(reqId) || closedRequestIds.has(reqId)) {
        return null;
      }
      if (gen <= maxSeenGeneration || gen <= closedGeneration) {
        return null;
      }
      maxSeenGeneration = gen;
      activeGeneration = gen;
      ackedRequestIds.add(reqId);
      generationByRequestId.set(reqId, gen);
      activeRequestId = reqId;
      return reqId;
    },
    acceptRestore(payload: unknown, expectedWindowLabel: string | null | undefined): boolean {
      if (!expectedWindowLabel) return false;
      const p = payload as Partial<DraftCheckEventPayload> | null | undefined;
      if (
        !p ||
        typeof p.targetLabel !== 'string' ||
        !p.targetLabel ||
        typeof p.requestId !== 'string' ||
        !p.requestId.trim()
      ) {
        return false;
      }
      if (p.targetLabel !== expectedWindowLabel) {
        return false;
      }
      const gen = parsePositiveSafeInteger(p.generation);
      if (gen === null) {
        return false;
      }
      const reqId = p.requestId.trim();
      const recordedGen = generationByRequestId.get(reqId);
      if (recordedGen !== undefined && recordedGen !== gen) {
        return false;
      }
      if (!activeRequestId) {
        if (closedRequestIds.has(reqId) || gen <= closedGeneration || gen <= maxSeenGeneration) {
          return false;
        }
        generationByRequestId.set(reqId, gen);
        closedRequestIds.add(reqId);
        closedGeneration = gen;
        return true;
      }
      if (reqId !== activeRequestId || gen !== activeGeneration) {
        if (reqId !== activeRequestId && gen < activeGeneration && recordedGen === undefined) {
          generationByRequestId.set(reqId, gen);
          closedRequestIds.add(reqId);
          if (gen > closedGeneration) {
            closedGeneration = gen;
          }
        }
        return false;
      }
      closedRequestIds.add(reqId);
      if (gen > closedGeneration) {
        closedGeneration = gen;
      }
      activeRequestId = null;
      activeGeneration = 0;
      return true;
    },
    getActiveRequestId() {
      return activeRequestId;
    },
  };
}

export interface IdeaWindowsPort {
  openIdeaWindow(recordId: string, title?: string): Promise<IdeaWindowOpenResult>;
  openIdeaDraftWindow(args: {
    draftId: string;
    draftVersion: number;
    createOperationId: string;
    title?: string;
    snapshot: unknown;
  }): Promise<IdeaWindowOpenResult>;
  hello(): Promise<IdeaWindowHello>;
  send(windowSession: string, mainEpoch: number, payload: IdeaWindowCommand): Promise<void>;
  reply(targetLabel: string, payload: IdeaWindowReply): Promise<void>;
  notifyCommitted(payload: IdeaWindowCommittedEvent): Promise<void>;
  rebindDraftWindow(draftId: string, recordId: string): Promise<void>;
  closeIdeaWindow(label?: string): Promise<void>;
  closeAllIdeaWindows(): Promise<void>;
  subscribeCommands(handler: (command: IdeaWindowCommand) => void): Promise<() => void>;
  subscribeReplies(handler: (reply: IdeaWindowReply) => void): Promise<() => void>;
  subscribeCommitted(handler: (event: IdeaWindowCommittedEvent) => void): Promise<() => void>;
  subscribeDraftHandoff(handler: (event: {
    label: string;
    windowSession: string;
    mainEpoch: number;
    draftId: string;
    draftVersion: number;
    createOperationId: string;
    snapshot: unknown;
  }) => void): Promise<() => void>;
  mainUpdateReady(): Promise<void>;
  ackDraftCheck(
    label: string,
    dirty: boolean,
    requestId: string,
    options?: { saving?: boolean; reason?: string },
  ): Promise<void>;
  beginMaintenanceCheck(): Promise<void>;
  checkDraftsForMaintenance(): Promise<string>;
  cancelMaintenanceCheck(requestId?: string): Promise<void>;
  focusDirtyWindow(): Promise<string | null>;
  performAppExit(requestId: string): Promise<void>;
}

export function getCurrentWindowLabel(): string | null {
  const w = globalThis as unknown as {
    __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
  };
  return w.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null;
}

interface RustOpenIdeaWindowResult {
  action: 'opened' | 'focused';
  windowLabel: string;
  windowSession: string;
  mainEpoch: number;
  recordId: string | null;
  draftId: string | null;
}

interface RustIdeaWindowRegistration {
  windowLabel: string;
  windowSession: string;
  mainEpoch: number;
  targetKind: 'record' | 'draft';
  recordId: string | null;
  draftId: string | null;
  draftVersion: number | null;
  createOperationId: string | null;
  initialDraft: unknown | null;
  ready: boolean;
}

interface RustIdeaDraftHandoffEvent {
  windowLabel: string;
  windowSession: string;
  mainEpoch: number;
  draftId: string;
  draftVersion: number;
  createOperationId: string;
  snapshot: unknown;
}

function mapOpenResult(raw: RustOpenIdeaWindowResult): IdeaWindowOpenResult {
  if (
    !raw ||
    typeof raw.windowLabel !== 'string' ||
    !raw.windowLabel ||
    typeof raw.windowSession !== 'string' ||
    !raw.windowSession ||
    typeof raw.mainEpoch !== 'number' ||
    (raw.action !== 'opened' && raw.action !== 'focused')
  ) {
    throw new Error('INVALID_OPEN_IDEA_WINDOW_RESULT：想法窗口打开返回结果格式无效');
  }
  return {
    label: raw.windowLabel,
    windowSession: raw.windowSession,
    mainEpoch: raw.mainEpoch,
    created: raw.action === 'opened',
  };
}

export const nativeIdeaWindows: IdeaWindowsPort = {
  openIdeaWindow: async (recordId, title) => {
    const raw = await invoke<RustOpenIdeaWindowResult>('open_idea_window', { recordId, title });
    return mapOpenResult(raw);
  },
  openIdeaDraftWindow: async args => {
    const raw = await invoke<RustOpenIdeaWindowResult>('open_idea_draft_window', args);
    return mapOpenResult(raw);
  },
  hello: async () => {
    const raw = await invoke<RustIdeaWindowRegistration>('idea_window_hello');
    if (
      !raw ||
      typeof raw.windowLabel !== 'string' ||
      !raw.windowLabel ||
      typeof raw.windowSession !== 'string' ||
      !raw.windowSession ||
      typeof raw.mainEpoch !== 'number' ||
      (raw.targetKind !== 'record' && raw.targetKind !== 'draft')
    ) {
      throw new Error('INVALID_IDEA_WINDOW_HELLO：想法窗口握手返回结果格式无效');
    }
    return {
      label: raw.windowLabel,
      windowSession: raw.windowSession,
      mainEpoch: raw.mainEpoch,
      kind: raw.targetKind,
      recordId: raw.recordId,
      draftId: raw.draftId,
      draftVersion: raw.draftVersion,
      createOperationId: raw.createOperationId,
      draftSnapshot: raw.initialDraft,
    };
  },
  send: (windowSession, mainEpoch, payload) =>
    invoke('idea_window_send', {
      windowSession,
      mainEpoch,
      payload: { ...payload, windowSession, mainEpoch },
    }),
  reply: (targetLabel, payload) => invoke('idea_window_reply', { targetLabel, payload }),
  notifyCommitted: payload => invoke('idea_window_notify_committed', { payload }),
  rebindDraftWindow: (draftId, recordId) => invoke('rebind_idea_draft_window', { draftId, recordId }),
  closeIdeaWindow: label => invoke('close_idea_window', { label }),
  closeAllIdeaWindows: () => invoke('close_all_idea_windows'),
  subscribeCommands: handler => listen<IdeaWindowCommand>('idea-window-command', event => handler(event.payload)),
  subscribeReplies: handler =>
    listen<IdeaWindowReply & { targetLabel?: string }>('idea-window-reply', event => {
      const currentLabel = getCurrentWindowLabel();
      if (currentLabel && event.payload?.targetLabel && event.payload.targetLabel !== currentLabel) {
        return;
      }
      handler(event.payload);
    }),
  subscribeCommitted: handler => listen<IdeaWindowCommittedEvent>('idea-window-committed', event => handler(event.payload)),
  subscribeDraftHandoff: handler =>
    listen<RustIdeaDraftHandoffEvent>('idea-draft-handoff', event => {
      const p = event.payload;
      if (
        !p ||
        typeof p.windowLabel !== 'string' ||
        !p.windowLabel ||
        typeof p.windowSession !== 'string' ||
        !p.windowSession ||
        typeof p.mainEpoch !== 'number' ||
        typeof p.draftId !== 'string' ||
        !p.draftId
      ) {
        throw new Error('INVALID_IDEA_DRAFT_HANDOFF：想法草稿交接事件格式无效');
      }
      handler({
        label: p.windowLabel,
        windowSession: p.windowSession,
        mainEpoch: p.mainEpoch,
        draftId: p.draftId,
        draftVersion: p.draftVersion,
        createOperationId: p.createOperationId,
        snapshot: p.snapshot,
      });
    }),
  mainUpdateReady: () => invoke('main_update_ready'),
  ackDraftCheck: (label, dirty, requestId, options) => {
    if (typeof requestId !== 'string' || !requestId.trim()) {
      return Promise.reject(new Error('MISSING_DRAFT_CHECK_REQUEST_ID：缺少草稿检查请求号'));
    }
    return invoke('ack_draft_check', {
      label,
      requestId: requestId.trim(),
      dirty,
      saving: options?.saving ?? false,
      reason: options?.reason ?? null,
    });
  },
  beginMaintenanceCheck: () => invoke('begin_maintenance_check'),
  checkDraftsForMaintenance: async () => {
    let raw: unknown;
    try {
      raw = await invoke<unknown>('check_drafts_for_maintenance');
    } catch (err) {
      const ownedId = getOwnedCheckRequestId(err);
      const msg =
        err instanceof Error
          ? err.message
          : err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
            ? (err as { message: string }).message
            : String(err);
      throw new MaintenanceCheckError(msg, ownedId);
    }
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
    if (raw && typeof raw === 'object') {
      const dto = raw as Partial<MaintenanceCheckResultDto>;
      const reqId = typeof dto.requestId === 'string' && dto.requestId.trim() ? dto.requestId.trim() : null;
      if (dto.ok === true && reqId) {
        return reqId;
      }
      if (dto.ok === false) {
        throw new MaintenanceCheckError(
          typeof dto.error === 'string' && dto.error.trim() ? dto.error : '草稿检查未通过',
          reqId,
        );
      }
    }
    throw new MaintenanceCheckError('INVALID_MAINTENANCE_CHECK_RESULT：草稿检查返回格式无效', null);
  },
  cancelMaintenanceCheck: requestId => {
    if (typeof requestId !== 'string' || !requestId.trim()) {
      return Promise.reject(new Error('MISSING_DRAFT_CHECK_RESTORE_REQUEST_ID：缺少草稿检查恢复请求号'));
    }
    return invoke('cancel_maintenance_check', {
      requestId: requestId.trim(),
    });
  },
  focusDirtyWindow: () => invoke('focus_dirty_window'),
  performAppExit: requestId => {
    if (typeof requestId !== 'string' || !requestId.trim()) {
      return Promise.reject(new Error('MISSING_EXIT_CHECK_REQUEST_ID：缺少退出草稿检查请求号'));
    }
    return invoke('perform_app_exit', {
      requestId: requestId.trim(),
    });
  },
};

async function restoreAfterMaintenanceFailure(
  error: unknown,
  requestId: string | null,
  port: Pick<IdeaWindowsPort, 'cancelMaintenanceCheck' | 'focusDirtyWindow'>,
): Promise<never> {
  const ownedId = requestId ?? getOwnedCheckRequestId(error);
  if (ownedId) {
    try {
      await port.cancelMaintenanceCheck(ownedId);
    } catch (restoreError) {
      const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
      throw new Error(`解除维护检查失败：${message}`, {
        cause: new AggregateError([error, restoreError], '维护操作失败且未能确认恢复'),
      });
    }
  }
  await port.focusDirtyWindow().catch(() => null);
  throw error;
}

export async function runAppExitWithMaintenanceCheck(
  port: Pick<
    IdeaWindowsPort,
    'checkDraftsForMaintenance' | 'performAppExit' | 'cancelMaintenanceCheck' | 'focusDirtyWindow'
  > = nativeIdeaWindows,
): Promise<void> {
  let ownedRequestId: string | null = null;
  try {
    ownedRequestId = await port.checkDraftsForMaintenance();
    await port.performAppExit(ownedRequestId);
  } catch (err) {
    return restoreAfterMaintenanceFailure(err, ownedRequestId, port);
  }
}

export async function runDirectoryChangeWithMaintenanceCheck(
  chooseRoot: () => Promise<unknown>,
  commitChange: () => Promise<void>,
  port: Pick<
    IdeaWindowsPort,
    'checkDraftsForMaintenance' | 'cancelMaintenanceCheck' | 'focusDirtyWindow' | 'closeAllIdeaWindows'
  > = nativeIdeaWindows,
): Promise<void> {
  let reqId1: string | null = null;
  try {
    reqId1 = await port.checkDraftsForMaintenance();
  } catch (err) {
    return restoreAfterMaintenanceFailure(err, reqId1, port);
  }
  await port.cancelMaintenanceCheck(reqId1);
  if (await chooseRoot()) {
    let reqId2: string | null = null;
    try {
      reqId2 = await port.checkDraftsForMaintenance();
    } catch (err) {
      return restoreAfterMaintenanceFailure(err, reqId2, port);
    }
    try {
      await port.closeAllIdeaWindows();
    } catch (err) {
      return restoreAfterMaintenanceFailure(err, reqId2, port);
    }
    await port.cancelMaintenanceCheck(reqId2);
    await commitChange();
  }
}
