'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown, message, Modal, Segmented } from 'antd';
import type { MenuProps } from 'antd';
import { ReactFlowProvider } from '@xyflow/react';
import {
  RotateCcw,
  Plus,
  Play,
  BookOpen,
  History,
  Settings2,
  MoreHorizontal,
  Copy,
  Trash2,
  Save,
  ShieldCheck,
  Send,
  Pause,
} from 'lucide-react';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryParam } from '@/components/integration/useQueryParam';
import { ProgressBar, Skeleton } from '@/components/ui';
import { IntTable } from '@/components/integration/IntTable';
import { FilterField, MoreFilters, SearchField } from '@/components/integration/Filters';
import { BTN_GHOST, SELECT } from '@/components/integration/styles';
import { workflowService, validateGraph } from '@/services/workflowService';
import type { CreateWorkflowInput, ValidationIssue, Workflow, WorkflowDetailsPatch } from '@/services/workflowService';
import { useWorkflowEditor, toFlow, toModel } from '@/components/workflow/useWorkflowEditor';
import { WorkflowCanvas } from '@/components/workflow/WorkflowCanvas';
import type { CanvasApi } from '@/components/workflow/WorkflowCanvas';
import type { CanvasView } from '@/components/workflow/WorkflowNode';
import { NodePalette } from '@/components/workflow/NodePalette';
import { NodePropertiesPanel } from '@/components/workflow/NodePropertiesPanel';
import {
  DocumentationModal,
  NewWorkflowModal,
  RunHistoryModal,
  ValidationModal,
  WorkflowSettingsModal,
  formatRunTime,
} from '@/components/workflow/WorkflowModals';

const statusTone = (wf: Workflow) => {
  if (!wf.active) return { label: 'Paused', bg: '#FEF3C7', text: '#D97706', dot: '#F59E0B' };
  if (wf.status === 'Failing') return { label: 'Failing', bg: '#FEE2E2', text: '#B91C1C', dot: '#EF4444' };
  if (wf.status === 'Draft') return { label: 'Draft', bg: '#F1F5F9', text: '#475569', dot: '#94A3B8' };
  return { label: 'Published', bg: '#DCFCE7', text: '#15803D', dot: '#10B981' };
};

const runTone = (s: Workflow['lastRunStatus']) =>
  s === 'Success' ? { text: '#15803D', dot: '#10B981' } : s === 'Failed' ? { text: '#DC2626', dot: '#EF4444' } : { text: '#64748B', dot: '#CBD5E1' };

/** Labels kept from the original filter; values are the full system names. */
const SYSTEM_FILTER_LABELS: Record<string, string> = {
  'SAP S/4HANA': 'SAP S/4HANA',
  'Manhattan Active Warehouse Management': 'Manhattan WMS',
  'Oracle Lease and Finance Management': 'Oracle Lease',
  'Sims Lifecycle Services': 'Sims Lifecycle',
};

const secondaryBtn =
  'flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-white border border-[#E2E8F0] hover:border-gray-400 rounded-xl text-xs font-semibold text-[#141416] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

