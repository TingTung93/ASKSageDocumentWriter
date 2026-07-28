import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { actionById, type DraftAction } from './actions';

export type DraftCommandId =
  | DraftAction['id']
  | 'focus_instruction'
  | 'accept_proposal'
  | 'reject_proposal';

export interface DraftActionRegistration {
  scopeLabel: string;
  busy: boolean;
  hasProposal: boolean;
  propose: (action: DraftAction) => void;
  proposeCustom: (instruction: string) => void;
  focusInstruction: () => void;
  accept: () => void;
  reject: () => void;
}

interface DraftActionControllerValue {
  active: DraftActionRegistration | null;
  announcement: string;
  register: (registration: DraftActionRegistration | null) => void;
  run: (command: DraftCommandId) => boolean;
  runInstruction: (instruction: string) => boolean;
}

const Context = createContext<DraftActionControllerValue | null>(null);

export function DraftActionControllerProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<DraftActionRegistration | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const register = useCallback((registration: DraftActionRegistration | null) => {
    setActive(registration);
  }, []);
  const run = useCallback((command: DraftCommandId): boolean => {
    if (!active || active.busy) return false;
    const action = actionById(command as DraftAction['id']);
    if (action) {
      active.propose(action);
      setAnnouncement(`${action.label} requested for ${active.scopeLabel}.`);
      return true;
    }
    if (command === 'focus_instruction') {
      active.focusInstruction();
      return true;
    }
    if (!active.hasProposal) return false;
    if (command === 'accept_proposal') active.accept();
    else if (command === 'reject_proposal') active.reject();
    else return false;
    setAnnouncement(
      `${command === 'accept_proposal' ? 'Accepting' : 'Rejecting'} proposal for ${active.scopeLabel}.`,
    );
    return true;
  }, [active]);
  const runInstruction = useCallback((instruction: string): boolean => {
    if (!active || active.busy || !instruction.trim()) return false;
    active.proposeCustom(instruction.trim());
    setAnnouncement(`Custom edit requested for ${active.scopeLabel}.`);
    return true;
  }, [active]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'e') {
        if (run('focus_instruction')) event.preventDefault();
      } else if (event.ctrlKey && event.shiftKey && event.key === 'Enter') {
        if (run('accept_proposal')) event.preventDefault();
      } else if (event.ctrlKey && event.shiftKey && event.key === 'Backspace') {
        if (run('reject_proposal')) event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [run]);

  const value = useMemo(
    () => ({ active, announcement, register, run, runInstruction }),
    [active, announcement, register, run, runInstruction],
  );
  return (
    <Context.Provider value={value}>
      {children}
      <div aria-live="polite" className="sr-only" role="status">{announcement}</div>
    </Context.Provider>
  );
}

export function useDraftActionController(): DraftActionControllerValue {
  const value = useContext(Context);
  if (!value) throw new Error('Draft actions require DraftActionControllerProvider.');
  return value;
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}
