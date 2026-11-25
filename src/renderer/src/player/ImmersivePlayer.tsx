import { t } from '../../../shared/ui-language'
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
      aria-label={t('immersivePlayer.nowPlaying')}
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
              <h1>{song?.name || t('common.noTrackSelected')}</h1>
              {p.auditioning && (
                <small className="audition-label">{t('common.localPreview')}</small>
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
                    title={t('common.openAlbum', { album: song.album })}
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
                  ? t('common.instrumental')
                  : t('common.lyricsAreUnavailableForThisTrack')}
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
            onSeek={(pos) => void act(t('immersivePlayer.seekToLyric'), () => p.seek(pos))}
          />
        </div>
      </div>
    </section>
  )
}