function IntegrationStudio() {
  // Lands on the All workflows list; opening a workflow switches to the canvas.
  const [viewMode, setViewMode] = useState<'canvas' | 'list'>('list');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('WF-102');
  const [canvasTab, setCanvasTab] = useState<CanvasView>('Details');
  const [isExpandedCanvas, setIsExpandedCanvas] = useState<boolean>(false);

  // Directory filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [systemFilter, setSystemFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState<'recent' | 'success' | 'alpha'>('recent');
  const [checked, setChecked] = useState<string[]>([]);

  // Modals & async flags
  const [modal, setModal] = useState<null | 'new' | 'settings' | 'history' | 'docs' | 'validation'>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'publish' | 'toggle'>(null);

  const allQ = useServiceQuery(() => workflowService.all(), [], { subscribe: workflowService.subscribe });
  const listQ = useServiceQuery(
    () => workflowService.list({ search, type: typeFilter, system: systemFilter, status: statusFilter, sort }),
    [search, typeFilter, systemFilter, statusFilter, sort],
    { subscribe: workflowService.subscribe },
  );
  const workflows = allQ.data;
  const currentWorkflow = workflows?.find((w) => w.id === selectedWorkflowId) ?? workflows?.[0];

  // ------------------------------------------------------------ canvas editor
  const editor = useWorkflowEditor();
  const { load, getModel } = editor;
  const canvasApi = useRef<CanvasApi | null>(null);
  const loadedRef = useRef<{ id: string; obj: Workflow } | null>(null);
  const [loadKey, setLoadKey] = useState('');

  // Load the selected workflow into the editor; refresh from the store when it changes and there is no local draft.
  useEffect(() => {
    if (!currentWorkflow || running) return;
    const prev = loadedRef.current;
    if (prev && prev.id === currentWorkflow.id) {
      if (prev.obj === currentWorkflow) return;
      loadedRef.current = { id: currentWorkflow.id, obj: currentWorkflow };
      if (editor.dirty) return;
      if (JSON.stringify(toModel(toFlow(currentWorkflow))) === JSON.stringify(getModel())) return;
      load(currentWorkflow);
      return;
    }
    loadedRef.current = { id: currentWorkflow.id, obj: currentWorkflow };
    load(currentWorkflow);
    setLoadKey(currentWorkflow.id);
  }, [currentWorkflow, running, editor.dirty, load, getModel]);

  const selectedNodes = editor.nodes.filter((n) => n.selected);
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : undefined;

  const confirmDiscard = (then: () => void) => {
    if (!editor.dirty) return then();
    Modal.confirm({
      title: 'Discard unsaved canvas changes?',
      content: `Your edits to ${currentWorkflow?.name ?? 'this workflow'} have not been saved.`,
      okText: 'Discard',
      cancelText: 'Keep editing',
      onOk: () => {
        editor.markSaved();
        then();
      },
    });
  };

  const handleOpenCanvas = (id: string) => {
    if (id === currentWorkflow?.id) {
      setViewMode('canvas');
      return;
    }
    confirmDiscard(() => {
      setSelectedWorkflowId(id);
      setViewMode('canvas');
    });
  };

  // ------------------------------------------------------------ service actions
  const saveDraft = useCallback(async () => {
    if (!currentWorkflow) return false;
    await workflowService.save(currentWorkflow.id, getModel());
    editor.markSaved();
    return true;
  }, [currentWorkflow, getModel, editor]);

  const handleSave = async () => {
    if (!currentWorkflow) return;
    setBusy('save');
    try {
      await saveDraft();
      message.success(`Saved ${currentWorkflow.code}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleValidate = () => {
    const found = validateGraph(getModel());
    setIssues(found);
    if (!found.length) message.success('Validation passed: no issues found');
    else setModal('validation');
  };

  const handlePublish = async (wf: Workflow | undefined = currentWorkflow) => {
    if (!wf) return;
    const isCurrent = wf.id === currentWorkflow?.id;
    if (isCurrent) {
      const errors = validateGraph(getModel()).filter((i) => i.level === 'error');
      if (errors.length) {
        setIssues(validateGraph(getModel()));
        setModal('validation');
        return;
      }
    }
    setBusy('publish');
    try {
      if (isCurrent && editor.dirty) await saveDraft();
      const res = await workflowService.publish(wf.id);
      message.success(`Published ${res.code} ${res.version}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleToggleActive = async (wf: Workflow | undefined = currentWorkflow) => {
    if (!wf) return;
    setBusy('toggle');
    try {
      const res = await workflowService.toggleActive(wf.id);
      message.success(`${res.code} ${res.active ? 'resumed' : 'paused'}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleRun = async (wf: Workflow | undefined = currentWorkflow) => {
    if (!wf || running) return;
    const isCurrent = wf.id === currentWorkflow?.id;
    setRunning(true);
    try {
      if (isCurrent && editor.dirty) await saveDraft();
      const hide = message.loading({ content: `Running ${wf.name}…`, key: 'wf-run', duration: 0 });
      const run = await workflowService.run(wf.id, { onNodeStatus: isCurrent ? editor.setNodeStatus : undefined });
      hide();
      if (run.status === 'Success') message.success({ content: `Run ${run.id} succeeded · ${run.records} records`, key: 'wf-run' });
      else message.error({ content: `Run ${run.id} failed. Check the red nodes.`, key: 'wf-run' });
    } catch (e) {
      message.error({ content: (e as Error).message, key: 'wf-run' });
    } finally {
      setRunning(false);
    }
  };

  const handleDuplicateWorkflow = async (wf: Workflow) => {
    try {
      const copy = await workflowService.duplicate(wf.id);
      message.success(`Created ${copy.code} from ${wf.code}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleDeleteWorkflows = (ids: string[]) => {
    if (!ids.length) return;
    Modal.confirm({
      title: ids.length === 1 ? `Delete ${ids[0]}?` : `Delete ${ids.length} workflows?`,
      content: 'The workflow definition and its run history are removed.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        for (const id of ids) await workflowService.remove(id);
        if (currentWorkflow && ids.includes(currentWorkflow.id)) editor.markSaved();
        setChecked((c) => c.filter((x) => !ids.includes(x)));
        message.success(ids.length === 1 ? `Deleted ${ids[0]}` : `Deleted ${ids.length} workflows`);
      },
    });
  };

  const handleCreate = async (input: CreateWorkflowInput) => {
    try {
      const wf = await workflowService.create(input);
      setModal(null);
      message.success(`Created ${wf.code}`);
      confirmDiscard(() => {
        setSelectedWorkflowId(wf.id);
        setViewMode('canvas');
      });
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleSaveSettings = async (patch: WorkflowDetailsPatch) => {
    if (!currentWorkflow) return;
    try {
      await workflowService.save(currentWorkflow.id, patch);
      setModal(null);
      message.success('Workflow settings saved');
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  // ------------------------------------------------------------ node actions
  const duplicateNodes = (ids?: string[]) => {
    const created = editor.duplicate(ids);
    if (created.length) message.success(`Duplicated ${created.length} node${created.length > 1 ? 's' : ''}`);
  };
  const deleteNodes = (ids: string[]) => {
    editor.deleteNodes(ids);
    message.success(`Deleted ${ids.length} node${ids.length > 1 ? 's' : ''} and their connections`);
  };

  // ------------------------------------------------------------ directory data
  const systemOptions = useMemo(() => {
    const names = Array.from(new Set((workflows ?? []).map((w) => w.sourceSystemName)));
    const known = Object.keys(SYSTEM_FILTER_LABELS);
    return [...known, ...names.filter((n) => !known.includes(n))];
  }, [workflows]);

  const rows = listQ.data ?? [];
  const allChecked = rows.length > 0 && rows.every((r) => checked.includes(r.id));
  const filtersActive = !!search || typeFilter !== 'all' || systemFilter !== 'all' || statusFilter !== 'all';
  const clearFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setSystemFilter('all');
    setStatusFilter('all');
  };

  const rowMenu = (wf: Workflow): MenuProps => ({
    items: [
      { key: 'open', label: 'Open in canvas' },
      { key: 'run', label: 'Run now', disabled: running || !wf.active },
      { key: 'publish', label: wf.status === 'Published' && !wf.hasUnpublishedChanges ? 'Republish' : 'Publish' },
      { key: 'toggle', label: wf.active ? 'Pause' : 'Resume' },
      { key: 'duplicate', label: 'Duplicate' },
      { type: 'divider' },
      { key: 'delete', label: 'Delete', danger: true },
    ],
    onClick: ({ key }) => {
      if (key === 'open') handleOpenCanvas(wf.id);
      if (key === 'run') void handleRun(wf);
      if (key === 'publish') void handlePublish(wf);
      if (key === 'toggle') void handleToggleActive(wf);
      if (key === 'duplicate') void handleDuplicateWorkflow(wf);
      if (key === 'delete') handleDeleteWorkflows([wf.id]);
    },
  });

  const tone = currentWorkflow ? statusTone(currentWorkflow) : null;
  const lastRun = currentWorkflow ? runTone(currentWorkflow.lastRunStatus) : null;

  return (
    <div className="space-y-6 w-full pb-16 font-sans text-[#141416]">
      {/* One row: list / canvas switch, plus the current workflow's settings, history and the docs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] pb-3">
        <Segmented<'list' | 'canvas'>
          value={viewMode}
          onChange={setViewMode}
          aria-label="Workflow view"
          options={[
            { value: 'list', label: <span className="text-xs font-semibold">All workflows ({workflows?.length ?? '…'})</span> },
            {
              value: 'canvas',
              label: <span className="text-xs font-semibold">Canvas{currentWorkflow ? ` · ${currentWorkflow.code}` : ''}</span>,
            },
          ]}
        />
        <div className="flex flex-wrap items-center gap-1">
          {viewMode === 'canvas' && (
            <>
              <button type="button" onClick={() => setModal('settings')} disabled={!currentWorkflow} className={BTN_GHOST}>
                <Settings2 className="h-3.5 w-3.5" />
                <span>Settings</span>
              </button>
              <button type="button" onClick={() => setModal('history')} disabled={!currentWorkflow} className={BTN_GHOST}>
                <History className="h-3.5 w-3.5" />
                <span>Run history</span>
              </button>
            </>
          )}
          <button type="button" onClick={() => setModal('docs')} className={BTN_GHOST}>
            <BookOpen className="h-3.5 w-3.5" />
            <span>Documentation</span>
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MODE 1: VISUAL CANVAS STUDIO (IMAGE 1)                  */}
      {/* ======================================================== */}
      {viewMode === 'canvas' && allQ.initialLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 items-start" aria-busy="true">
          <div className="lg:col-span-3 bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-3 w-20" />
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
          <div className="order-first md:col-span-2 lg:order-none lg:col-span-6 bg-white border border-[#E2E8F0] rounded-2xl shadow-2xs overflow-hidden">
            <div className="p-3 border-b border-[#E2E8F0] flex gap-3">
              <Skeleton className="h-7 w-1/2" />
              <Skeleton className="h-7 w-1/3" />
            </div>
            <div className="h-[540px] p-8 flex gap-8 items-start bg-[#FAFBFB]">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-1/4 rounded-xl" />
              ))}
            </div>
          </div>
          <div className="lg:col-span-3 bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-16 w-full" />
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-3.5 w-full" />
            ))}
            <Skeleton className="h-9 w-full rounded-xl" />
          </div>
        </div>
      )}

      {viewMode === 'canvas' && allQ.error && !workflows && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8 shadow-2xs text-center text-xs">
          <div className="font-bold text-[#141416]">Could not load workflows</div>
          <div className="text-[#64748B] mt-1">{allQ.error.message}</div>
          <button onClick={allQ.refetch} className="mt-3 px-4 py-2 bg-white border border-[#E2E8F0] hover:border-gray-400 rounded-xl text-xs font-semibold cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {viewMode === 'canvas' && workflows && !currentWorkflow && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8 shadow-2xs text-center text-xs">
          <div className="font-bold text-[#141416]">No workflows yet</div>
          <div className="text-[#64748B] mt-1">Create a workflow to start building on the canvas.</div>
          <button
            onClick={() => setModal('new')}
            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-[#FFD600] hover:bg-[#F2CB00] rounded-xl text-xs font-bold text-black cursor-pointer"
          >
            <Plus size={14} /> New workflow
          </button>
        </div>
      )}

      {viewMode === 'canvas' && currentWorkflow && tone && lastRun && (
        <ReactFlowProvider>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 items-start">
            {/* LEFT PANEL: Component Palette & Sources (col-span-3) */}
            {!isExpandedCanvas && <NodePalette onAdd={(t) => canvasApi.current?.addAtCenter(t)} disabled={running} />}

            {/* CENTER CANVAS PANEL: Interactive Node Graph (col-span-6 or 9) */}
            <div
              className={`order-first md:col-span-2 lg:order-none ${isExpandedCanvas ? 'lg:col-span-9' : 'lg:col-span-6'
                } min-w-0 bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-2xs flex flex-col`}
            >
              <WorkflowCanvas
                editor={editor}
                view={canvasTab}
                onViewChange={setCanvasTab}
                expanded={isExpandedCanvas}
                onToggleExpanded={() => setIsExpandedCanvas((v) => !v)}
                loadKey={loadKey}
                apiRef={canvasApi}
                readOnly={running}
              />
            </div>

            {/* RIGHT PANEL: Node properties when a node is selected, otherwise Workflow details (col-span-3) */}
            {selectedNode ? (
              <NodePropertiesPanel
                key={selectedNode.id}
                node={selectedNode}
                readOnly={running}
                onChange={(patch, field) => editor.updateNodeData(selectedNode.id, patch, field)}
                onDuplicate={() => duplicateNodes([selectedNode.id])}
                onDelete={() => deleteNodes([selectedNode.id])}
                onClose={() => editor.selectOnly(null)}
              />
            ) : selectedNodes.length > 1 ? (
              <div className="min-w-0 lg:col-span-3 bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-4">
                <h2 className="text-sm font-bold text-[#141416] tracking-tight m-0">{selectedNodes.length} nodes selected</h2>
                <div className="flex flex-wrap gap-1.5">
                  {selectedNodes.map((n) => (
                    <span key={n.id} className="px-2 py-0.5 bg-[#F1F5F9] border border-[#E2E8F0] rounded-md text-[10px] font-medium text-[#475569]">
                      {n.data.label}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => duplicateNodes()} disabled={running} className={secondaryBtn}>
                    <Copy size={13} />
                    <span>Duplicate</span>
                  </button>
                  <button onClick={() => deleteNodes(selectedNodes.map((n) => n.id))} disabled={running} className={secondaryBtn}>
                    <Trash2 size={13} />
                    <span>Delete</span>
                  </button>
                </div>
                <button onClick={() => editor.selectOnly(null)} className="text-[11px] font-semibold text-[#64748B] hover:text-[#141416] cursor-pointer">
                  Clear selection
                </button>
              </div>
            ) : (
              <div className="min-w-0 lg:col-span-3 bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-[#141416] tracking-tight m-0">Workflow details</h2>
                  {editor.dirty && <span className="text-[10px] font-bold text-[#D97706]">Unsaved changes</span>}
                </div>

                <div className="space-y-3.5 text-xs">
                  <div>
                    <div className="text-[#64748B] text-[11px] font-semibold mb-1">Name</div>
                    <div className="font-bold text-[#141416] leading-snug">{currentWorkflow.name}</div>
                  </div>

                  <div>
                    <div className="text-[#64748B] text-[11px] font-semibold mb-1">Description</div>
                    <div className="text-[#475569] leading-relaxed">{currentWorkflow.description}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#F1F5F9]">
                    <div>
                      <div className="text-[#64748B] text-[11px] font-semibold">Version</div>
                      <div className="font-mono font-bold text-[#141416] mt-0.5">{currentWorkflow.version}</div>
                    </div>
                    <div>
                      <div className="text-[#64748B] text-[11px] font-semibold">Status</div>
                      <div className="mt-0.5">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                          style={{ backgroundColor: tone.bg, color: tone.text }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tone.dot }} />
                          {tone.label}
                        </span>
                        {currentWorkflow.hasUnpublishedChanges && (
                          <div className="text-[10px] text-[#D97706] font-semibold mt-0.5">Unpublished changes</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#F1F5F9] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748B]">Owner</span>
                      <span className="font-semibold text-[#141416]">{currentWorkflow.owner}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748B]">Trigger</span>
                      <span className="font-semibold text-[#141416]">{currentWorkflow.trigger}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748B]">Last run</span>
                      <div className="text-right">
                        <span className="font-medium text-[#141416]">{formatRunTime(currentWorkflow.lastRunAt)}</span>
                        {currentWorkflow.lastRunStatus !== 'Never' && (
                          <span className="inline-flex items-center gap-1 ml-1.5 text-[10px] font-bold" style={{ color: lastRun.text }}>
                            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: lastRun.dot }} />
                            {currentWorkflow.lastRunStatus}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748B]">Next run</span>
                      <span className="font-semibold text-[#141416]">{currentWorkflow.active ? currentWorkflow.nextRun : 'Paused'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748B]">Success rate (24 h)</span>
                      <span className="font-bold text-[#141416]">{currentWorkflow.successRate}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748B]">Average duration</span>
                      <span className="font-mono font-semibold text-[#141416]">{currentWorkflow.avgDurationSec} s</span>
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="pt-3 border-t border-[#F1F5F9]">
                    <div className="text-[#64748B] text-[11px] font-semibold mb-1.5">Tags</div>
                    <div className="flex flex-wrap gap-1.5">
                      {currentWorkflow.tags.map((tag) => (
                        <span key={tag} className="px-2 py-0.5 bg-[#F1F5F9] border border-[#E2E8F0] rounded-md text-[10px] font-medium text-[#475569]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Run Trigger */}
                  <div className="pt-2 space-y-2">
                    <button
                      onClick={() => void handleRun()}
                      disabled={running}
                      className="w-full py-2 bg-[#FFD600] hover:bg-[#F2CB00] text-black font-bold text-xs rounded-xl transition-all cursor-pointer shadow-xs flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
                    >
                      <Play size={13} />
                      <span>{running ? 'Running…' : 'Run Workflow Now'}</span>
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => void handleSave()} disabled={!editor.dirty || busy !== null || running} className={secondaryBtn}>
                        <Save size={13} />
                        <span>{busy === 'save' ? 'Saving…' : 'Save'}</span>
                      </button>
                      <button onClick={handleValidate} className={secondaryBtn}>
                        <ShieldCheck size={13} />
                        <span>Validate</span>
                      </button>
                      <button onClick={() => void handlePublish()} disabled={busy !== null || running} className={secondaryBtn}>
                        <Send size={13} />
                        <span>{busy === 'publish' ? 'Publishing…' : 'Publish'}</span>
                      </button>
                      <button onClick={() => void handleToggleActive()} disabled={busy !== null || running} className={secondaryBtn}>
                        {currentWorkflow.active ? <Pause size={13} /> : <Play size={13} />}
                        <span>{currentWorkflow.active ? 'Pause' : 'Resume'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ReactFlowProvider>
      )}

      {/* ======================================================== */}
      {/* MODE 2: WORKFLOW DIRECTORY LIST (IMAGE 2)               */}
      {/* ======================================================== */}
      {viewMode === 'list' && (
        <div className="space-y-6">
          {/* Filters Bar & New Workflow Button (Image 2) */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-2xs">
            <SearchField value={search} onChange={setSearch} placeholder="Search workflows, owners or systems..." label="Search workflows" />
            <select aria-label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={SELECT}>
              <option value="all">All types</option>
              <option value="Ingest">Ingest</option>
              <option value="Outbound">Outbound</option>
            </select>
            <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={SELECT}>
              <option value="all">All statuses</option>
              <option value="Published">Published</option>
              <option value="Failing">Failing</option>
              <option value="Draft">Draft</option>
              <option value="Paused">Paused</option>
            </select>
            <MoreFilters active={(systemFilter !== 'all' ? 1 : 0) + (sort !== 'recent' ? 1 : 0)}>
              <FilterField label="Source system">
                <select aria-label="Source system" value={systemFilter} onChange={(e) => setSystemFilter(e.target.value)} className={`${SELECT} w-full`}>
                  <option value="all">All systems</option>
                  {systemOptions.map((s) => (
                    <option key={s} value={s}>
                      {SYSTEM_FILTER_LABELS[s] ?? s}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Sort by">
                <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={`${SELECT} w-full`}>
                  <option value="recent">Last run (recent)</option>
                  <option value="success">Highest success</option>
                  <option value="alpha">Alphabetical</option>
                </select>
              </FilterField>
            </MoreFilters>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className={BTN_GHOST}>
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Clear filters</span>
              </button>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {checked.length > 0 && (
                <>
                  <span className="text-xs font-semibold text-[#64748B]">{checked.length} selected</span>
                  <button
                    onClick={async () => {
                      for (const id of checked) await workflowService.duplicate(id);
                      message.success(`Duplicated ${checked.length} workflow${checked.length > 1 ? 's' : ''}`);
                      setChecked([]);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E2E8F0] hover:border-gray-400 rounded-xl text-xs font-semibold text-[#141416] transition-all cursor-pointer"
                  >
                    <Copy size={13} />
                    <span>Duplicate</span>
                  </button>
                  <button
                    onClick={() => handleDeleteWorkflows(checked)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E2E8F0] hover:border-[#DC2626] hover:text-[#DC2626] rounded-xl text-xs font-semibold text-[#141416] transition-all cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Delete</span>
                  </button>
                </>
              )}
              <button
                onClick={() => setModal('new')}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-[#FFD600] hover:bg-[#F2CB00] rounded-xl text-xs font-bold text-black transition-all cursor-pointer shadow-xs shrink-0"
              >
                <Plus size={14} />
                <span>New workflow</span>
              </button>
            </div>
          </div>

          {/* Directory Table (Image 2) */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs">
            <IntTable<Workflow>
              rows={listQ.initialLoading ? undefined : rows}
              rowKey={(wf) => wf.id}
              initialLoading={listQ.initialLoading}
              skeletonRows={5}
              filtered={filtersActive}
              onClearFilters={clearFilters}
              emptyText="No workflows yet"
              selectedKey={currentWorkflow?.id ?? null}
              columns={[
                {
                  key: 'check',
                  title: (
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={allChecked}
                      onChange={() => setChecked(allChecked ? [] : rows.map((r) => r.id))}
                      aria-label="Select all workflows"
                    />
                  ),
                  priority: 2,
                  render: (wf) => (
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={checked.includes(wf.id)}
                      onChange={() => setChecked((c) => (c.includes(wf.id) ? c.filter((x) => x !== wf.id) : [...c, wf.id]))}
                      aria-label={`Select ${wf.name}`}
                    />
                  ),
                },
                {
                  key: 'name',
                  title: 'Workflow',
                  grow: true,
                  render: (wf) => (
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="block max-w-full cursor-pointer truncate p-0 text-left font-bold text-[#141416] hover:underline"
                        onClick={() => handleOpenCanvas(wf.id)}
                        title={wf.name}
                      >
                        {wf.name}
                      </button>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-[#64748B]">
                        {wf.code} · {wf.version}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'type',
                  title: 'Type',
                  priority: 3,
                  render: (wf) => (
                    <span className="inline-flex items-center rounded-full border border-[#E2E8F0] bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#475569]">{wf.type}</span>
                  ),
                },
                {
                  key: 'source',
                  title: 'Source system',
                  priority: 2,
                  render: (wf) => (
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white" style={{ backgroundColor: wf.sourceIconColor }}>
                        {wf.sourceSystemType.slice(0, 3)}
                      </div>
                      <div className="min-w-0">
                        <div className="whitespace-nowrap text-[11px] font-bold text-[#141416]">{wf.sourceSystemType}</div>
                        <div className="max-w-[160px] truncate text-[10px] text-[#64748B]" title={wf.sourceSystemName}>
                          {wf.sourceSystemName}
                        </div>
                      </div>
                    </div>
                  ),
                },
                { key: 'trigger', title: 'Trigger', priority: 3, render: (wf) => <span className="whitespace-nowrap text-[#64748B]">{wf.trigger}</span> },
                {
                  key: 'status',
                  title: 'Status',
                  render: (wf) => {
                    const st = statusTone(wf);
                    const lr = runTone(wf.lastRunStatus);
                    return (
                      <div className="flex flex-col items-start gap-0.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: st.bg, color: st.text }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.dot }} />
                          {st.label}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: lr.text }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: lr.dot }} />
                          {wf.lastRunStatus === 'Never' ? 'Not run' : wf.lastRunStatus}
                          <span className="font-medium text-[#64748B]">{wf.lastRunTime}</span>
                        </span>
                      </div>
                    );
                  },
                },
                {
                  key: 'success',
                  title: '24 h success',
                  priority: 2,
                  render: (wf) => (
                    <div className="flex w-24 items-center gap-2">
                      <span className="min-w-8 text-[11px] font-bold text-[#141416]">{wf.successRate}%</span>
                      <div className="flex-1">
                        <ProgressBar value={wf.successRate} tone="success" label={`${wf.name} 24 h success rate`} />
                      </div>
                    </div>
                  ),
                },
                { key: 'owner', title: 'Owner', priority: 3, render: (wf) => <span className="whitespace-nowrap text-[#475569]">{wf.owner}</span> },
                {
                  key: 'actions',
                  title: '',
                  align: 'right',
                  render: (wf) => (
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleOpenCanvas(wf.id)}
                        className="cursor-pointer rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-semibold text-[#141416] shadow-2xs transition-all hover:bg-gray-50"
                      >
                        Open
                      </button>
                      <Dropdown menu={rowMenu(wf)} trigger={['click']} placement="bottomRight">
                        <button
                          className="cursor-pointer rounded-lg p-1 text-[#64748B] transition-colors hover:bg-gray-100 hover:text-[#141416]"
                          aria-label={`More actions for ${wf.name}`}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </Dropdown>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}
      <NewWorkflowModal open={modal === 'new'} onCancel={() => setModal(null)} onCreate={handleCreate} />
      <WorkflowSettingsModal workflow={currentWorkflow} open={modal === 'settings'} onCancel={() => setModal(null)} onSave={handleSaveSettings} />
      <RunHistoryModal workflow={currentWorkflow} open={modal === 'history'} onClose={() => setModal(null)} />
      <DocumentationModal open={modal === 'docs'} onClose={() => setModal(null)} />
      <ValidationModal
        issues={issues}
        open={modal === 'validation'}
        onClose={() => setModal(null)}
        onSelectNode={(id) => {
          setModal(null);
          setViewMode('canvas');
          editor.selectOnly(id);
        }}
      />
    </div>
  );
}


/**
 * Workflow Studio: integration workflows. The decision flow (business rules) lives in the
 * Decision Workbench at /product/rules; old ?mode=decision links are sent there.
 */
export default function WorkflowStudioPage() {
  const fromUrl = useQueryParam('mode');
  const router = useRouter();
  useEffect(() => {
    if (fromUrl === 'decision') router.replace('/product/rules');
  }, [fromUrl, router]);
  if (fromUrl === 'decision') return null;

  return (
    <div className="space-y-4 w-full min-w-0">
      <p className="pt-1 text-xs text-[#64748B] min-w-0">
        Data integrations between source systems and Circularity. Business rules for decisions are in{' '}
        <Link href="/product/rules" className="font-semibold text-[#141416] underline hover:no-underline">
          Decision Workbench › Business rules
        </Link>
        .
      </p>
      <IntegrationStudio />
    </div>
  );
}
