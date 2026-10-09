import { Search, X } from 'lucide-react'
import { useLayoutEffect, useState } from 'react'

export interface BrowserNavigationState {
  scope: string
  inputKey: string
  revision: number
  title: string
  query: string
  label: string
  placeholder: string
  busy: boolean
  onQuery(value: string): number
  onBack?: () => void
  onSubmit?: (query: string) => void
}

export function BrowserSearch({ navigation }: { navigation: BrowserNavigationState }) {
  const [draft, setDraft] = useState({
    key: navigation.inputKey,
    text: navigation.query,
    revision: navigation.revision,
  })
  const text = draft.key === navigation.inputKey ? draft.text : navigation.query
  useLayoutEffect(() => {
    setDraft((previous) =>
      previous.key === navigation.inputKey &&
      (navigation.revision < previous.revision ||
        (previous.text === navigation.query && previous.revision === navigation.revision))
        ? previous
        : { key: navigation.inputKey, text: navigation.query, revision: navigation.revision },
    )
  }, [navigation.inputKey, navigation.query, navigation.revision])
  function change(value: string) {
    // Keep the actual input controlled by its immediate owner. The browser
    // publishes its page context separately, after its render has committed.
    const revision = navigation.onQuery(value)
    setDraft({ key: navigation.inputKey, text: value, revision })
  }
  return (
    <form
      className="header-search"
      onSubmit={(event) => {
        event.preventDefault()
        const input = event.currentTarget.querySelector<HTMLInputElement>('input')
        if (!navigation.busy && input?.value.trim()) navigation.onSubmit?.(input.value)
      }}
    >
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        aria-label={navigation.label}
        placeholder={navigation.placeholder}
        value={text}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && navigation.onSubmit && !event.nativeEvent.isComposing) {
            // The browser context reaches the header after an effect. Use the
            // actual input value so quick typing + Enter cannot submit stale text.
            event.preventDefault()
            if (!event.repeat && !navigation.busy && event.currentTarget.value.trim())
              navigation.onSubmit(event.currentTarget.value)
          }
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.stopPropagation()
            change('')
          }
        }}
      />
      {text && (
        <button
          className="icon-btn"
          type="button"
          aria-label={navigation.onSubmit ? '清空搜索' : '清空列表搜索'}
          onClick={() => change('')}
        >
          <X size={15} />
        </button>
      )}
      {navigation.onSubmit && (
        <button className="text-btn" type="submit" disabled={!text.trim() || navigation.busy}>
          搜索
        </button>
      )}
    </form>
  )
}
