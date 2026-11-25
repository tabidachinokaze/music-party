import { t } from '../../shared/ui-language'
import { Search, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

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
  const inputRef = useRef<HTMLInputElement>(null)
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
        const value = inputRef.current?.value
        if (!navigation.busy && value?.trim()) navigation.onSubmit?.(value)
      }}
    >
      <label className="header-search-field">
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          autoFocus={!!navigation.onSubmit}
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
            if (
              event.key === 'Escape' &&
              event.currentTarget.value &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              event.stopPropagation()
              change('')
            }
          }}
        />
      </label>
      {text && (
        <button
          className="icon-btn"
          type="button"
          aria-label={
            navigation.onSubmit
              ? t('browserNavigation.clearSearch')
              : t('browserNavigation.clearListSearch')
          }
          onClick={() => {
            change('')
            inputRef.current?.focus()
          }}
        >
          <X size={15} />
        </button>
      )}
      {navigation.onSubmit && (
        <button className="text-btn" type="submit" disabled={!text.trim() || navigation.busy}>
          {t('common.search')}
        </button>
      )}
    </form>
  )
}
