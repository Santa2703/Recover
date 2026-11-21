# Recover · Circularity Decision Workbench

[![Next.js](https://img.shields.io/badge/Next.js-16.4-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.3-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![Ant Design](https://img.shields.io/badge/Ant_Design-6.7-0170FE?logo=antdesign)](https://ant.design/)
[![Netlify Status](https://img.shields.io/badge/Deploy-Netlify-00C7B7?logo=netlify)](https://www.netlify.com/)

**Recover** is an enterprise-grade aftermarket, asset lifecycle management, and circularity decision-intelligence platform. It unifies engineering, ERP, EAM, IoT telemetry, CRM, market intelligence, downstream recyclers, finance, and sustainability data into an actionable operational decision environment.

Rather than acting simply as an asset registry or static reporting dashboard, Recover is a **decision-intelligence and execution engine** that continuously answers:

- *What should we do with this asset?*
- *Should we repair, redeploy internally, resell, harvest parts, or recycle?*
- *What is the financially optimal and technically feasible option?*
- *What evidence supports the recommendation, and what risks prevent execution?*
- *Who needs to approve it, and did the predicted financial & carbon outcomes occur?*

---

## The Decision Lifecycle

Recover follows a continuous, closed-loop decision lifecycle:

$$\text{Sense} \longrightarrow \text{Predict} \longrightarrow \text{Decide} \longrightarrow \text{Act} \longrightarrow \text{Learn}$$

### 6 Primary Disposition Pathways

| Pathway | Strategy | Primary Focus |
|---|---|---|
| **Repair** | Component & subassembly reconditioning | Restore to OEM operating specifications |
| **Redeploy** | Internal facility transfer | Maximize avoided CAPEX spend across plants |
| **Resale** | Secondary market remarketing | Capture maximum gross margin & recovery yield |
| **Parts Harvest** | High-value sub-component stripping | Feed internal maintenance spare part inventories |
| **Recycle** | Raw material reclamation | Divert scrap, recover critical minerals & metals |
| **Responsible Exit** | Certified sustainable decommissioning | Comply with environmental & disposal mandates |

---

## Key Modules & Capabilities

### 1. Command Center & Portfolio Control
- **Key Figures**: Executive metrics including Potential Recovery Value, Value at Risk, Requests Waiting, and Integration Health.
- **Value Realisation**: 12-month historical actual vs. predicted recovery chart with yield trends.
- **Exceptions Workspace**: Action-management workspace grouping warehouse bottlenecks, missing evidence, delayed approvals, and condition deterioration with direct "Notify Owner" escalation modals.
- **Actions on Me**: Personal task queue tracking SLA deadlines, required stage gates, and assigned reviews.
- **Approvals Inbox**: High-value governance queue enforcing multi-tier sign-offs and policy variance checks.

### 2. Decision Workbench & Case Workspace
- **10-Stage Case Journey**: Persistent progress tracker spanning *Inbound Notification &rarr; Receiving &rarr; Inspection &rarr; Decision Intelligence &rarr; Sensitivity &rarr; Approval &rarr; Execution &rarr; Downstream Processing &rarr; Reconciliation &rarr; Audit Closure*.
- **Multi-Route Comparison**: Dynamic matrix evaluating Net Recovery, Direct Costs, Labor Time, Feasibility, Confidence, Risk, and Avoided CO₂e across all 6 pathways simultaneously.
- **Explainable Recommendation**: Narrative *"Why?"* breakdowns detailing demand validation, risk factors, and reasons for dismissing alternate routes.
- **Scenario Sensitivity Sliders**: Live interactive sensitivity controls for refurbishment cost multipliers, secondary price fluctuations, and plant demand overrides.
- **Asset Intelligence**: Digital twin telemetry, operating hours, degradation curves, and bill of materials (BOM) linkages.
- **Pool Optimizer**: Linear programming multi-unit allocation solver matching batch returns against competing internal plant requisitions vs. high-margin resale backlog.

### 3. Connection Fabric & Integration Control Plane
- **System Topology Map**: Live connector health, sync intervals, and latency monitoring across SAP S/4HANA, Manhattan WMS, Salesforce Service Cloud, PTC Windchill PLM, and AWS IoT Core.
- **Workflow Studio**: Visual node-based pipeline designer with canvas zoom controls, component library, and branching execution graphs (*External Source &rarr; API Gateway &rarr; Validation &rarr; Timestamps / Error Handler*).
- **Data Modeler & Field Mappings**: Governed schema transformation boundary mapping vendor tables into unified canonical entities (*e.g., SAP.EQUNR &rarr; physical_asset.serial_number*) with data type casting, confidence scoring, and schema drift alerts.
- **Conflict Queue & Deduplication**: Multi-system canonical identity reconciliation resolving duplicate or conflicting serial records.

### 4. Performance Analytics & Economics
- **Recovery Waterfall**: Stepwise value creation from scrap baseline up through redeployment and resale uplifts.
- **Route Mix Progression**: Real-time distribution across the 7 circularity pathways with target threshold tracking.
- **Predicted vs. Actual**: Algorithm accuracy calibration and economic variance analysis.
- **Engineering Economics**: Salvage Net Present Value (NPV), avoided CAPEX spend curves, payback horizons, and WACC sensitivity.
- **Sustainability & ESG**: Scope 3 avoided embodied emissions (tCO₂e) tracking aligned with GHG Protocol and Persefoni standards.

### 5. MCP & Agent Governance
- **Tool Registry**: Safety-scoped tool catalog with strict role-based access (`read_only`, `write_gated`, `compute`).
- **Agent Registry**: AI agent identities, execution boundaries, and autonomous action limits.
- **Tool Playground**: Schema verification and sandbox invocation for agent integrations.

### 6. Governance & Platform Settings
- **Tenant Profile**: Organization parameters, primary reporting currency, and facility timezones.
- **Sites & Warehouses**: Staging bay capacity, facility leads, and intake hub configurations.
- **Workflow Policies**: Automated low-risk approval thresholds, mandatory high-voltage engineering sign-offs, and escalation rules.
- **Notifications**: Case owner email digests and live Slack incident webhooks.

---

## Technology Stack

- **Framework**: Next.js 16.4 (App Router, Server & Client Components)
- **UI Library**: Ant Design (`antd` 6.7) with `@ant-design/nextjs-registry` for zero-FOUC SSR style extraction
- **Styling**: Tailwind CSS v4 + Ant Design Theme Token system
- **Iconography**: Lucide SVG Icons (`lucide-react`)
- **Visual Canvas**: `@xyflow/react` for node pipeline graphs
- **Charts**: Recharts & custom SVG visualizations
- **Language**: TypeScript 5 (Strict Mode)
- **Deployment**: Netlify via `@netlify/plugin-nextjs` and Node 20 runtime

---

## Getting Started

### Prerequisites

- **Node.js**: v20.x or higher
- **npm**: v10.x or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/Santa2703/Recover.git
cd Recover

# Install dependencies
npm install
```

### Running Locally

```bash
# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Building for Production

```bash
# Run type-checking and create production build
npm run build

# Start production server locally
npm start
```

---

## Deployment to Netlify

This repository includes a preconfigured [netlify.toml](./netlify.toml) file.

### Option A: Automatic Git Integration (Recommended)

1. Log into **[Netlify](https://app.netlify.com/)**.
2. Click **Add new site** &rarr; **Import an existing project**.
3. Select **GitHub** and authorize access to **`Santa2703/Recover`**.
4. Netlify will auto-detect the configuration:
   - **Build command**: `npm run build`
   - **Publish directory**: `.next`
   - **Node Version**: `20`
5. Click **Deploy site**.

### Option B: Netlify CLI

```bash
# Install Netlify CLI globally
npm install -g netlify-cli

# Login and deploy
netlify login
netlify deploy --build --prod
```

---

## Information Architecture

```
src/
├── app/
│   ├── (workbench)/
│   │   ├── dashboard/            # Home personal workspace
│   │   ├── command/              # Command Center, Key Figures & Exceptions
│   │   │   ├── exceptions/       # Operational exceptions table
│   │   │   ├── actions/          # My Tasks & Actions on Me
│   │   │   ├── approvals/        # Approvals Inbox
│   │   │   └── value/            # Outcomes to Confirm
│   │   ├── product/              # Decision Workbench
│   │   │   ├── received/         # Returned Assets queue
│   │   │   ├── expected/         # Expected Inbound Returns
│   │   │   ├── pools/            # Multi-unit Pool Optimizer
│   │   │   ├── intelligence/     # Asset 360 Telemetry
│   │   │   └── case/[id]/        # 10-Stage Case Workspace
│   │   ├── analytics/            # Performance & Outcome Reconciliation
│   │   │   ├── mix/              # Route Mix Progression
│   │   │   ├── models/           # Model Versions & Drift
│   │   │   ├── overrides/        # Planner Overrides Log
│   │   │   ├── economics/        # Engineering Economics
│   │   │   └── predicted/        # Predicted vs Actual
│   │   ├── integration/          # Connection Fabric
│   │   │   ├── map/              # Source Topology Map
│   │   │   ├── studio/           # Visual Ingestion Pipeline Studio
│   │   │   ├── tables/           # Canonical Data Modeler
│   │   │   ├── events/           # Live Ingestion Event Stream
│   │   │   └── conflicts/        # Systems Reconciliation Queue
│   │   ├── mcp/                  # MCP & AI Governance
│   │   │   ├── agents/           # Agent Registry
│   │   │   ├── playground/       # Tool Testing Sandbox
│   │   │   └── perms/            # Permission Matrix
│   │   ├── orchestration/        # Process Orchestration & 10-Stage Runs
│   │   ├── audit/                # Immutable Provenance & Evidence Gaps
│   │   ├── access/               # Identity, RBAC & Delegations
│   │   └── settings/             # Enterprise Platform Settings
│   ├── layout.tsx                # Root layout & theme provider
│   └── globals.css               # Global styles & scrollbar reset
├── components/
│   ├── layout/                   # AppHeader, AppSidebar, WorkbenchLayout
│   ├── command/                  # Command Center widgets & tables
│   └── common/                   # Shared UI primitives
├── constants/                    # Route definitions & RBAC roles
├── models/                       # Domain TypeScript interfaces
├── services/                     # Business logic & simulation calculators
└── store/                        # Auth & persona state context
```

---

## License

Proprietary enterprise software developed for **Recover / Circularity**. All rights reserved.
