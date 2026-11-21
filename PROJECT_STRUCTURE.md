# Circularity Decision Workbench · Architecture & Code Structure

This document outlines the enterprise-grade project structure for the **Circularity Decision Workbench**, built with **Next.js (App Router)**, **Ant Design (`antd`)**, and **Material UI Icons (`@mui/icons-material`)**.

---

## 1. High-Level Technology Stack & Architectural Layers

* **Framework:** Next.js 16 (App Router, Server & Client Components)
* **UI Component Library:** Ant Design (`antd`) with `@ant-design/nextjs-registry` for SSR style extraction
* **Icon Library:** Material UI Icons (`@mui/icons-material` / `@emotion/react` / `@emotion/styled`)
* **Styling:** Tailwind CSS v4 + Ant Design ConfigProvider Theme Token integration
* **Language:** TypeScript 5+ (Strict mode)

### Architectural Foundation
1. **`src/services/` (Service Layer):** Contains all domain business logic, mathematical simulation calculators, and API data access abstractions decoupled from React components.
2. **`src/models/` (Data & Domain Models):** TypeScript interfaces and types for the 7 circularity routes, cases, assets, scenario variables, users, and RBAC roles.
3. **`src/components/` (Presentation Layer):** Ant Design atomic components, layout shells (Sidebar, Header), and specialized feature modules.
4. **`src/app/` (Application Routes):** Next.js App Router pages for the 8 core operational modules.
5. **`src/store/` (State Management):** Reactive state for active role personas, tenant filters, and scenario sliders.


---

## 2. Directory Tree

