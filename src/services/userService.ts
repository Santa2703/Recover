import type { UserRecord } from '@/models/domain.model';
import type { UserRole } from '@/models/user.model';
import { meta, userStore } from './mock/stores';
import { delay } from './mock/mockUtils';

export const userService = {
  async list(): Promise<UserRecord[]> {
    await delay(150);
    return userStore.all();
  },
  /** Synchronous lookups used by the shell (no network round-trip needed for the signed-in user). */
  all: () => userStore.all(),
  get: (id: string) => userStore.get(id),
  forRole(role: UserRole, tenant?: string): UserRecord | undefined {
    const users = userStore.all().filter((u) => u.role === role);
    return (tenant && users.find((u) => u.tenant === tenant)) || users[0];
  },
  meta: () => meta,
};
