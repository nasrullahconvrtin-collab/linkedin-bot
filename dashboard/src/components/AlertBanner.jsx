import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';

export default function AlertBanner() {
  const { alerts } = useApp() || {};
  const [dismissed, setDismissed] = useState(new Set());

  const visible = (alerts || []).filter(a => !dismissed.has(a.id));
  if (!visible.length) return null;

  const dismiss = (id) => setDismissed(prev => new Set(prev).add(id));

  return (
    <div className="flex flex-col gap-2 mb-4">
      {visible.map(a => (
        <div
          key={a.id}
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
            a.severity === 'error'
              ? 'border-[#ef4444]/40 bg-[#ef4444]/10 text-[#ef4444]'
              : 'border-[#f59e0b]/40 bg-[#f59e0b]/10 text-[#f59e0b]'
          }`}
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{a.message}</span>
          <button onClick={() => dismiss(a.id)} className="opacity-60 hover:opacity-100 text-xs">
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
