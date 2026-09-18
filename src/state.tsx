import { createContext, useContext, type ReactNode } from 'react';
import type { Membership } from './domain';
export interface WorkspaceContext {
  membership: Membership;
  zone: string;
  revision: number;
  refresh: () => void;
  selectPatient: (id: string) => void;
  openConsult: () => void;
  setDirty: (dirty: boolean) => void;
  online: boolean;
  isDirty: boolean;
}
const Context = createContext<WorkspaceContext | null>(null);
export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceContext;
  children: ReactNode;
}) {
  return <Context value={value}>{children}</Context>;
}
export function useWorkspace() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('Workspace required');
  return ctx;
}
