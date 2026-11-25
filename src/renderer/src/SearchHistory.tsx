import { Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { ui } from '../../shared/ui-language'

const limit = 10

export function useSearchHistory(storageKey: string) {
  const [queries, setQueries] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]')
      return Array.isArray(value) ? value.filter((q) => typeof q === 'string').slice(0, limit) : []
    } catch {
      return []
    }
  })
  function save(next: string[]) {
    setQueries(next)
    try {
      if (next.length) localStorage.setItem(storageKey, JSON.stringify(next))
      else localStorage.removeItem(storageKey)
    } catch {
      // Keep recent searches usable in memory if storage is unavailable.
    }
  }
  return {
    queries,
    remember(query: string) {
      const term = query.trim()
      if (term) save([term, ...queries.filter((q) => q !== term)].slice(0, limit))
    },
    remove: (query: string) => save(queries.filter((q) => q !== query)),
    clear: () => save([]),
  }
}

export function SearchHistory({
  history,
  onSearch,
}: {
  history: ReturnType<typeof useSearchHistory>
  onSearch(query: string): void
}) {
  if (!history.queries.length) return null
  return (
    <div className="search-history" role="group" aria-label={ui('最近搜索', 'Recent searches')}>
      <span>{ui('最近搜索', 'Recent searches')}</span>
      {history.queries.map((query) => (
        <div className="search-history-chip" key={query}>
          <button type="button" title={query} onClick={() => onSearch(query)}>
            {query}
          </button>
          <button
            type="button"
            className="history-delete"
            aria-label={ui('删除搜索记录 {0}', 'Remove search “{0}”', query)}
            title={ui('删除这条记录', 'Remove this search')}
            onClick={() => history.remove(query)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-btn history-clear"
        aria-label={ui('清空搜索记录', 'Clear search history')}
        onClick={history.clear}
      >
        <Trash2 size={14} />
        {ui('清空', 'Clear')}
      </button>
    </div>
  )
}
