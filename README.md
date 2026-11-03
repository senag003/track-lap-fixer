# Track Lap Fixer

Fix the lap distances of runs recorded on an indoor track, and edit `.fit` files from your watch: crop, merge, split, repair, fix heart rate, change device, export TCX/GPX/CSV. Everything runs in the browser; files never leave the device.

**Use it:** https://senag003.github.io/track-lap-fixer/

On iPhone, open the link in Safari, tap Share → **Add to Home Screen**. It then works like an app, also offline.

## Files

- `index.html`, `manifest.webmanifest`, `sw.js`, `icon-*.png` — the web app (built).
- `src/` — sources. Build with `python src/build_serve.py <artifact.html> --pwa <outdir>` (run from `src/`, needs the files next to it).
