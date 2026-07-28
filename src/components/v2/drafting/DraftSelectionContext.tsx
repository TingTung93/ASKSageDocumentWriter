import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  validateDraftSelection,
  type DraftSelection,
  type DraftSelectionScope,
} from './selection';

export type DraftSelectionOrigin = 'pinned' | 'observed' | null;

export interface DraftSelectionContextValue {
  selection: DraftSelection | null;
  origin: DraftSelectionOrigin;
  pinnedSelection: DraftSelection | null;
  observedSelection: DraftSelection | null;
  pinSelection: (selection: DraftSelection | null) => void;
  observeSelection: (selection: DraftSelection | null) => void;
  clearPinnedSelection: () => void;
  clearSelection: () => void;
}

interface DraftSelectionProviderProps {
  scope: DraftSelectionScope;
  children: ReactNode;
}

const DraftSelectionContext = createContext<DraftSelectionContextValue | null>(null);

function validInScope(
  selection: DraftSelection | null,
  scope: DraftSelectionScope,
): DraftSelection | null {
  if (!selection) return null;
  const result = validateDraftSelection(selection, scope);
  return result.valid ? result.selection : null;
}

export function DraftSelectionProvider({
  scope,
  children,
}: DraftSelectionProviderProps) {
  const [pinned, setPinned] = useState<DraftSelection | null>(null);
  const [observed, setObserved] = useState<DraftSelection | null>(null);

  // Derived values fail closed during the project-changing render itself.
  const pinnedSelection = validInScope(pinned, scope);
  const observedSelection = validInScope(observed, scope);

  useLayoutEffect(() => {
    setPinned(null);
    setObserved(null);
  }, [scope.projectId]);

  const pinSelection = useCallback((next: DraftSelection | null) => {
    setPinned(validInScope(next, scope));
  }, [scope]);
  const observeSelection = useCallback((next: DraftSelection | null) => {
    setObserved(validInScope(next, scope));
  }, [scope]);
  const clearPinnedSelection = useCallback(() => setPinned(null), []);
  const clearSelection = useCallback(() => {
    setPinned(null);
    setObserved(null);
  }, []);

  const value = useMemo<DraftSelectionContextValue>(() => ({
    selection: pinnedSelection ?? observedSelection,
    origin: pinnedSelection ? 'pinned' : observedSelection ? 'observed' : null,
    pinnedSelection,
    observedSelection,
    pinSelection,
    observeSelection,
    clearPinnedSelection,
    clearSelection,
  }), [
    clearPinnedSelection,
    clearSelection,
    observeSelection,
    observedSelection,
    pinSelection,
    pinnedSelection,
  ]);

  return (
    <DraftSelectionContext.Provider value={value}>
      {children}
    </DraftSelectionContext.Provider>
  );
}

export function useDraftSelection(): DraftSelectionContextValue {
  const value = useContext(DraftSelectionContext);
  if (!value) {
    throw new Error('useDraftSelection must be used within DraftSelectionProvider');
  }
  return value;
}
