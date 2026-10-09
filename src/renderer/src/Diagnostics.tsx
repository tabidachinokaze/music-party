import { useState } from 'react'
import { CheckCircle2, Download, X } from 'lucide-react'
import type { Trace } from '../../shared/types'
export function Diagnostics({ traces, onExport }: { traces: Trace[]; onExport(): void }) {
  const [selectedTrace, setSelectedTrace] = useState<number | null>(null)
  const [checks, setChecks] = useState<string[]>([])
  const checklist = [
    '桌面与两个官方账号同房',
    '桌面创建 → 手机加入',
    '手机创建 → 桌面加入',
    '桌面推歌 → 手机响应',
    '手机切歌 → 桌面同步',
    '成员离开 → 其他人继续同听',
  ]
  return (
    <div className="diagnostics">
      <div className="section-title">
        <span className="muted">已记录 {traces.length} / 300 条请求</span>
        <button className="secondary" onClick={onExport}>
          <Download size={15} />
          导出记录
        </button>
      </div>
      <p className="muted">
        凭据和链接已隐藏。导出保留用户、房间和歌曲 ID。勾选项仅为本次人工观测记录。
      </p>
      <div className="checklist">
        {checklist.map((label) => (
          <label key={label}>
            <input
              type="checkbox"
              checked={checks.includes(label)}
              onChange={(e) =>
                setChecks(
                  e.target.checked ? [...checks, label] : checks.filter((item) => item !== label),
                )
              }
            />
            {label}
          </label>
        ))}
      </div>
      <div className="trace-layout">
        <div className="trace-list">
          {traces.map((trace) => (
            <button
              key={trace.id}
              className={selectedTrace === trace.id ? 'selected' : ''}
              onClick={() => setSelectedTrace(trace.id)}
            >
              <span className={trace.ok ? 'ok' : 'bad'}>
                {trace.ok ? <CheckCircle2 size={15} /> : <X size={15} />}
              </span>
              <strong>{trace.method}</strong>
              <span>{trace.duration}ms</span>
              <small>{new Date(trace.time).toLocaleTimeString()}</small>
            </button>
          ))}
        </div>
        <pre>
          {JSON.stringify(
            traces.find((trace) => trace.id === selectedTrace) ||
              traces[0] || { 提示: '执行一次操作后，这里显示响应' },
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  )
}
