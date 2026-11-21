// Generates src/data/sources.json for the Source Map page. Deterministic.
import { writeFileSync } from 'node:fs';

const out = process.argv[2];
const AS_OF = Date.parse('2026-11-20T09:00:00Z');
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const ago = (min) => new Date(AS_OF - min * 60000).toISOString();

const categories = ['PLM', 'ERP', 'EAM/FSM', 'WMS/OMS', 'CRM', 'IoT', 'Market', 'Sustainability', 'Files'];

const canonicalModels = [
  { id: 'asset', name: 'Asset & component', version: 'v2.3', fields: ['asset_id', 'serial_number', 'product_code', 'bom_revision', 'manufacture_date', 'purchase_cost', 'hours_run', 'site', 'tenant', 'lease_end'] },
  { id: 'condition', name: 'Condition & eligibility', version: 'v2.1', fields: ['condition_grade', 'fault_codes', 'last_inspection', 'residual_life_months', 'cosmetic_score', 'test_result', 'material_declaration'] },
  { id: 'demand', name: 'Demand opportunity', version: 'v1.8', fields: ['buyer_segment', 'listing_price', 'demand_index', 'comparable_price', 'time_to_sale_days', 'region'] },
  { id: 'intervention', name: 'Intervention', version: 'v1.5', fields: ['work_order_id', 'intervention_type', 'labour_hours', 'parts_cost', 'technician', 'completed_at'] },
  { id: 'route', name: 'Route candidate', version: 'v2.0', fields: ['route', 'channel', 'partner', 'est_recovery_value', 'carbon_avoided_kg'] },
  { id: 'decision', name: 'Decision', version: 'v2.2', fields: ['decision_id', 'chosen_route', 'approved_by', 'rationale', 'decided_at'] },
  { id: 'outcome', name: 'Outcome', version: 'v1.6', fields: ['realised_value', 'sold_at', 'recovered_material_kg', 'certificate_id', 'settlement_status'] },
];

const decisionSteps = [
  { id: 'demand_matching', name: 'Demand matching', kind: 'Model', inputs: ['demand', 'route', 'asset'] },
  { id: 'condition_grading', name: 'Condition grading', kind: 'Model', inputs: ['condition', 'asset'] },
  { id: 'resale_price', name: 'Resale price', kind: 'Model', inputs: ['demand', 'condition'] },
  { id: 'prep_cost', name: 'Prep cost and time', kind: 'Model', inputs: ['intervention', 'condition'] },
  { id: 'service_exposure', name: 'Service exposure', kind: 'Model', inputs: ['intervention', 'asset'] },
  { id: 'decision', name: 'Decision', kind: 'Decision step', inputs: ['route', 'decision'] },
  { id: 'reconcile', name: 'Reconcile', kind: 'Decision step', inputs: ['outcome', 'decision'] },
];

// [table, sourceField, model, canonicalField]
const M = (t, f, m, c) => ({ table: t, sourceField: `${t}.${f}`, canonicalModel: m, canonicalField: c });

