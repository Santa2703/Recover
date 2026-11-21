/**
 * In-memory stores seeded from src/data/*.json. Import stores only from services,
 * never from UI components.
 *
 * `caseStore` is the decision-engine view of the cases: for open cases the recommended
 * route, estimated net recovery, value at risk and demand ids come from the queue plan
 * (src/services/decision), so every screen shows the same numbers as decisionService.
 */
import casesJson from '@/data/cases.json';
import exceptionsJson from '@/data/exceptions.json';
import tasksJson from '@/data/tasks.json';
import alertsJson from '@/data/alerts.json';
import usersJson from '@/data/users.json';
import historyJson from '@/data/history.json';
import capacityJson from '@/data/capacity.json';
import metaJson from '@/data/meta.json';
import type {
  AlertRecord,
  AppMeta,
  CapacityRecord,
  CaseRecord,
  ExceptionRecord,
  MonthlyHistory,
  TaskRecord,
  UserRecord,
} from '@/models/domain.model';
import { createCollection } from './mockUtils';
import { withDecisions } from '../decision/runtime';

/** Cases exactly as stored (no engine decoration). Prefer `caseStore`. */
export const rawCaseStore = createCollection<CaseRecord>(casesJson as CaseRecord[]);
export const caseStore = withDecisions(rawCaseStore);
export const exceptionStore = createCollection<ExceptionRecord>(exceptionsJson as ExceptionRecord[]);
export const taskStore = createCollection<TaskRecord>(tasksJson as TaskRecord[]);
export const alertStore = createCollection<AlertRecord>(alertsJson as AlertRecord[]);
export const userStore = createCollection<UserRecord>(usersJson as UserRecord[]);

export const history = historyJson as MonthlyHistory[];
export const capacity = capacityJson as CapacityRecord[];
export const meta = metaJson as AppMeta;