```
circularity/
├── public/                           # Static assets, branding logos, icons, diagrams
│   ├── images/
│   │   ├── logo.svg
│   │   └── systems/                  # Connector logos (SAP, Manhattan, Salesforce, etc.)
│   └── favicon.ico
├── src/
│   ├── app/                          # Next.js App Router (Routes & Layouts)
│   │   ├── layout.tsx                # Root layout (AntdRegistry, ConfigProvider, Global CSS)
│   │   ├── page.tsx                  # Home redirect / Landing dashboard
│   │   ├── globals.css               # Tailwind CSS & global styling tokens
│   │   │
│   │   ├── (auth)/                   # Authentication route group
│   │   │   ├── signin/
│   │   │   │   └── page.tsx          # Sign-in & role persona switcher
│   │   │   └── layout.tsx
│   │   │
│   │   ├── (workbench)/              # Core Authenticated Workbench layout group
│   │   │   ├── layout.tsx            # Main shell: AppHeader, Sidebar, Breadcrumb, Copilot drawer
│   │   │   │
│   │   │   ├── command/              # Module 1: Command Center
│   │   │   │   ├── page.tsx          # Overview, KPIs, actions on me, exceptions
│   │   │   │   ├── exceptions/page.tsx
│   │   │   │   ├── approvals/page.tsx
│   │   │   │   ├── value/page.tsx
│   │   │   │   └── signals/page.tsx
│   │   │   │
│   │   │   ├── product/              # Module 2: Decision Workbench
│   │   │   │   ├── page.tsx          # Default redirect to /product/received
│   │   │   │   ├── received/         # Returned Assets Intake Queue
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── expected/         # Inbound Expected Returns
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── pools/            # Multi-unit Pool Optimizer
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── asset/[id]/       # Asset 360 Intelligence View
│   │   │   │   │   └── page.tsx
│   │   │   │   └── case/[id]/        # 5-Panel Treatment Decision Workbench
│   │   │   │       └── page.tsx
│   │   │   │
│   │   │   ├── analytics/            # Module 3: Reconcile & Learn
│   │   │   │   ├── page.tsx          # Recovery waterfall & route mix trends
│   │   │   │   ├── waterfall/page.tsx
│   │   │   │   ├── pipeline/page.tsx
│   │   │   │   ├── predicted/page.tsx
│   │   │   │   ├── models/page.tsx
│   │   │   │   └── sustain/page.tsx
│   │   │   │
│   │   │   ├── integration/          # Module 4: Connection Fabric
│   │   │   │   ├── page.tsx          # Default redirect to /integration/map
│   │   │   │   ├── studio/page.tsx   # Visual Workflow Studio pipeline canvas
│   │   │   │   ├── map/page.tsx      # System source topology map
│   │   │   │   ├── tables/page.tsx   # Data source catalog and links
│   │   │   │   ├── models/page.tsx   # Canonical data models
│   │   │   │   ├── events/page.tsx   # Live enterprise event stream
│   │   │   │   ├── conflicts/page.tsx# Systems reconciliation conflict queue
│   │   │   │   └── import/page.tsx   # Controlled CSV manual import
│   │   │   │
│   │   │   ├── mcp/                  # Module 5: MCP & Agent Governance
│   │   │   │   ├── page.tsx          # Tool catalog & agent registry
│   │   │   │   ├── catalog/page.tsx
│   │   │   │   ├── agents/page.tsx
│   │   │   │   ├── playground/page.tsx
│   │   │   │   ├── perms/page.tsx
│   │   │   │   └── calls/page.tsx
│   │   │   │
│   │   │   ├── orchestration/        # Module 6: Process Orchestration
│   │   │   │   ├── page.tsx          # 10-stage lifecycle overview
│   │   │   │   ├── flow/page.tsx
│   │   │   │   └── run/[id]/page.tsx # Individual case run trace
│   │   │   │
│   │   │   ├── audit/                # Module 7: Audit & Provenance
│   │   │   │   ├── page.tsx          # Immutable fetch log & evidence gaps
│   │   │   │   ├── log/page.tsx
│   │   │   │   └── gaps/page.tsx
│   │   │   │
│   │   │   └── access/               # Module 8: Access & Identity
│   │   │       ├── page.tsx          # User directory & persona switcher
│   │   │       ├── accounts/page.tsx
│   │   │       ├── delegations/page.tsx
│   │   │       └── requests/page.tsx
│   │   │
│   │   └── api/                      # Next.js API Route Handlers
│   │       ├── assets/route.ts
│   │       ├── cases/route.ts
│   │       ├── treatments/simulate/route.ts
│   │       ├── pool-optimizer/route.ts
│   │       ├── copilot/route.ts
│   │       └── integrations/route.ts
│   │
│   ├── components/                   # Reusable UI Components
│   │   ├── common/                   # Shared Antd-based Atomic / Base Components
│   │   │   ├── AntdProvider.tsx      # Antd ConfigProvider + SSR Registry
│   │   │   ├── StatCard.tsx          # KPI metric card with trend and status
│   │   │   ├── StatusBadge.tsx       # Pill badges for lifecycle stages and health
│   │   │   ├── RouteTag.tsx          # Colored badge for the 7 disposition routes
│   │   │   ├── DataTable.tsx         # Standard Antd Table with sorting/filtering
│   │   │   ├── ConfirmModal.tsx      # Reusable confirmation dialog
│   │   │   ├── DrawerContainer.tsx   # Reusable right slide-out panel
│   │   │   ├── FilterChipBar.tsx     # Plain-language generated filter chips
│   │   │   └── EmptyState.tsx        # Fallback view for missing data
│   │   │
│   │   ├── layout/                   # Workbench Layout Components
│   │   │   ├── AppHeader.tsx         # Header with breadcrumb, tenant, role picker
│   │   │   ├── AppSidebar.tsx        # Nav menu, badge counters, collapse toggle
│   │   │   ├── AppBreadcrumb.tsx     # Route breadcrumbs
│   │   │   ├── RoleSwitcher.tsx      # Persona switcher (Planner, Approver, etc.)
│   │   │   ├── TenantSelector.tsx    # Multi-tenant and site filter
│   │   │   └── UserProfileMenu.tsx   # User profile dropdown
│   │   │
│   │   ├── copilot/                  # "Ask Circularity" AI Copilot
│   │   │   ├── CopilotDrawer.tsx     # Collapsible / resizable assistant drawer
│   │   │   ├── CopilotChat.tsx       # Message thread with action buttons
│   │   │   ├── FilterChipAction.tsx  # Applies table filters from plain text
│   │   │   └── UndoActionBar.tsx     # Reversible action feedback
│   │   │
│   │   └── modules/                  # Feature / Domain-Specific Components
│   │       ├── command/              # Command Center widgets
│   │       │   ├── KpiSummaryGrid.tsx
│   │       │   ├── ActionsOnMeTable.tsx
│   │       │   ├── ApprovalsInboxList.tsx
│   │       │   ├── PortfolioHealthChart.tsx
│   │       │   ├── ValueRealisationWidget.tsx
│   │       │   └── CapacitySignalsCard.tsx
│   │       │
│   │       ├── product/              # Decision Workbench widgets
│   │       │   ├── intake/
│   │       │   │   ├── ReceivedTable.tsx
│   │       │   │   ├── ExpectedTable.tsx
│   │       │   │   └── QuickTriageModal.tsx
│   │       │   ├── workbench/        # 5-Panel Treatment Decision Interface
│   │       │   │   ├── TreatmentHeader.tsx
│   │       │   │   ├── RetrievedVsPredictedPanel.tsx  # Panel 1: Facts vs ML
│   │       │   │   ├── ScenarioSimulationPanel.tsx    # Panel 2: Sliders & Math
│   │       │   │   ├── DemandMatchingPanel.tsx        # Panel 3: Sales Order Match
│   │       │   │   ├── GateApprovalPanel.tsx          # Panel 4: Governance Checklist
│   │       │   │   └── EvidenceRequestPanel.tsx       # Panel 5: Physical re-test
│   │       │   ├── asset/
│   │       │   │   ├── AssetDetailsSummary.tsx
│   │       │   │   ├── DegradationCurveChart.tsx
│   │       │   │   └── TelemetryTimeline.tsx
│   │       │   └── pool/
│   │       │       ├── PoolAllocationGrid.tsx
│   │       │       └── DemandFulfillmentMatrix.tsx
│   │       │
│   │       ├── analytics/            # Analytics widgets
│   │       │   ├── RecoveryWaterfallChart.tsx
│   │       │   ├── PipelineFunnelChart.tsx
│   │       │   ├── RouteMixAreaChart.tsx
│   │       │   └── PredictionAccuracyScatter.tsx
│   │       │
│   │       ├── integration/          # Integration & Fabric widgets
│   │       │   ├── SourceMapTopology.tsx
│   │       │   ├── ConflictQueueList.tsx
│   │       │   ├── EventStreamTable.tsx
│   │       │   └── WorkflowStudio/
│   │       │       ├── WorkflowCanvas.tsx
│   │       │       ├── NodePalette.tsx
│   │       │       └── NodeConfigDrawer.tsx
│   │       │
│   │       ├── mcp/                  # MCP & Agent Governance widgets
│   │       │   ├── ToolCatalogList.tsx
│   │       │   ├── AgentRegistryTable.tsx
│   │       │   ├── ToolPlayground.tsx
│   │       │   └── PermissionMatrixTable.tsx
│   │       │
│   │       ├── orchestration/        # Orchestration widgets
│   │       │   ├── TenStageProcessFlow.tsx
│   │       │   └── CaseRunTraceViewer.tsx
│   │       │
│   │       ├── audit/                # Audit widgets
│   │       │   ├── ProvenanceLogTable.tsx
│   │       │   └── EvidenceGapReport.tsx
│   │       │
│   │       └── access/               # Access widgets
│   │           ├── AccountDirectoryTable.tsx
│   │           └── DelegationsManager.tsx
│   │
│   ├── models/                       # TypeScript Domain Models & Interfaces
│   │   ├── asset.model.ts            # Asset specifications, BOM, health, telemetry
│   │   ├── case.model.ts             # Intake return case, status, location, stage
│   │   ├── treatment.model.ts        # The 7 Circularity routes & economic criteria
│   │   ├── scenario.model.ts         # Simulation variables (refurb cost, price, NPV)
│   │   ├── pool.model.ts             # Pool allocation & batch optimization
│   │   ├── integration.model.ts      # Connectors, sync status, conflicts, events
│   │   ├── mcp.model.ts              # Governed tools, agents, call logs, write gates
│   │   ├── workflow.model.ts         # Orchestration stages, nodes, edges, rules
│   │   ├── audit.model.ts            # Immutable journal entries, source provenance
│   │   ├── user.model.ts             # User account, permissions, delegations
│   │   └── common.model.ts           # Pagination, API envelope, filter state
│   │
│   ├── services/                     # Business Logic & Data Access Layer
│   │   ├── api/                      # Base HTTP / Fetch Client
│   │   │   └── apiClient.ts
│   │   ├── asset.service.ts          # Fetch asset history, telemetry, BOM
│   │   ├── case.service.ts           # Case queries, triage, stage updates
│   │   ├── treatment.service.ts      # Route recommendations, scoring, gates
│   │   ├── scenario.service.ts       # Mathematical solver for real-time simulations
│   │   ├── pool.service.ts           # Allocation optimization logic
│   │   ├── integration.service.ts    # Connectors, conflict reconciliation
│   │   ├── mcp.service.ts            # Tool executions, safety gates, registry
│   │   ├── workflow.service.ts       # Pipeline triggers, node execution
│   │   ├── audit.service.ts          # Provenance logger, gap verification
│   │   ├── copilot.service.ts        # Natural language query interpretation
│   │   └── auth.service.ts           # Role resolution, permissions check
│   │
│   ├── store/                        # Global Client State Management (Zustand or Context)
│   │   ├── authContext.tsx           # Active role, tenant, permitted pages
│   │   ├── workbenchStore.ts         # Active case, scenario slider values
│   │   ├── filterStore.ts            # Active table filters, quick search, chips
│   │   └── copilotStore.ts           # Open/close state, chat log, pending actions
│   │
│   ├── constants/                    # Application Constants & Lookup Tables
│   │   ├── routes.constants.ts       # The 7 disposition routes metadata & colors
│   │   ├── roles.constants.ts        # 8 RBAC roles, page permissions & policies
│   │   ├── navigation.constants.ts   # Sidebar structure, icons, badge definitions
│   │   ├── classes.constants.ts      # Asset categories (Motors, Pumps, PLCs, etc.)
│   │   └── stages.constants.ts       # 10 lifecycle orchestration stages
│   │
│   ├── utils/                        # Pure Helper Utilities
│   │   ├── formatters.ts             # Currency, numbers (tabular), percentages
│   │   ├── dateUtils.ts              # Timestamps, relative time, SLAs
│   │   ├── mathUtils.ts              # NPV calculations, residual life formulas
│   │   ├── exportUtils.ts            # CSV / PDF export helpers
│   │   └── cn.ts                     # Tailwind class merge helper
│   │
│   └── theme/                        # Styling and Theme Configuration
│       ├── antdTheme.ts              # Ant Design Theme Tokens (colors, fonts, radius)
│       └── colors.ts                 # Centralized color palette
│
├── .gitignore
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## 3. Core Models & Architectural Contracts

### A. The 7 Disposition Routes (`src/models/treatment.model.ts`)
```typescript
export type DispositionRouteId =
  | 'redeploy'   // Internal redeploy across facilities
  | 'resale'     // Whole-asset resale in secondary markets
  | 'intparts'   // Internal recovered-part harvesting
  | 'relase'     // Secondary lease / rental cycles
  | 'material'   // Material recovery / closed-loop recycling
  | 'extparts'   // External component/parts resale
  | 'exit';      // Responsible disposal / certified recycling

