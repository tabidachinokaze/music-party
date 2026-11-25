import { ui } from '../../../shared/ui-language'
import { MusicianNames } from '../MusicianNames'
import { AlbumArtwork } from './AlbumArtwork'
import { Lyrics, type useTrackLyrics } from '../Lyrics'
import type { useParty } from '../useParty'

type Party = ReturnType<typeof useParty>

export function ImmersivePlayer({
  party: p,
  position,
  vinyl,
  focus,
  lyrics,
  onRead,
  onAlbum,
  onArtist,
  act = p.act,
}: {
  party: Party
  position: number
  vinyl: boolean
  focus: 'both' | 'cover' | 'lyrics'
  lyrics: ReturnType<typeof useTrackLyrics>
  onRead(): void
  onAlbum(id: string, title: string): void
  onArtist(id: string, title: string): void
  act?: Party['act']
}) {
  const song = p.current
  const albumId = song?.albumId
  let activeIndex = -1
  while (lyrics.lines[activeIndex + 1]?.time <= position) activeIndex++
  const currentLine = focus === 'cover' ? lyrics.lines[activeIndex] : null
  return (
    <section
      className="immersive-player"
      aria-label={ui('正在播放', 'Now Playing')}
      data-playing={p.playing}
      data-focus={focus}
    >
      <div className="immersive-body">
        <div className="immersive-identity">
          <div className="immersive-art-frame">
            {vinyl ? (
              <div className="turntable" aria-hidden="true">
                <div className="turntable-plinth">
                  <div className="vinyl-disc">
                    <AlbumArtwork song={song} className="vinyl-label" />
                  </div>
                  <div className="tonearm" />
                </div>
              </div>
            ) : (
              <div className="playing-cover">
                <AlbumArtwork song={song} className="sleeve" />
              </div>
            )}
          </div>
          <div className="immersive-song-info">
            <div className="immersive-song-heading">
              <h1>{song?.name || ui('尚未选歌', 'No track selected')}</h1>
              {p.auditioning && (
                <small className="audition-label">{ui('本机试听', 'Local preview')}</small>
              )}
            </div>
            <div className="immersive-metadata">
              {song?.artist && (
                <span>
                  <MusicianNames credits={song.artists} fallback={song.artist} onOpen={onArtist} />
                </span>
              )}
              {song?.album &&
                (albumId ? (
                  <button
                    className="album-link"
                    title={ui('打开专辑《{0}》', 'Open album “{0}”', song.album)}
                    onClick={() => onAlbum(albumId, song.album)}
                  >
                    {song.album}
                  </button>
                ) : (
                  <span>{song.album}</span>
                ))}
            </div>
            {(lyrics.status === 'instrumental' || lyrics.status === 'missing') && (
              <small className="playing-lyric-status" role="status">
                {lyrics.status === 'instrumental'
                  ? ui('纯音乐，请欣赏', 'Instrumental')
                  : ui('这首歌暂时没有歌词', 'Lyrics are unavailable for this track')}
              </small>
            )}
            {currentLine && <p className="cover-lyric">{currentLine.text}</p>}
          </div>
        </div>
        <div className="immersive-song">
          <Lyrics
            content={lyrics}
            onRead={onRead}
            activeIndex={activeIndex}
            seekable={!!song && (!p.room || p.auditioning) && !p.busy}
            onSeek={(pos) => void act(ui('跳转歌词', 'Seek to lyric'), () => p.seek(pos))}
          />
        </div>
      </div>
    </section>
  )
}
