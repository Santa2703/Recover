'use client';

import React, { useState } from 'react';
import { Input, Modal, message } from 'antd';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { mcpService, type RegistryEntry } from '@/services/mcpService';
import { useAuth } from '@/store/authContext';
import { TitleWithIcon } from './mcpUi';

/** Pause (with a reason) or resume a registry entry through the service. */
export function AgentStatusModal({ entry, onClose }: { entry: RegistryEntry | null; onClose: () => void }) {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const pausing = entry?.status !== 'paused';
  const effect = entry?.mcpId ? 'All tool calls from it are refused until it is resumed.' : 'New runs queue at its journey steps until it is resumed.';

  const submit = async () => {
    if (!entry) return;
    if (pausing && reason.trim().length < 5) {
      message.error('Give a reason of at least 5 characters');
      return;
    }
    setSaving(true);
    try {
      await mcpService.setRegistryStatus(entry, pausing, reason.trim(), { id: user.id, name: user.name, role: user.role });
      message.success(`${entry.name} ${pausing ? 'paused' : 'resumed'}`);
      setReason('');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!entry}
      onCancel={() => {
        setReason('');
        onClose();
      }}
      onOk={submit}
      confirmLoading={saving}
      okText={pausing ? 'Pause' : 'Resume'}
      okButtonProps={{ style: { backgroundColor: '#FFD600', color: '#141416', fontWeight: 'bold' } }}
      title={
        entry && (
          <TitleWithIcon icon={pausing ? <PauseCircle /> : <PlayCircle />} title={`${pausing ? 'Pause' : 'Resume'} ${entry.name}`} sub={pausing ? effect : 'It picks up work again straight away.'} />
        )
      }
    >
      {entry && (
        <div className="space-y-3 py-2 text-xs text-[#475569]">
          {pausing ? (
            <>
              <label className="block font-semibold text-[#141416]" htmlFor="pause-reason">
                Reason (recorded in the audit log)
              </label>
              <Input.TextArea
                id="pause-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Investigating unexpected write volume on Customer B"
                maxLength={240}
                showCount
              />
            </>
          ) : (
            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <div className="font-semibold text-[#141416]">Currently paused</div>
              <div className="mt-1">{entry.statusReason ?? 'No reason recorded.'}</div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
