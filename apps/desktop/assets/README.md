<!-- Modified by DeskHead Inc. in 2026 for Deskhead (fork of Rakazo, Apache-2.0). -->
# Desktop icons

The shared editable source and export notes are in
[`packages/ui-tokens/assets`](../../../packages/ui-tokens/assets/README.md).

Mac packaging requires Xcode 26 or newer. Electron builder compiles `Deskhead.icon`
into `Assets.car` for Tahoe and generates `icon.icns` for older macOS versions.
`icon-macos.png` is the matching development export with Dock margins.

`icon.png` and `icon.ico` are matching orange exports for Linux and Windows.
Refresh them with `pnpm --filter @rakazo/ui-tokens export:brand`.