const systems = [
  {
    id: 'sap-s4', name: 'SAP S/4HANA ERP', category: 'ERP', connectorType: 'ERP', vendor: 'SAP',
    role: 'Asset Financials & Purchase Cost', syncMethod: 'Real-time Webhook', status: 'healthy', lastMin: 2,
    environment: 'Production', authType: 'OAuth 2.0', instanceUrl: 'https://s4.northfield.example/sap/opu/odata', connectedBy: 'Priya Raman · ERP integration owner',
    description: 'System of record for fixed assets, acquisition cost, depreciation and lease billing.',
    tables: [['ANLA', 'Asset master', 48210], ['ANLC', 'Asset values', 48210], ['EQUI', 'Equipment', 61204], ['MARA', 'Material master', 18440], ['EKPO', 'Purchase order items', 124500], ['VBAK', 'Sales documents', 9310]],
    maps: [M('ANLA', 'ANLN1', 'asset', 'asset_id'), M('EQUI', 'SERGE', 'asset', 'serial_number'), M('MARA', 'MATNR', 'asset', 'product_code'), M('ANLC', 'KANSW', 'asset', 'purchase_cost'), M('ANLA', 'AKTIV', 'asset', 'manufacture_date'), M('EQUI', 'SWERK', 'asset', 'site'), M('VBAK', 'NETWR', 'outcome', 'realised_value'), M('VBAK', 'ERDAT', 'outcome', 'sold_at'), M('EKPO', 'NETPR', 'intervention', 'parts_cost')],
    records30d: 124500, successRate: 99.6,
  },
  {
    id: 'manhattan-wms', name: 'Manhattan Active WMS', category: 'WMS/OMS', connectorType: 'WMS', vendor: 'Manhattan Associates',
    role: 'Intake Scanning & Bin Locations', syncMethod: 'Every 5 mins', status: 'healthy', lastMin: 1,
    environment: 'Production', authType: 'OAuth 2.0', instanceUrl: 'https://northfield.sce.manh.com/api', connectedBy: 'Luis Ortega · Warehouse systems',
    description: 'Receives returned assets at Warehouse 1 and Warehouse 2, records scans, bins and putaway.',
    tables: [['receipts', 'Inbound receipts', 32110], ['lpn', 'License plates', 41870], ['locations', 'Bin locations', 6120], ['inventory_snapshot', 'Inventory snapshot', 9100]],
    maps: [M('lpn', 'serial_no', 'asset', 'serial_number'), M('lpn', 'item_id', 'asset', 'product_code'), M('receipts', 'facility_id', 'asset', 'site'), M('receipts', 'received_ts', 'condition', 'last_inspection'), M('locations', 'location_id', 'route', 'channel'), M('inventory_snapshot', 'disposition_code', 'route', 'route')],
    records30d: 89200, successRate: 99.1,
  },
  {
    id: 'sfdc-service', name: 'Salesforce Service Cloud', category: 'CRM', connectorType: 'CRM', vendor: 'Salesforce',
    role: 'Customer Return Authorizations (RMAs)', syncMethod: 'Hourly', status: 'healthy', lastMin: 14,
    environment: 'Production', authType: 'OAuth 2.0', instanceUrl: 'https://northfield.my.salesforce.com', connectedBy: 'Hannah Lee · CRM admin',
    description: 'Return authorisations, customer cases and entitlement data for leased equipment.',
    tables: [['Case', 'Cases', 21400], ['ReturnOrder', 'Return orders', 14350], ['Asset', 'Customer assets', 38200], ['Entitlement', 'Entitlements', 7600], ['Account', 'Accounts', 2310]],
    maps: [M('Asset', 'SerialNumber', 'asset', 'serial_number'), M('Asset', 'AccountId', 'asset', 'tenant'), M('Entitlement', 'EndDate', 'asset', 'lease_end'), M('ReturnOrder', 'Reason__c', 'condition', 'fault_codes'), M('Case', 'Priority', 'demand', 'buyer_segment'), M('ReturnOrder', 'Approved_By__c', 'decision', 'approved_by')],
    records30d: 14350, successRate: 98.7,
  },
  {
    id: 'ptc-windchill', name: 'PTC Windchill PLM', category: 'PLM', connectorType: 'PLM', vendor: 'PTC',
    role: 'Engineering Bill of Materials (BOM)', syncMethod: 'Daily', status: 'warning', lastMin: 240, issue: 'schema_drift',
    statusNote: 'Schema drift', environment: 'Production', authType: 'Service account', instanceUrl: 'https://plm.northfield.example/Windchill/servlet/odata', connectedBy: 'Arjun Mehta · Engineering IT',
    description: 'Engineering BOMs, part revisions and service kits used to value components and plan harvesting.',
    tables: [['WTPart', 'Parts', 18900], ['WTPartUsageLink', 'BOM links', 64000], ['ChangeNotice', 'Change notices', 1200], ['ServiceKit', 'Service kits', 860]],
    maps: [M('WTPart', 'number', 'asset', 'product_code'), M('WTPart', 'revision_code', 'asset', 'bom_revision'), M('WTPartUsageLink', 'parent_number', 'asset', 'asset_id'), M('ServiceKit', 'kit_cost', 'intervention', 'parts_cost'), M('ChangeNotice', 'effective_date', 'condition', 'material_declaration')],
    records30d: 6400, successRate: 91.4,
  },
  {
    id: 'ibm-maximo', name: 'IBM Maximo EAM', category: 'EAM/FSM', connectorType: 'EAM', vendor: 'IBM',
    role: 'Asset service history & work orders', syncMethod: 'Every 15 mins', status: 'healthy', lastMin: 6,
    environment: 'Production', authType: 'API key', instanceUrl: 'https://maximo.northfield.example/maximo/oslc', connectedBy: 'Dev Kapoor · Reliability engineering',
    description: 'Maintenance history, meter readings and failure codes for in-service equipment.',
    tables: [['ASSET', 'Assets', 52300], ['WORKORDER', 'Work orders', 88400], ['METERREADING', 'Meter readings', 410200], ['FAILUREREPORT', 'Failure reports', 12600], ['LABTRANS', 'Labour transactions', 70100]],
    maps: [M('ASSET', 'ASSETNUM', 'asset', 'asset_id'), M('METERREADING', 'READING', 'asset', 'hours_run'), M('FAILUREREPORT', 'FAILURECODE', 'condition', 'fault_codes'), M('WORKORDER', 'WONUM', 'intervention', 'work_order_id'), M('WORKORDER', 'WORKTYPE', 'intervention', 'intervention_type'), M('LABTRANS', 'REGULARHRS', 'intervention', 'labour_hours'), M('WORKORDER', 'ACTFINISH', 'intervention', 'completed_at'), M('ASSET', 'EXPECTEDLIFE', 'condition', 'residual_life_months')],
    records30d: 96100, successRate: 99.3,
  },
  {
    id: 'servicenow-fsm', name: 'ServiceNow Field Service Management', category: 'EAM/FSM', connectorType: 'FSM', vendor: 'ServiceNow',
    role: 'Field interventions & technician notes', syncMethod: 'Every 30 mins', status: 'healthy', lastMin: 22,
    environment: 'Production', authType: 'OAuth 2.0', instanceUrl: 'https://northfield.service-now.com/api/now', connectedBy: 'Hannah Lee · CRM admin',
    description: 'Field work orders, on-site diagnostics and parts consumed during service visits.',
    tables: [['wm_order', 'Work orders', 23100], ['wm_task', 'Work tasks', 41200], ['sm_part_requirement', 'Part requirements', 9800], ['alm_hardware', 'Hardware assets', 30400]],
    maps: [M('wm_order', 'number', 'intervention', 'work_order_id'), M('wm_task', 'assigned_to', 'intervention', 'technician'), M('sm_part_requirement', 'cost', 'intervention', 'parts_cost'), M('wm_task', 'close_notes', 'condition', 'test_result'), M('alm_hardware', 'serial_number', 'asset', 'serial_number')],
    records30d: 41200, successRate: 98.9,
  },
  {
    id: 'siemens-teamcenter', name: 'Siemens Teamcenter', category: 'PLM', connectorType: 'PLM', vendor: 'Siemens',
    role: 'Part revisions & material declarations', syncMethod: 'Daily', status: 'healthy', lastMin: 310,
    environment: 'Production', authType: 'Service account', instanceUrl: 'https://tc.northfield.example/tc/rest', connectedBy: 'Arjun Mehta · Engineering IT',
    description: 'Drive-train part revisions and full material declarations (IMDS) used for recycling yield.',
    tables: [['Item', 'Items', 14200], ['ItemRevision', 'Item revisions', 31800], ['MaterialDeclaration', 'Material declarations', 5400]],
    maps: [M('Item', 'item_id', 'asset', 'product_code'), M('ItemRevision', 'rev_id', 'asset', 'bom_revision'), M('MaterialDeclaration', 'substance_mass', 'condition', 'material_declaration'), M('MaterialDeclaration', 'recyclable_mass', 'route', 'carbon_avoided_kg')],
    records30d: 5400, successRate: 99.8,
  },
  {
    id: 'oracle-erp', name: 'Oracle ERP Cloud', category: 'ERP', connectorType: 'ERP', vendor: 'Oracle',
    role: 'Lease contracts & depreciation', syncMethod: 'Every 6 hours', status: 'healthy', lastMin: 95,
    environment: 'Production', authType: 'OAuth 2.0', instanceUrl: 'https://fa-northfield.oraclecloud.com/fscmRestApi', connectedBy: 'Priya Raman · ERP integration owner',
    description: 'Lease contracts and book values for the Customer B and Customer C portfolios.',
    tables: [['FA_ADDITIONS', 'Asset additions', 22100], ['FA_BOOKS', 'Asset books', 22100], ['OKL_CONTRACTS', 'Lease contracts', 3900], ['AR_INVOICES', 'Receivables invoices', 12800]],
    maps: [M('FA_ADDITIONS', 'TAG_NUMBER', 'asset', 'asset_id'), M('FA_BOOKS', 'COST', 'asset', 'purchase_cost'), M('OKL_CONTRACTS', 'END_DATE', 'asset', 'lease_end'), M('OKL_CONTRACTS', 'CUSTOMER_NAME', 'asset', 'tenant'), M('AR_INVOICES', 'AMOUNT_DUE', 'outcome', 'realised_value'), M('AR_INVOICES', 'STATUS', 'outcome', 'settlement_status')],
    records30d: 38600, successRate: 99.4,
  },
  {
    id: 'aws-iot', name: 'AWS IoT Core', category: 'IoT', connectorType: 'IoT', vendor: 'Amazon Web Services',
    role: 'Runtime telemetry & fault codes', syncMethod: 'Streaming (MQTT)', status: 'healthy', lastMin: 0.5,
    environment: 'Production', authType: 'Service account', instanceUrl: 'https://a1x2y3z4.iot.eu-west-1.amazonaws.com', connectedBy: 'Dev Kapoor · Reliability engineering',
    description: 'Telemetry from connected motors, pumps and controllers: run hours, vibration and fault codes.',
    tables: [['device_shadow', 'Device shadows', 18200], ['telemetry_hourly', 'Hourly telemetry', 1840000], ['fault_events', 'Fault events', 26400]],
    maps: [M('device_shadow', 'thing_name', 'asset', 'serial_number'), M('telemetry_hourly', 'run_hours', 'asset', 'hours_run'), M('fault_events', 'code', 'condition', 'fault_codes'), M('telemetry_hourly', 'vibration_rms', 'condition', 'residual_life_months'), M('telemetry_hourly', 'health_score', 'condition', 'condition_grade')],
    records30d: 1840000, successRate: 99.9,
  },
  {
    id: 'azure-iot', name: 'Azure IoT Hub', category: 'IoT', connectorType: 'IoT', vendor: 'Microsoft',
    role: 'Condition sensors on leased fleet', syncMethod: 'Streaming (AMQP)', status: 'healthy', lastMin: 1,
    environment: 'Production', authType: 'Service account', instanceUrl: 'https://northfield-fleet.azure-devices.net', connectedBy: 'Dev Kapoor · Reliability engineering',
    description: 'Retrofit condition sensors on the Customer A leased fleet (temperature, duty cycle).',
    tables: [['device_twin', 'Device twins', 6400], ['d2c_messages', 'Device messages', 512000]],
    maps: [M('device_twin', 'deviceId', 'asset', 'serial_number'), M('d2c_messages', 'duty_cycle', 'asset', 'hours_run'), M('d2c_messages', 'temp_c', 'condition', 'test_result')],
    records30d: 512000, successRate: 99.7,
  },
  {
    id: 'ritchie-bros', name: 'Ritchie Bros. Market Data', category: 'Market', connectorType: 'Market', vendor: 'RB Global',
    role: 'Comparable auction results & realised prices', syncMethod: 'Daily', status: 'stale', lastMin: 19 * 60, issue: 'stale_feed',
    statusNote: 'No new data for 19 h', environment: 'Production', authType: 'API key', instanceUrl: 'https://api.rbauction.example/v2', connectedBy: 'Remarketing · integration owner',
    description: 'Comparable transactions, realised prices, time-to-sale and buyer demand.',
    tables: [['auction_results', 'Auction results', 41200], ['price_index', 'Price index', 2300]],
    maps: [M('auction_results', 'hammer_price', 'demand', 'comparable_price'), M('auction_results', 'days_listed', 'demand', 'time_to_sale_days'), M('price_index', 'region_code', 'demand', 'region')],
    records30d: 53449, successRate: 95.6,
  },
  {
    id: 'machinio', name: 'Machinio', category: 'Market', connectorType: 'Market', vendor: 'Machinio',
    role: 'Live listings & buyer demand', syncMethod: 'Every 4 hours', status: 'healthy', lastMin: 130,
    environment: 'Production', authType: 'API key', instanceUrl: 'https://api.machinio.example/v1', connectedBy: 'Remarketing · integration owner',
    description: 'Live used-equipment listings and buyer enquiries used to score demand by product class.',
    tables: [['listings', 'Listings', 88200], ['enquiries', 'Buyer enquiries', 4100]],
    maps: [M('listings', 'asking_price', 'demand', 'listing_price'), M('enquiries', 'buyer_type', 'demand', 'buyer_segment'), M('enquiries', 'enquiry_count', 'demand', 'demand_index'), M('listings', 'channel', 'route', 'channel')],
    records30d: 92300, successRate: 98.2,
  },
  {
    id: 'ibm-sterling', name: 'IBM Sterling OMS', category: 'WMS/OMS', connectorType: 'OMS', vendor: 'IBM',
    role: 'Resale orders & fulfilment', syncMethod: 'Every 10 mins', status: 'healthy', lastMin: 8,
    environment: 'Production', authType: 'API key', instanceUrl: 'https://oms.northfield.example/smcfs/restapi', connectedBy: 'Luis Ortega · Warehouse systems',
    description: 'Orders for refurbished equipment and harvested parts, through to shipment.',
    tables: [['YFS_ORDER_HEADER', 'Order headers', 7800], ['YFS_ORDER_LINE', 'Order lines', 15200], ['YFS_SHIPMENT', 'Shipments', 6900]],
    maps: [M('YFS_ORDER_LINE', 'UNIT_PRICE', 'outcome', 'realised_value'), M('YFS_SHIPMENT', 'ACTUAL_SHIP_DATE', 'outcome', 'sold_at'), M('YFS_ORDER_HEADER', 'ENTERPRISE_CODE', 'route', 'channel'), M('YFS_ORDER_HEADER', 'ORDER_TYPE', 'route', 'route')],
    records30d: 29900, successRate: 99.2,
  },
  {
    id: 'optoro', name: 'Optoro', category: 'WMS/OMS', connectorType: 'Returns', vendor: 'Optoro',
    role: 'Returns disposition & recommerce outcomes', syncMethod: 'Hourly', status: 'healthy', lastMin: 41,
    environment: 'Production', authType: 'OAuth 2.0', instanceUrl: 'https://api.optoro.example/v3', connectedBy: 'Remarketing · integration owner',
    description: 'Disposition recommendations and recommerce results for small electronics returns.',
    tables: [['dispositions', 'Dispositions', 11900], ['recommerce_sales', 'Recommerce sales', 5200]],
    maps: [M('dispositions', 'recommended_path', 'route', 'route'), M('dispositions', 'expected_recovery', 'route', 'est_recovery_value'), M('recommerce_sales', 'sale_price', 'outcome', 'realised_value')],
    records30d: 17100, successRate: 97.9,
  },
  {
    id: 'sap-ariba', name: 'SAP Ariba', category: 'ERP', connectorType: 'Procurement', vendor: 'SAP',
    role: 'Supplier quotes for parts & refurbishment', syncMethod: 'Every 6 hours', status: 'warning', lastMin: 200, issue: 'token_expiring',
    statusNote: 'Token expires in 3 days', environment: 'Production', authType: 'OAuth 2.0', instanceUrl: 'https://openapi.ariba.com/api/sourcing-reporting', connectedBy: 'Procurement · Marta Silva',
    description: 'Supplier quotes for replacement parts and third-party refurbishment services.',
    tables: [['quotes', 'Quotes', 3100], ['suppliers', 'Suppliers', 640], ['contracts', 'Contracts', 280]],
    maps: [M('quotes', 'unit_price', 'intervention', 'parts_cost'), M('quotes', 'lead_time_days', 'intervention', 'labour_hours'), M('suppliers', 'supplier_name', 'route', 'partner')],
    records30d: 4020, successRate: 96.8,
  },
  {
    id: 'persefoni', name: 'Persefoni', category: 'Sustainability', connectorType: 'Carbon', vendor: 'Persefoni',
    role: 'Carbon factors & avoided-emissions reporting', syncMethod: 'Weekly', status: 'healthy', lastMin: 2 * 24 * 60,
    environment: 'Production', authType: 'API key', instanceUrl: 'https://api.persefoni.example/v1', connectedBy: 'ESG reporting · Nadia Okoye',
    description: 'Emission factors per material and product class; receives avoided-emissions results.',
    tables: [['emission_factors', 'Emission factors', 1800], ['disclosures', 'Disclosures', 120]],
    maps: [M('emission_factors', 'kgco2e_per_kg', 'route', 'carbon_avoided_kg'), M('disclosures', 'avoided_tco2e', 'outcome', 'recovered_material_kg')],
    records30d: 1920, successRate: 100,
  },
  {
    id: 'sims-lifecycle', name: 'Sims Lifecycle Services', category: 'Sustainability', connectorType: 'ITAD', vendor: 'Sims Limited',
    role: 'Recycling certificates & material recovery', syncMethod: 'Daily', status: 'healthy', lastMin: 7 * 60,
    environment: 'Production', authType: 'API key', instanceUrl: 'https://portal.simslifecycle.example/api', connectedBy: 'ESG reporting · Nadia Okoye',
    description: 'Certificates of recycling and recovered material weights for assets sent to material recovery.',
    tables: [['certificates', 'Certificates', 2400], ['material_weights', 'Material weights', 9600], ['pickups', 'Pickups', 640]],
    maps: [M('certificates', 'certificate_no', 'outcome', 'certificate_id'), M('material_weights', 'net_kg', 'outcome', 'recovered_material_kg'), M('pickups', 'partner_site', 'route', 'partner')],
    records30d: 12640, successRate: 99.0,
  },
  {
    id: 'sftp-grading', name: 'SFTP CSV drop', category: 'Files', connectorType: 'SFTP', vendor: 'Partner upload',
    role: 'Partner grading sheets & manifests', syncMethod: 'File watcher (hourly)', status: 'failed', lastMin: 6 * 60, issue: 'auth_failed',
    statusNote: 'Authentication failed', environment: 'Production', authType: 'Service account', instanceUrl: 'sftp://files.northfield.example/inbound/grading', connectedBy: 'Luis Ortega · Warehouse systems',
    description: 'Grading sheets and pickup manifests uploaded by repair partners as CSV files.',
    tables: [['grading_sheet.csv', 'Grading sheets', 8400], ['manifest.csv', 'Manifests', 2100]],
    maps: [M('grading_sheet.csv', 'grade', 'condition', 'condition_grade'), M('grading_sheet.csv', 'cosmetic', 'condition', 'cosmetic_score'), M('grading_sheet.csv', 'inspected_on', 'condition', 'last_inspection'), M('manifest.csv', 'serial', 'asset', 'serial_number')],
    records30d: 10500, successRate: 82.4,
  },
  {
    id: 'sharepoint-docs', name: 'SharePoint inspection library', category: 'Files', connectorType: 'Files', vendor: 'Microsoft',
    role: 'Inspection photos & approval memos', syncMethod: 'Daily', status: 'healthy', lastMin: 9 * 60,
    environment: 'Production', authType: 'OAuth 2.0', instanceUrl: 'https://northfield.sharepoint.com/sites/inspections', connectedBy: 'Marcus Vance · Operations',
    description: 'Inspection photos and signed approval memos linked to cases.',
    tables: [['Inspection Photos', 'Inspection photos', 42100], ['Approval Memos', 'Approval memos', 1900]],
    maps: [M('Approval Memos', 'Approver', 'decision', 'approved_by'), M('Approval Memos', 'Summary', 'decision', 'rationale'), M('Inspection Photos', 'Created', 'condition', 'last_inspection')],
    records30d: 44000, successRate: 99.5,
  },
];

