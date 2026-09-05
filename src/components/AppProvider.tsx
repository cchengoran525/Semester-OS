import { createContext, useContext, type ReactNode } from 'react';
import { useAppData, type AppData } from '../hooks/useData';

const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const data = useAppData();
  return <AppDataContext.Provider value={data}>{children}</AppDataContext.Provider>;
}

export function useApp(): AppData {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useApp must be used within AppDataProvider');
  return ctx;
}