export interface TreatmentRoute {
  id: DispositionRouteId;
  name: string;
  shortLabel: string;
  color: string;
  expectedNetRecovery: number;
  carbonAvoidedKg: number;
  confidenceScore: number;
  leadTimeDays: number;
  isEligible: boolean;
  ineligibilityReason?: string;
}
```

### B. Scenario Simulation State (`src/models/scenario.model.ts`)
```typescript
export interface ScenarioVariables {
  purchaseMultiplier: number;   // Slider: 0.5x - 2.0x
  refurbCostMultiplier: number; // Slider: 0.5x - 2.0x
  serviceLifeMultiplier: number;// Slider: 0.5x - 2.0x
  marketDemandFactor: number;   // Slider: 0.5x - 2.0x
  demandOverride: boolean;      // Toggle to simulate zero internal demand
}

export interface ScenarioImpact {
  route: DispositionRouteId;
  baselineRecovery: number;
  simulatedRecovery: number;
  variance: number;
  npvDelta: number;
}
```

### C. Role-Based Access Control (`src/models/user.model.ts`)
```typescript
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
```

---

## 4. Ant Design & Material UI Integration Pattern

### SSR-Safe Setup (`src/components/common/AntdProvider.tsx`)
Because Next.js App Router runs in Server Components by default, Ant Design styles are extracted cleanly using `@ant-design/nextjs-registry` paired with a custom `ConfigProvider`:

```tsx
'use client';

