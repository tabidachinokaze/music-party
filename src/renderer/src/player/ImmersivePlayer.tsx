import { ChevronDown, Mail, MessageCircle } from 'lucide-react'
import { AlbumArtwork } from './AlbumArtwork'
import { Lyrics } from '../Lyrics'
import type { useParty } from '../useParty'
import type { Preferences } from '../../../shared/desktop'

type Party = ReturnType<typeof useParty>

export function ImmersivePlayer({
  party: p,
  position,
  background,
  onClose,
  onChat,
  onPrivate,
  onAlbum,
  act = p.act,
}: {
  party: Party
  position: number
  background?: Preferences['playerBackground']
  onClose(): void
  onChat(): void
  onPrivate(): void
  onAlbum(id: string, title: string): void
  act?: Party['act']
}) {
  const song = p.current
  const albumId = song?.albumId
  return (
    <section className="immersive-player" aria-label="正在播放" data-playing={p.playing}>
      {!background?.image && song?.cover && (
        <div className="cover-tint" aria-hidden="true">
          <img src={song.cover} alt="" draggable={false} referrerPolicy="no-referrer" />
        </div>
      )}
      <header className="immersive-header">
        <button className="icon-btn" aria-label="返回浏览" title="返回浏览" onClick={onClose}>
          <ChevronDown />
        </button>
        <span>正在播放</span>
        <div className="immersive-tools">
          {p.room && (
            <button className="icon-btn" aria-label="房间聊天" title="房间聊天" onClick={onChat}>
              <MessageCircle />
            </button>
          )}
          <button className="icon-btn" aria-label="打开私信" title="打开私信" onClick={onPrivate}>
            <Mail />
          </button>
        </div>
      </header>
      <div className="immersive-body">
        <div className="turntable" aria-hidden="true">
          <div className="turntable-plinth">
            <div className="vinyl-disc">
              <AlbumArtwork song={song} className="vinyl-label" />
            </div>
            <div className="tonearm" />
          </div>
        </div>
        <div className="immersive-song">
          <h1>{song?.name || '尚未选歌'}</h1>
          <div className="immersive-metadata">
            {song?.artist && <span>{song.artist}</span>}
            {song?.album &&
              (albumId ? (
                <button
                  className="album-link"
                  title={'打开专辑《' + song.album + '》'}
                  onClick={() => onAlbum(albumId, song.album)}
                >
                  {song.album}
                </button>
              ) : (
                <span>{song.album}</span>
              ))}
            {p.auditioning && <span>本机试听</span>}
          </div>
          <Lyrics
            api={p.api}
            songId={song?.id}
            position={position}
            heading
            seekable={!!song && (!p.room || p.auditioning) && !p.busy}
            onSeek={(pos) => void act('跳转歌词', () => p.seek(pos))}
          />
        </div>
      </div>
    </section>
  )
}
