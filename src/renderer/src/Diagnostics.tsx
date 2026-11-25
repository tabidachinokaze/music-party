import { ui } from '../../shared/ui-language'
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
          {ui('已记录 {0} / 300 条请求', '{0} / 300 requests recorded', traces.length)}
        </span>
        <button className="secondary" onClick={onExport}>
          <Download size={15} />
          {ui('导出记录', 'Export log')}
        </button>
      </div>
      {traces.length === 0 ? (
        <div className="diagnostic-empty">
          <Activity size={24} />
          <strong>{ui('还没有请求记录', 'No requests yet')}</strong>
          <span>
            {ui(
              '执行播放、搜索或房间操作后，可在这里查看响应。',
              'Play a track, search or use a room to see request details here.',
            )}
          </span>
        </div>
      ) : (
        <div className="trace-layout">
          <div data-list-viewport="" className="trace-list">
            {traces.map((trace) => (
              <button
                key={trace.id}
                title={ui('查看 {0} 请求详情', 'View {0} request details', trace.method)}
                className={active?.id === trace.id ? 'selected' : ''}
                aria-pressed={active?.id === trace.id}
                onClick={() => setSelectedTrace(trace.id)}
              >
                <span
                  className={trace.ok ? 'ok' : 'bad'}
                  aria-label={trace.ok ? ui('成功', 'Success') : ui('失败', 'Failed')}
                >
                  {trace.ok ? <CheckCircle2 size={15} /> : <X size={15} />}
                </span>
                <strong>{trace.method}</strong>
                <span>{trace.duration}ms</span>
                <small>{new Date(trace.time).toLocaleTimeString()}</small>
              </button>
            ))}
          </div>
          <pre aria-label={ui('请求详情', 'Request details')}>
            {JSON.stringify(active, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
