import { useEffect, useMemo, useState } from 'react';
import { nativeUpdates } from '../platform/updater';
import type { UpdatesPort } from '../platform/updater';
import type { UpdateState } from '../shared/updates';
import type { Ctx } from '../services/commit';
import { createUpdateController } from '../services/updateController';

export function useUpdates(ctx: Ctx, updater: UpdatesPort = nativeUpdates) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const controller = useMemo(() => createUpdateController({ ctx, updater, publish: setState, connectionError: setConnectionError }), [ctx, updater]);
  useEffect(() => {
    void controller.connect().catch(error => setConnectionError(String(error)));
    return () => controller.dispose();
  }, [controller]);
  return { state, connectionError, check: controller.check, download: controller.download, install: controller.install,
    reconnect: () => controller.connect().catch(error => setConnectionError(String(error))) };
}
