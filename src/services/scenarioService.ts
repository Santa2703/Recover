/**
 * Saved scenarios (Case page Scenario card): named sets of scenario levers and an edge-case preset,
 * kept for this session. Applying one only changes what the Case page shows; it never changes the
 * decision, the queue plan or anything another user sees.
 *
 * Read with useSyncExternalStore(scenarioService.subscribe, scenarioService.all).
 */
import type { PresetId, RouteId } from '@/models/decision.model';
import type { RouteScenario } from './productService';

export interface SavedScenario {
  id: string;
  caseId: string;
  name: string;
  scenario: RouteScenario;
  preset: PresetId | null;
  applyTo: 'all' | RouteId;
  /** Best route and net under the scenario when it was saved (for the list). */
  routeName: string;
  net: number;
  savedBy: string;
  savedAt: string;
}

let items: SavedScenario[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const scenarioService = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Every saved scenario (stable array between changes). */
  all: (): SavedScenario[] => items,
  forCase: (caseId: string): SavedScenario[] => items.filter((s) => s.caseId === caseId),
  save(input: Omit<SavedScenario, 'id' | 'savedAt'>): SavedScenario {
    const name = input.name.trim();
    if (!name) throw new Error('Give the scenario a name');
    if (name.length > 60) throw new Error('Keep the name under 60 characters');
    if (items.some((s) => s.caseId === input.caseId && s.name.toLowerCase() === name.toLowerCase())) throw new Error(`A scenario called "${name}" is already saved for ${input.caseId}`);
    seq += 1;
    const rec: SavedScenario = { ...input, name, id: `SCN-${seq}`, savedAt: new Date().toISOString() };
    items = [...items, rec];
    emit();
    return rec;
  },
  remove(id: string): void {
    items = items.filter((s) => s.id !== id);
    emit();
  },
};
