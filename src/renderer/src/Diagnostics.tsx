import { getUiLanguage, t } from '../../shared/ui-language'
import { useState } from 'react'
import { Activity, CheckCircle2, Download, X } from 'lucide-react'
import type { Trace } from '../../shared/types'
export function Diagnostics({ traces, onExport }: { traces: Trace[]; onExport(): void }) {
  const [selectedTrace, setSelectedTrace] = useState<number | null>(null)
  const active = traces.find((trace) => trace.id === selectedTrace) ?? traces[0]
  return (
    <div className="diagnostics">
      <div className="section-title">
        <span className="muted">
          {t('diagnostics.300RequestsRecorded', { count: traces.length })}
        </span>
        <button className="secondary" onClick={onExport}>
          <Download size={15} />
          {t('common.exportLog')}
        </button>
      </div>
      {traces.length === 0 ? (
        <div className="diagnostic-empty">
          <Activity size={24} />
          <strong>{t('diagnostics.noRequestsYet')}</strong>
          <span>{t('diagnostics.playATrackSearchOrUseARoom')}</span>
        </div>
      ) : (
        <div className="trace-layout">
          <div data-list-viewport="" className="trace-list">
            {traces.map((trace) => (
              <button
                key={trace.id}
                title={t('diagnostics.viewRequestDetails', { method: trace.method })}
                className={active?.id === trace.id ? 'selected' : ''}
                aria-pressed={active?.id === trace.id}
                onClick={() => setSelectedTrace(trace.id)}
              >
                <span
                  className={trace.ok ? 'ok' : 'bad'}
                  aria-label={trace.ok ? t('diagnostics.success') : t('diagnostics.failed')}
                >
                  {trace.ok ? <CheckCircle2 size={15} /> : <X size={15} />}
                </span>
                <strong>{trace.method}</strong>
                <span>{trace.duration}ms</span>
                <small>{new Date(trace.time).toLocaleTimeString(getUiLanguage())}</small>
              </button>
            ))}
          </div>
          <pre aria-label={t('diagnostics.requestDetails')}>{JSON.stringify(active, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
