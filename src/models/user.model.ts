export type UserRole =
  | 'Planner'
  | 'Approver'
  | 'Engineer'
  | 'Finance'
  | 'Developer'
  | 'Executive'
  | 'Warehouse Manager'
  | 'Admin';

export interface UserPersona {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenant: string;
  site?: string;
  warehouseScoped?: boolean;
  permissions: string[];
}