const SYNC_MIN = {
  'Real-time Webhook': 2, 'Every 5 mins': 5, 'Every 10 mins': 10, 'Every 15 mins': 15, 'Every 30 mins': 30, 'Hourly': 60,
  'Every 4 hours': 240, 'Every 6 hours': 360, 'Daily': 1440, 'Weekly': 10080, 'Streaming (MQTT)': 60, 'Streaming (AMQP)': 60, 'File watcher (hourly)': 60,
};

const sources = systems.map((s) => {
  const step = SYNC_MIN[s.syncMethod] ?? 60;
  const per = Math.max(20, Math.round(s.records30d / Math.max(1, (30 * 1440) / step)));
  const syncHistory = [];
  for (let i = 0; i < 5; i++) {
    const at = s.lastMin + i * step;
    let status = 'success';
    if (s.status === 'failed' && i < 3) status = 'failed';
    else if (s.status === 'warning' && i === 0) status = 'partial';
    else if (s.status === 'stale' && i === 0) status = 'failed';
    const records = status === 'failed' ? 0 : Math.round(per * (0.85 + rnd() * 0.3));
    syncHistory.push({ at: ago(at), status, records, durationSec: status === 'failed' ? ri(28, 32) : ri(4, 58) });
  }
  const failedRecords = Math.round((s.records30d * (100 - s.successRate)) / 100);
  return {
    id: s.id, name: s.name, category: s.category, connectorType: s.connectorType, vendor: s.vendor, role: s.role, description: s.description,
    syncMethod: s.syncMethod, status: s.status, issue: s.issue ?? null, statusNote: s.statusNote ?? null,
    environment: s.environment, authType: s.authType, instanceUrl: s.instanceUrl, connectedBy: s.connectedBy,
    lastSyncAt: ago(s.lastMin), records30d: s.records30d, successRate: s.successRate, failedRecords,
    tables: s.tables.map(([name, label, rows]) => ({ name, label, rows })),
    fieldMappings: s.maps.map((m) => ({ sourceField: m.sourceField, canonicalModel: m.canonicalModel, canonicalField: m.canonicalField, confidence: s.issue === 'schema_drift' && m.sourceField.includes('revision') ? 0.62 : Math.round((0.86 + rnd() * 0.14) * 100) / 100 })),
    syncHistory,
  };
});

