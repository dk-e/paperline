import { useCallback, useRef, useState } from 'react';
import type { Annotation } from './model';

export function useHistory() {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const current = useRef<Annotation[]>([]);
  const [undoStack, setUndoStack] = useState<Annotation[][]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[][]>([]);
  const undoRef = useRef<Annotation[][]>([]);
  const redoRef = useRef<Annotation[][]>([]);
  const set = useCallback((next: Annotation[]) => { current.current = next; setAnnotations(next); }, []);
  const stacks = useCallback((undo: Annotation[][], redo: Annotation[][]) => {
    undoRef.current = undo; redoRef.current = redo; setUndoStack(undo); setRedoStack(redo);
  }, []);
  const reset = useCallback((next: Annotation[]) => { set(next); stacks([], []); }, [set, stacks]);
  const commit = useCallback((next: Annotation[] | ((prev: Annotation[]) => Annotation[])) => {
    const result = typeof next === 'function' ? next(current.current) : next;
    if (JSON.stringify(result) === JSON.stringify(current.current)) return;
    stacks([...undoRef.current.slice(-99), current.current], []); set(result);
  }, [set, stacks]);
  const undo = useCallback(() => {
    const stack = undoRef.current; if (!stack.length) return;
    stacks(stack.slice(0, -1), [...redoRef.current, current.current]); set(stack[stack.length - 1]);
  }, [set, stacks]);
  const redo = useCallback(() => {
    const stack = redoRef.current; if (!stack.length) return;
    stacks([...undoRef.current, current.current], stack.slice(0, -1)); set(stack[stack.length - 1]);
  }, [set, stacks]);
  return { annotations, current, commit, reset, undo, redo, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
}
