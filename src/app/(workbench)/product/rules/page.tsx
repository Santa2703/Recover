'use client';

import { PageHeader } from '@/components/ui';
import { DecisionFlowStudio } from '@/components/decisionflow/DecisionFlowStudio';

/**
 * Business rules: the decision flow around the fixed decision core, in the Decision Workbench
 * where planners and approvers work. Same editor the Workflow Studio used to host in "Decision flow" mode.
 */
export default function BusinessRulesPage() {
  return (
    <div className="space-y-4 w-full min-w-0">
      <PageHeader
        title="Business rules"
        description="Business rules around the fixed decision core: edit a draft, check it, simulate it on open cases, then get it approved and published."
      />
      <DecisionFlowStudio />
    </div>
  );
}