// Connector catalogue for the "Add source" wizard.
const C = (id, name, vendor, category, connectorType, role, syncMethod, authTypes, tables, maps) => ({
  id, name, vendor, category, connectorType, role, syncMethod, authTypes,
  tables: tables.map(([n, label, rows]) => ({ name: n, label, rows })),
  mappingTemplate: maps.map(([t, f, m, c]) => ({ table: t, sourceField: `${t}.${f}`, canonicalModel: m, canonicalField: c })),
});
const catalogue = [
  C('cat-aras', 'Aras Innovator', 'Aras', 'PLM', 'PLM', 'Part BOMs & revisions', 'Daily', ['OAuth 2.0', 'Service account'], [['Part', 'Parts', 9200], ['Part BOM', 'BOM links', 31000], ['ECO', 'Change orders', 700]], [['Part', 'item_number', 'asset', 'product_code'], ['Part', 'major_rev', 'asset', 'bom_revision'], ['ECO', 'effective_date', 'condition', 'material_declaration']]),
  C('cat-bentley', 'Bentley AssetWise', 'Bentley', 'PLM', 'PLM', 'Engineering asset registry', 'Daily', ['API key', 'Service account'], [['assets', 'Assets', 7300], ['documents', 'Documents', 12000]], [['assets', 'asset_code', 'asset', 'asset_id'], ['assets', 'install_date', 'asset', 'manufacture_date']]),
  C('cat-dynamics', 'Microsoft Dynamics 365 Finance', 'Microsoft', 'ERP', 'ERP', 'Fixed assets & leasing', 'Every 6 hours', ['OAuth 2.0'], [['AssetTable', 'Fixed assets', 15400], ['AssetBook', 'Asset books', 15400], ['CustInvoiceJour', 'Customer invoices', 8800]], [['AssetTable', 'AssetId', 'asset', 'asset_id'], ['AssetBook', 'AcquisitionPrice', 'asset', 'purchase_cost'], ['CustInvoiceJour', 'InvoiceAmount', 'outcome', 'realised_value']]),
  C('cat-netsuite', 'Oracle NetSuite', 'Oracle', 'ERP', 'ERP', 'Item fulfilment & invoicing', 'Hourly', ['OAuth 2.0', 'API key'], [['item', 'Items', 5100], ['invoice', 'Invoices', 6400]], [['item', 'itemid', 'asset', 'product_code'], ['invoice', 'total', 'outcome', 'realised_value']]),
  C('cat-ifs', 'IFS Cloud FSM', 'IFS', 'EAM/FSM', 'FSM', 'Service work orders', 'Every 30 mins', ['OAuth 2.0', 'Service account'], [['work_order', 'Work orders', 18000], ['task_step', 'Task steps', 52000], ['material_use', 'Material use', 11000]], [['work_order', 'wo_no', 'intervention', 'work_order_id'], ['task_step', 'technician_id', 'intervention', 'technician'], ['material_use', 'cost', 'intervention', 'parts_cost']]),
  C('cat-hxgn', 'HxGN EAM', 'Hexagon', 'EAM/FSM', 'EAM', 'Maintenance history & meters', 'Every 15 mins', ['API key'], [['R5OBJECTS', 'Equipment', 21000], ['R5EVENTS', 'Work orders', 64000], ['R5READINGS', 'Meter readings', 230000]], [['R5OBJECTS', 'OBJ_CODE', 'asset', 'asset_id'], ['R5READINGS', 'REA_READING', 'asset', 'hours_run'], ['R5EVENTS', 'EVT_CODE', 'intervention', 'work_order_id']]),
  C('cat-blueyonder', 'Blue Yonder WMS', 'Blue Yonder', 'WMS/OMS', 'WMS', 'Receiving & inventory', 'Every 5 mins', ['OAuth 2.0', 'API key'], [['rcvlin', 'Receipt lines', 24000], ['invdtl', 'Inventory detail', 31000]], [['rcvlin', 'lotnum', 'asset', 'serial_number'], ['invdtl', 'wh_id', 'asset', 'site']]),
  C('cat-shiplane', 'ShipLane TMS', 'ShipLane', 'WMS/OMS', 'TMS', 'Outbound shipments & freight cost', 'Hourly', ['API key'], [['shipments', 'Shipments', 8100], ['rates', 'Freight rates', 900]], [['shipments', 'delivered_at', 'outcome', 'sold_at'], ['rates', 'lane_cost', 'route', 'est_recovery_value']]),
  C('cat-hubspot', 'HubSpot CRM', 'HubSpot', 'CRM', 'CRM', 'Buyer accounts & deals', 'Hourly', ['OAuth 2.0', 'API key'], [['companies', 'Companies', 4200], ['deals', 'Deals', 6100]], [['companies', 'industry', 'demand', 'buyer_segment'], ['deals', 'amount', 'demand', 'listing_price']]),
  C('cat-dynamics-cs', 'Dynamics 365 Customer Service', 'Microsoft', 'CRM', 'CRM', 'Return cases & entitlements', 'Hourly', ['OAuth 2.0'], [['incident', 'Cases', 13000], ['entitlement', 'Entitlements', 4100]], [['incident', 'casetypecode', 'condition', 'fault_codes'], ['entitlement', 'enddate', 'asset', 'lease_end']]),
  C('cat-thingworx', 'PTC ThingWorx', 'PTC', 'IoT', 'IoT', 'Machine telemetry', 'Streaming (MQTT)', ['API key', 'Service account'], [['things', 'Things', 5200], ['value_stream', 'Value stream', 900000]], [['things', 'serialNumber', 'asset', 'serial_number'], ['value_stream', 'runtime_h', 'asset', 'hours_run'], ['value_stream', 'alarm_code', 'condition', 'fault_codes']]),
  C('cat-gcp-iot', 'Google Cloud Pub/Sub telemetry', 'Google Cloud', 'IoT', 'IoT', 'Sensor events', 'Streaming (MQTT)', ['Service account'], [['events', 'Events', 610000]], [['events', 'device_id', 'asset', 'serial_number'], ['events', 'temp_c', 'condition', 'test_result']]),
  C('cat-ironplanet', 'IronPlanet Marketplace', 'RB Global', 'Market', 'Market', 'Online auction results', 'Daily', ['API key'], [['results', 'Results', 22000]], [['results', 'final_bid', 'demand', 'comparable_price'], ['results', 'region', 'demand', 'region']]),
  C('cat-ebay', 'eBay Business Supply', 'eBay', 'Market', 'Market', 'Listings & sold prices', 'Every 4 hours', ['OAuth 2.0'], [['listings', 'Listings', 51000], ['sold_items', 'Sold items', 14000]], [['listings', 'price', 'demand', 'listing_price'], ['sold_items', 'sold_price', 'outcome', 'realised_value'], ['sold_items', 'days_to_sell', 'demand', 'time_to_sale_days']]),
  C('cat-sphera', 'Sphera Product Sustainability', 'Sphera', 'Sustainability', 'LCA', 'Life-cycle emission factors', 'Weekly', ['API key'], [['lca_datasets', 'LCA datasets', 3100]], [['lca_datasets', 'gwp100', 'route', 'carbon_avoided_kg']]),
  C('cat-watershed', 'Watershed', 'Watershed', 'Sustainability', 'Carbon', 'Scope 3 reporting', 'Weekly', ['API key', 'OAuth 2.0'], [['activities', 'Activities', 8200], ['factors', 'Factors', 1400]], [['factors', 'kgco2e', 'route', 'carbon_avoided_kg'], ['activities', 'material_kg', 'outcome', 'recovered_material_kg']]),
  C('cat-s3', 'Amazon S3 bucket', 'Amazon Web Services', 'Files', 'Files', 'Bulk CSV / Parquet exports', 'Daily', ['Service account', 'API key'], [['exports/assets.parquet', 'Asset exports', 40000], ['exports/grades.csv', 'Grade exports', 9000]], [['exports/assets.parquet', 'serial', 'asset', 'serial_number'], ['exports/grades.csv', 'grade', 'condition', 'condition_grade']]),
  C('cat-sftp', 'SFTP folder', 'Generic', 'Files', 'SFTP', 'Partner file drops', 'File watcher (hourly)', ['Service account'], [['inbound/*.csv', 'Inbound CSV files', 5000]], [['inbound/*.csv', 'serial', 'asset', 'serial_number'], ['inbound/*.csv', 'grade', 'condition', 'condition_grade']]),
];

// 24 hourly integration-health readings (last 24 h), for the KPI sparkline.
const healthTrend = Array.from({ length: 24 }, (_, i) => Math.round((96.2 + Math.sin(i / 2.3) * 0.9 + rnd() * 0.8 - (i > 17 && i < 21 ? 1.4 : 0)) * 10) / 10);

const data = {
  asOf: '2026-11-20T09:00:00Z',
  categories,
  canonicalModels: canonicalModels.map(({ id, name, version, fields }) => ({ id, name, version, fields })),
  decisionSteps,
  syncIntervals: Object.keys(SYNC_MIN).map((label) => ({ label, minutes: SYNC_MIN[label] })),
  environments: ['Production', 'Staging', 'Sandbox'],
  healthTrend,
  catalogue,
  sources,
};
writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
console.log(`wrote ${sources.length} sources, ${catalogue.length} catalogue entries`);
