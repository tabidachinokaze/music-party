export function encodeWav(chunks: Float32Array[], sampleRate: number): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const buffer = new ArrayBuffer(44 + length * 2),
    view = new DataView(buffer)
  const text = (offset: number, value: string) =>
    [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, length * 2, true)
  let offset = 44
  for (const chunk of chunks)
    for (const sample of chunk) {
      const n = Math.max(-1, Math.min(1, sample))
      view.setInt16(offset, n < 0 ? n * 32768 : n * 32767, true)
      offset += 2
    }
  return new Uint8Array(buffer)
}
export async function startRecording() {
  await window.together.requestMicrophone()
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true },
    video: false,
  })
  let context: AudioContext | null = null
  try {
    context = new AudioContext({ sampleRate: 16000 })
    await context.resume()
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    context?.close().catch(() => {})
    throw error
  }
  try {
    const source = context.createMediaStreamSource(stream),
      processor = context.createScriptProcessor(4096, 1, 1),
      mute = context.createGain()
    mute.gain.value = 0
    const chunks: Float32Array[] = []
    processor.onaudioprocess = (event) =>
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
    source.connect(processor)
    processor.connect(mute)
    mute.connect(context.destination)
    let stopped = false
    const stop = () => {
      if (stopped) return
      stopped = true
      processor.onaudioprocess = null
      source.disconnect()
      processor.disconnect()
      mute.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      context.close().catch(() => {})
    }
    return {
      cancel: stop,
      finish: () => {
        stop()
        const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        return {
          data: encodeWav(chunks, context.sampleRate),
          duration: (length / context.sampleRate) * 1000,
        }
      },
    }
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    context.close().catch(() => {})
    throw error
  }
}
