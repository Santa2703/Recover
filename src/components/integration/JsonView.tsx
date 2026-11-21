'use client';

import React from 'react';
import { message } from 'antd';
import { Copy } from 'lucide-react';

/** Dark JSON block (same look as the Source tables transform preview), with copy. */
export function JsonView({ value, label }: { value: unknown; label?: string }) {
  const text = JSON.stringify(value, null, 2);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('Payload copied');
    } catch {
      message.error('Clipboard is not available in this browser');
    }
  };
  return (
    <div className="overflow-hidden rounded-xl bg-[#141416]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="font-mono text-[11px] text-[#94A3B8]">{label ?? 'payload.json'}</span>
        <button type="button" onClick={copy} className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-white/80 hover:text-white">
          <Copy size={12} /> Copy
        </button>
      </div>
      <pre className="m-0 max-h-[420px] overflow-auto p-3 font-mono text-[11px] leading-relaxed text-white">
        {text.split('\n').map((line, i) => {
          const m = /^(\s*)("[^"]+")(:\s?)(.*)$/.exec(line);
          if (!m) return <div key={i}>{line}</div>;
          return (
            <div key={i}>
              {m[1]}
              <span className="text-[#FFD600]">{m[2]}</span>
              {m[3]}
              <span className={/^"/.test(m[4]) ? 'text-[#86EFAC]' : 'text-[#38BDF8]'}>{m[4]}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
