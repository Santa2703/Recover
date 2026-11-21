import type { AlertRecord } from '@/models/domain.model';
import type { UserRole } from '@/models/user.model';
import { alertStore } from './mock/stores';
import { delay } from './mock/mockUtils';

const visibleTo = (role: UserRole) => (a: AlertRecord) => role === 'Admin' || a.roles.includes(role);

export const alertService = {
  subscribe: alertStore.subscribe,

  async list(role: UserRole): Promise<AlertRecord[]> {
    await delay(180);
    return alertStore
      .all()
      .filter(visibleTo(role))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async markRead(id: string): Promise<void> {
    await delay(120);
    alertStore.update(id, { read: true });
  },

  async markAllRead(role: UserRole): Promise<void> {
    await delay(200);
    alertStore.all().filter(visibleTo(role)).forEach((a) => !a.read && alertStore.update(a.id, { read: true }));
  },

  unreadCount: (role: UserRole) => alertStore.all().filter(visibleTo(role)).filter((a) => !a.read).length,
};
