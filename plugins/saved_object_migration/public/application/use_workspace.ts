import { useState, useEffect } from 'react';
import { CoreStart } from '../../../../src/core/public';

export function useWorkspace(core: CoreStart) {
  const [workspaceId, setWorkspaceId] = useState<string | undefined>();

  useEffect(() => {
    const sub = core.workspaces.currentWorkspaceId$.subscribe((id) => {
      setWorkspaceId(id || undefined);
    });
    return () => sub.unsubscribe();
  }, [core.workspaces]);

  return workspaceId;
}
