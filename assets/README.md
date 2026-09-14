# Brand icons

The three Icon Composer projects are the source of truth for full application icons:

- `dev/app-icon.icon`
- `nightly/app-icon.icon`
- `prod/app-icon.icon`

Each project uses `text.svg` for its app mark and `background.svg` when the background is a vector layer. The development mark is the white Kata logo, and the nightly mark is the yellow Kata logo. Legacy source layers may retain their historical artwork. Additional layers use semantic names that describe their role and placement.

Run `vp run icons:export` from the repository root to regenerate the tracked iOS, Linux, Windows, and web assets. Hosted web and `apps/web/public` copies use the production web assets. Run `vp run icons:check` to verify that the generated assets and public copies match their sources without changing files.

Exporting requires Icon Composer 2 or newer on macOS. The script selects the newest compatible exporter from Xcode or a standalone Icon Composer installation and pins design generation 26. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override automatic discovery.

## macOS exports

Icon Composer's command-line exporter does not expose the `macOS pre-Tahoe` preset. A plain command-line `macOS` export is full bleed and is not suitable for the desktop app, so the export script intentionally leaves the tracked macOS PNGs unchanged and prints a reminder after every run.

After changing an Icon Composer project, open it in Icon Composer and export the macOS PNG with exactly these settings:

- Platform: `macOS pre-Tahoe`
- Appearance: `Default`
- Size: `1024pt`
- Scale: `1×`

Save the three exports to:

- `dev/app-icon.icon` -> `dev/blueprint-macos-1024.png`
- `nightly/app-icon.icon` -> `nightly/nightly-macos-1024.png`
- `prod/app-icon.icon` -> `prod/black-macos-1024.png`

The result must be a 1024×1024 PNG with the classic macOS safe area: the opaque icon body is 824×824, inset 100 pixels on every side, with only the native Icon Composer shadow extending into the surrounding transparent canvas.

To have Codex perform the native exports, paste this prompt into a task opened at the repository root:

```text
Use [@Computer](plugin://computer-use@openai-bundled) and the Icon Composer app to export the three macOS app icons in this repository.

For each project below, use Platform: macOS pre-Tahoe, Appearance: Default, Size: 1024pt, and Scale: 1×, then save the PNG to the exact destination:

- assets/dev/app-icon.icon -> assets/dev/blueprint-macos-1024.png
- assets/nightly/app-icon.icon -> assets/nightly/nightly-macos-1024.png
- assets/prod/app-icon.icon -> assets/prod/black-macos-1024.png

Do not resize, composite, or otherwise post-process the exported PNGs.

Verify every result is 1024×1024 and has the classic macOS safe area: an 824×824 opaque body inset 100px on every side, with only Icon Composer's native shadow extending beyond it.
```

Do not edit the generated PNG or ICO files directly.

## Android launcher and splash artwork

Kata Android launcher foregrounds use the existing variant universal PNGs from `assets/dev`,
`assets/nightly`, and `assets/prod`. Splash screens use each variant's iOS 1024 PNG.
`apps/mobile/app.config.ts` selects these assets through `BRAND_ASSET_PATHS`.

All three variants share two white silhouettes of the Kata mark in `apps/mobile/assets`:

- `android-icon-mark.png` is the 432×432 themed (monochrome) launcher icon. The mark fills 44% of the canvas height so it stays inside the circular launcher mask.
- `android-notification-icon.png` is the 96×96 notification small icon. The mark fills the 20dp live area of the 24dp icon.

`vp run icons:export` does not write these files. After changing the mark in
`dev/app-icon.icon/Assets/text.svg`, rerender both from the repository root with `rsvg-convert`
(`brew install librsvg`):

```sh
render() {
  sed "s|width=\"128\" height=\"128\" viewBox=\"0 0 128 128\"|width=\"$1\" height=\"$1\" viewBox=\"$2\"|" \
    assets/dev/app-icon.icon/Assets/text.svg | rsvg-convert -f png -o "$3"
}
render 432 "-44.545 -40.545 209.09 209.09" apps/mobile/assets/android-icon-mark.png
render 96 "4.8 8.8 110.4 110.4" apps/mobile/assets/android-notification-icon.png
```

Each viewBox centers the mark's 88×92 bounds in the source's 128-unit space and scales the canvas
so the mark reaches the target height.
