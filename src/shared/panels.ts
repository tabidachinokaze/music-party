export type DetailId = `detail-${'album' | 'playlist' | 'artist'}-${string}`
export type PanelId =
  | 'windows'
  | 'lyrics'
  | 'controls'
  | 'library'
  | 'created'
  | 'recent'
  | 'liked'
  | 'albums'
  | 'search'
  | 'queue'
  | 'room'
  | 'chat'
  | 'private'
  | 'settings'
  | 'diagnostics'
  | 'login'
  | 'add'
  | 'confirm'
  | 'feedback'
  | 'members'
  | 'match'
  | 'match-song'
  | DetailId
export type PrivateMode = 'reply' | 'full'
export interface PanelStatus {
  visible: boolean
}