import React from 'react';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider, theme } from 'antd';
import { antdThemeTokens } from '@/theme/antdTheme';

export function AntdProvider({ children }: { children: React.ReactNode }) {
  return (
    <AntdRegistry>
      <ConfigProvider theme={antdThemeTokens}>
        {children}
      </ConfigProvider>
    </AntdRegistry>
  );
}
```

### Material UI Icons Standard Usage
Icons are imported directly from `@mui/icons-material`:
```tsx
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import AutoModeRoundedIcon from '@mui/icons-material/AutoModeRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
```

---

## 5. Development Milestones & Order of Execution

1. **Foundation & Dependencies:**
   * Install `antd`, `@ant-design/nextjs-registry`, `@mui/icons-material`, `@mui/material`, `@emotion/react`, `@emotion/styled`.
   * Configure `AntdProvider` and theme tokens (`src/theme/antdTheme.ts`).
2. **Layout Shell:**
   * Implement `AppHeader`, `AppSidebar` (with rail mode support), `RoleSwitcher`, and `TenantSelector`.
3. **Primary Pages & Route Structure:**
   * Command Center (`/command`)
   * Decision Workbench: Return Queues (`/product/received`, `/product/expected`) and Case Treatment (`/product/case/[id]`).
   * Pool Optimizer (`/product/pools`).
   * Integration Connection Fabric (`/integration/map`, `/integration/studio`).
   * Analytics (`/analytics`).
   * MCP Governance (`/mcp`).
4. **Interactive Features & Services:**
   * Mathematical Scenario Simulation solver.
   * "Ask Circularity" Copilot slide-out drawer with filter generation.
