# Music Party

[简体中文](README.md)

Music Party is an unofficial desktop player for NetEase Cloud Music’s **Listen Together** group rooms. Join friends who use the official mobile app, listen in sync, add songs to the shared queue, chat in the room, and exchange private messages.

[Download v0.13.1 for Windows or Linux (x64)](https://github.com/tabidachinokaze/music-party/releases/tag/v0.13.1) · [Report an issue](https://github.com/tabidachinokaze/music-party/issues)

## Join your first listening room

1. Scan the player’s sign-in QR code with the NetEase Cloud Music mobile app. Click the headphones in the playback bar to open **Listen Together**.
2. Paste a friend’s group invitation link, or choose a song to create a room and share the invitation. If your account is already in a room, you can resume it from the same panel.
3. Songs you recommend enter the room’s shared queue. Pausing on your computer pauses playback only on that device.

Click the album cover in the playback bar to open **Now Playing**. In a narrow window, use the lyrics button to see the full lyrics.

The interface follows your system’s preferred languages on first launch and falls back to English. You can also choose English, Simplified Chinese, Traditional Chinese, or Japanese under **Settings → Appearance → Interface language**.

## Development

With Node.js 24 and pnpm 11.26.0 installed, run these commands from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm dev
```

Run `pnpm run check` to check types and formatting, run unit tests, and build the app. The [player guide](docs/ADAPTIVE-PLAYER.md), [API reference](docs/ui-data/README.md), and [release instructions](docs/RELEASING.md) are in Chinese.

## License

Music Party’s source code is licensed under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`). Third-party components are subject to their respective terms. [License text](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
