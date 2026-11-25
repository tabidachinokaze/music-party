import { t } from '../shared/ui-language'
import { createHash } from 'node:crypto'
import { richMessageContent } from '../shared/message-content'
import { savedSticker, downloadStickerImage } from './stickers'
import type { StickerImageRequest } from '../shared/sticker-actions'
import {
  neteaseAssetUrl,
  validateMediaRequest,
  type MediaFile,
  type MediaProgress,
  type MediaReply,
  type MediaRequest,
  type MediaReceipt,
} from '../shared/media'
type Invoke = (endpoint: string, args: Record<string, unknown>) => Promise<{ body: any }>
export class MediaSender {
  private jobs = new Map<
    string,
    { signature: string; promise: Promise<MediaReply>; abort: AbortController; phase: string }
  >()
  constructor(
    private invoke: Invoke,
    private credentials: () => { cookie: string; epoch: number },
    private fetcher: typeof fetch = fetch,
  ) {}
  cancel(id: string) {
    const job = this.jobs.get(id)
    if (job?.phase === 'uploading') job.abort.abort()
  }
  send(value: unknown, progress: (event: MediaProgress) => void): Promise<MediaReply> {
    let request: MediaRequest
    try {
      request = validateMediaRequest(value)
    } catch (error: any) {
      return Promise.resolve({ ok: false, error: error.message })
    }
    const signature = createHash('sha256')
      .update(
        JSON.stringify([
          this.credentials().epoch,
          request.target,
          request.file.kind,
          request.file.name,
          request.file.mime,
          request.file.width,
          request.file.height,
          request.file.duration,
        ]),
      )
      .update(request.file.data)
      .update(request.file.cover || new Uint8Array())
      .digest('hex')
    const old = this.jobs.get(request.requestId)
    if (old)
      return old.signature === signature
        ? old.promise
        : Promise.resolve({
            ok: false,
            error: t('mediaSend.thatAttachmentRequestIdIsAlreadyInUse'),
          })
    if ([...this.jobs.values()].some((job) => job.phase !== 'done'))
      return Promise.resolve({
        ok: false,
        error: t('mediaSend.waitForTheCurrentAttachmentToFinish'),
      })
    if (this.jobs.size >= 50) {
      const first = this.jobs.keys().next().value
      if (first) this.jobs.delete(first)
    }
    const abort = new AbortController()
    const job = {
      signature,
      abort,
      phase: 'uploading',
      promise: Promise.resolve({ ok: false } as MediaReply),
    }
    this.jobs.set(request.requestId, job)
    job.promise = this.run(request, abort.signal, (phase, percent) => {
      job.phase = phase
      progress({ requestId: request.requestId, phase, percent })
    }).finally(() => {
      job.phase = 'done'
    })
    return job.promise
  }
  async saveImage(value: unknown, progress: (event: MediaProgress) => void): Promise<MediaReply> {
    const request = value as StickerImageRequest
    if (
      !request ||
      typeof request.requestId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(request.requestId)
    )
      return { ok: false, error: t('mediaSend.invalidAttachmentRequestId') }
    const captured = this.credentials()
    const current = () => {
      const now = this.credentials()
      if (!captured.cookie || now.epoch !== captured.epoch || now.cookie !== captured.cookie)
        throw new Error(t('mediaSend.theAccountChangedAddTheStickerAgain'))
    }
    try {
      current()
      const file = await downloadStickerImage(request.image, current, this.fetcher)
      current()
      return this.send(
        { requestId: request.requestId, target: { kind: 'sticker' }, file },
        progress,
      )
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || t('mediaSend.couldNotAddTheImage'),
        deliveryUnknown: false,
      }
    }
  }
  private async run(
    request: MediaRequest,
    signal: AbortSignal,
    progress: (phase: 'uploading' | 'sending', percent: number) => void,
  ): Promise<MediaReply> {
    const auth = this.credentials()
    let attempted = false
    const check = () => {
      signal.throwIfAborted()
      if (!auth.cookie || this.credentials().epoch !== auth.epoch)
        throw new Error(t('mediaSend.theAccountChangedSendTheAttachmentAgain'))
    }
    const invoke = async (uri: string, data: Record<string, unknown>) => {
      check()
      const result = await this.invoke('api', {
        uri,
        data,
        crypto: 'eapi',
        cookie: auth.cookie,
        timeout: 15000,
      })
      if (
        result.body?.code !== 200 ||
        result.body?.data === false ||
        result.body?.data?.success === false
      )
        throw Object.assign(
          new Error(
            result.body?.message ||
              result.body?.msg ||
              t('mediaSend.neteaseDidNotAcceptTheAttachmentRequest'),
          ),
          { definite: true, code: result.body?.code },
        )
      return result.body
    }
    const target = async () => {
      check()
      const account = (await this.invoke('login_status', { cookie: auth.cookie, timeout: 12000 }))
        .body?.data?.profile
      if (!account?.userId) throw new Error(t('mediaSend.signInAgainBeforeSendingAnAttachment'))
      if (request.target.kind === 'sticker') return { account, chatRoomId: '' }
      if (request.target.kind === 'private') {
        if (String(account.userId) === request.target.uid)
          throw new Error(t('common.youCannotSendADirectMessageToYourself'))
        return { account, chatRoomId: '' }
      }
      const status = (await this.invoke('multiStatus', { cookie: auth.cookie, timeout: 12000 }))
        .body
      const snapshot = status?.data?.multiLtRoomSnapshot
      const chatRoomId = String(
        (snapshot?.multiRoomInfoDTO ?? snapshot?.roomInfo)?.chatRoomId || '',
      )
      if (snapshot?.roomId !== request.target.roomId || !/^[1-9]\d{0,23}$/.test(chatRoomId))
        throw new Error(t('mediaSend.yourAccountLeftThisRoomBeforeTheAttachment'))
      return { account, chatRoomId }
    }
    try {
      await target()
      const upload = async (file: MediaFile, part: (value: number) => void) => {
        const md5 = createHash('md5').update(file.data).digest('hex')
        const isWhale = file.kind === 'voice' || file.kind === 'video'
        const ext =
          file.kind === 'image'
            ? file.mime === 'image/jpeg'
              ? 'jpg'
              : file.mime.split('/')[1]
            : file.name.split('.').pop()?.toLowerCase() || 'bin'
        const params = isWhale
          ? {
              filename: file.name,
              type: file.kind === 'voice' ? 'audio' : 'video',
              bucket: file.kind === 'voice' ? 'ymusic' : 'cloudmusic',
              bizKey: file.kind === 'voice' ? '519abfd2' : 'cb8c016e',
              contentType: file.mime,
              md5,
              fileSize: file.data.byteLength,
            }
          : {
              filename: file.name,
              type: 'other',
              bucket: file.kind === 'image' ? 'yyimgs' : 'dmusic',
              nos_product: 0,
              ext,
              local: false,
              md5,
              fileSize: file.data.byteLength,
            }
        const response = await invoke(
          isWhale ? '/api/nos/token/whalealloc' : '/api/nos/token/alloc',
          params,
        )
        const token = response[isWhale ? 'data' : 'result']
        const bucket = String(token?.bucket || params.bucket),
          key = String(token?.objectKey || token?.key || '')
        const rawId =
          typeof token?.docId === 'string' ? token.docId : (token?.resourceId ?? token?.docId)
        if (typeof rawId === 'number' && !Number.isSafeInteger(rawId))
          throw new Error(t('mediaSend.theUploadIdLostPrecisionTheAttachmentWas'))
        const docId = String(rawId || '')
        if (
          !/^[a-z0-9-]{1,100}$/.test(bucket) ||
          !key ||
          key.length > 1024 ||
          key.includes('..') ||
          typeof token?.token !== 'string' ||
          !/^\d+$/.test(docId)
        )
          throw new Error(t('mediaSend.couldNotObtainValidUploadCredentials'))
        if (token.channel && token.channel !== 1)
          throw new Error(t('mediaSend.uploadsAreTemporarilyUnavailableForThisAccountTry'))
        let context = '',
          offset = 0
        const chunkSize = 2 * 1024 * 1024
        while (offset < file.data.byteLength) {
          check()
          const end = Math.min(offset + chunkSize, file.data.byteLength)
          const url = new URL(`https://nosup-hz1.127.net/${bucket}/${encodeURIComponent(key)}`)
          url.searchParams.set('offset', String(offset))
          url.searchParams.set('complete', String(end === file.data.byteLength))
          url.searchParams.set('version', '1.0')
          if (context) url.searchParams.set('context', context)
          const result = await this.fetcher(url, {
            method: 'POST',
            redirect: 'error',
            headers: { 'x-nos-token': token.token, 'Content-Type': file.mime },
            body: Buffer.from(file.data.subarray(offset, end)),
            signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
          })
          if (!result.ok)
            throw Object.assign(
              new Error(t('mediaSend.attachmentUploadFailed', { status: result.status })),
              {
                code: result.status,
              },
            )
          const body = (await result.json()) as any
          if (body.errCode || (body.code && body.code !== 200))
            throw new Error(t('mediaSend.neteaseStorageDidNotAcceptThisUploadPart'))
          if (body.offset !== undefined && Number(body.offset) !== end)
            throw new Error(t('mediaSend.theConfirmedUploadProgressDidNotMatchTry'))
          context = typeof body.context === 'string' ? body.context : context
          offset = end
          part(offset / file.data.byteLength)
        }
        const url =
          neteaseAssetUrl(token.outerUrl || token.downloadUrl) ||
          (file.kind === 'image'
            ? `https://p1.music.126.net/${key}`
            : `https://${bucket}.nos-hz.163yun.com/${key}`)
        return { url, docId, nosKey: `${bucket}/${key}`, md5 }
      }
      progress('uploading', 0)
      const file = request.file
      const uploaded = await upload(file, (value) =>
        progress('uploading', Math.round(value * (file.cover ? 85 : 95))),
      )
      let cover: any
      if (file.cover)
        cover = await upload(
          {
            kind: 'image',
            name: 'cover.jpg',
            mime: 'image/jpeg',
            data: file.cover,
            width: file.width,
            height: file.height,
          },
          (value) => progress('uploading', 85 + Math.round(value * 10)),
        )
      const destination = await target()
      check()
      if (request.target.kind === 'sticker') {
        progress('sending', 100)
        attempted = true
        const result = await invoke('/api/social/emoji/upload', {
          imgs: JSON.stringify([
            {
              picId: uploaded.docId,
              width: file.width,
              height: file.height,
              format: file.mime === 'image/jpeg' ? 'jpg' : file.mime.split('/')[1],
            },
          ]),
        })
        if (!Array.isArray(result.data?.emojiMap))
          throw new Error(t('mediaSend.couldNotConfirmTheSaveRefreshYourCustom'))
        if (!result.data.emojiMap.length)
          throw Object.assign(
            new Error(result.data.toast || t('mediaSend.theStickerWasNotSavedTryAgainLater')),
            {
              definite: true,
            },
          )
        const emoji = savedSticker(result.data.emojiMap[0])
        if (!emoji) throw new Error(t('mediaSend.stickerSubmittedRefreshTheListToCheckWhether'))
        return {
          ok: true,
          receipt: {
            requestId: request.requestId,
            senderUid: String(destination.account.userId),
            time: Date.now(),
            text: t('mediaSend.addedToYourNeteaseCustomStickers'),
            attachments: [],
            emoji,
          },
        }
      }
      const text =
        file.kind === 'file'
          ? `[文件] ${file.name}\n${uploaded.url}`
          : file.kind === 'voice'
            ? '[语音]'
            : file.kind === 'video'
              ? '[视频]'
              : `[${file.name}]`
      if (text.length > 500) throw new Error(t('mediaSend.theDownloadLinkIsTooLongToSend'))
      const receipt: MediaReceipt = {
        requestId: request.requestId,
        senderUid: String(destination.account.userId),
        text,
        time: Date.now(),
        attachments: [
          {
            kind: file.kind === 'voice' ? 'audio' : file.kind,
            title: file.name,
            resourceId: file.kind === 'image' ? uploaded.md5 : uploaded.docId,
            url: file.kind === 'file' ? undefined : uploaded.url,
            cover: cover?.url,
            ...(file.kind === 'image' ? { width: file.width, height: file.height } : {}),
            ...(file.kind === 'file'
              ? {
                  actionUrl: uploaded.url,
                  subtitle: `${Math.ceil(file.data.byteLength / 1024)} KB`,
                }
              : {}),
          },
        ],
      }
      if (request.target.kind === 'room') {
        const emoji = {
          emojiId: '0',
          emojiGroupId: '0',
          emojiName: file.name.slice(0, 80),
          emojiImgUrl: uploaded.url,
          width: file.width!,
          height: file.height!,
          format: file.mime.split('/')[1],
        }
        receipt.emoji = emoji
        receipt.text = `[${emoji.emojiName}]`
        progress('sending', 100)
        attempted = true
        await invoke('/api/middle/im/chatroom/send', {
          chatroomId: destination.chatRoomId,
          msgType: 0,
          clientExt: JSON.stringify({
            bizType: 'listenTogether',
            ltType: 'MULTI_MATCH_SONG',
            roomId: request.target.roomId,
            emoji,
          }),
          msgBody: JSON.stringify({ msg: receipt.text, msgType: 0 }),
        })
      } else if (file.kind === 'file') {
        progress('sending', 100)
        attempted = true
        const sent = await this.invoke('send_text', {
          user_ids: request.target.uid,
          msg: text,
          cookie: auth.cookie,
          timeout: 15000,
        })
        if (
          sent.body?.code !== 200 ||
          sent.body?.blacklist?.length ||
          sent.body?.data === false ||
          sent.body?.data?.success === false
        )
          throw Object.assign(
            new Error(sent.body?.message || t('mediaSend.couldNotSendTheFileLink')),
            {
              definite: true,
            },
          )
      } else {
        const body =
          file.kind === 'image'
            ? {
                url: uploaded.url,
                width: file.width,
                height: file.height,
                name: file.name,
                size: file.data.byteLength,
                md5: uploaded.md5,
                format: file.mime.split('/')[1],
                emojiId: 0,
                emojiGroupId: '0',
              }
            : file.kind === 'voice'
              ? {
                  voiceKey: uploaded.docId,
                  nosKey: uploaded.nosKey,
                  voiceUrl: uploaded.url,
                  duration: Math.max(1, Math.round(file.duration! / 1000)),
                  localFile: false,
                }
              : {
                  videoKey: uploaded.docId,
                  nosKey: uploaded.nosKey,
                  videoUrl: uploaded.url,
                  duration: file.duration,
                  size: file.data.byteLength,
                  coverImage: cover
                    ? {
                        nosKey: cover.nosKey,
                        picIdStr: cover.docId,
                        url: cover.url,
                        width: file.width,
                        height: file.height,
                      }
                    : undefined,
                }
        const token = (await this.invoke('register_checktoken_v3', { timeout: 12000 })).body?.token
        if (!token) throw new Error(t('common.couldNotObtainAMessageVerificationTokenTry'))
        check()
        progress('sending', 100)
        attempted = true
        const result = await invoke('/api/communication/send/msg', {
          checkToken: token,
          sendMsgBody: JSON.stringify({
            scene: 1,
            receiverUserIds: request.target.uid,
            channelId: request.target.uid,
            symphonyId: '',
            refMsgBody: {},
            msgBody: {
              msgType: { image: 1, voice: 4, video: 5 }[file.kind],
              body: JSON.stringify(body),
              unikey: request.requestId,
              msgTime: receipt.time,
              status: 1,
              sendStatus: 0,
              sender: { user: { userId: destination.account.userId } },
              text: { textBody: '', atBody: [] },
            },
          }),
        })
        if ([-2, -1].includes(result.data?.msgBody?.status))
          throw Object.assign(new Error(t('mediaSend.neteaseDidNotAcceptThisAttachmentMessage')), {
            definite: true,
          })
        if (!result.data?.msgBody?.msgId)
          throw new Error(t('mediaSend.attachmentDeliveryCouldNotBeConfirmedRefreshThe'))
        receipt.messageId = String(result.data.msgBody.msgId || '') || undefined
        const confirmed = richMessageContent(result.data.msgBody).attachments?.filter(
          (item) => item.url && item.kind === receipt.attachments[0].kind,
        )
        if (confirmed?.length) receipt.attachments = confirmed
      }
      return { ok: true, receipt }
    } catch (error: any) {
      return {
        ok: false,
        error:
          signal.aborted && !attempted
            ? t('mediaSend.uploadCanceled')
            : error?.message || t('mediaSend.couldNotSendTheAttachment'),
        deliveryUnknown: attempted && !error.definite,
        code: typeof error.code === 'number' ? error.code : undefined,
      }
    }
  }
}
