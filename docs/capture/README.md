# Scripts that took the screenshots and the measurements

Everything under `../media/` and `../measurements/` was produced by these scripts on 2026-10-04. They drive Chrome with [playwright-core](https://www.npmjs.com/package/playwright-core) (no browser is downloaded: it uses the Chrome that is installed)
against a Vite dev server and the `Defish-backend` docker-compose stack with its **mock** inference service.

```bash
npm install --no-save playwright-core            # in this folder; node_modules is ignored by git

# backend (in a checkout of Defish-backend; .env as in its README), boxes on the fish of the sample picture, 3 s for a "slow" file:
MOCK_USE_LAYOUT=1 MOCK_DELAY_SECONDS=3 docker compose -f docker-compose.yml -f docs/examples/docker-compose.mock-ml.yml up -d --build

# frontend (in the repository root)
VITE_API_URL=http://127.0.0.1:8001 npm run dev &
```

| Script | What it does | Variables |
|---|---|---|
| `screens.mjs` | screenshots of every state: empty, photo chosen, analysing, boxes, the three panels, canceled, failed, too large, photo unavailable, phone, light scheme | `FE`, `PHOTO`, `BIG` (a file over 10 MB), `OUT_DIR` |
| `gifs.mjs` | frames of the two scenarios through the DevTools screencast; a ring is drawn at the mouse position, headless Chrome has no cursor | `FE`, `PHOTO`, `OUT_DIR` |
| `behaviour.mjs` | six situations (normal, failed analysis, 413, API killed mid-wait, cancel, no API address); prints JSON | `FE`, `FE_NOURL`, `PHOTO`, `BIG`, `API_CONTAINER` |
| `webgl.mjs` | WebGL contexts created by dragging the panel; the page with WebGL disabled | `FE`, `PHOTO` |
| `heic.mjs` | uploads a HEIC file and reads what the backend received | `FE`, `HEIC`, `REDIS_CONTAINER` |
| `nginx-check.sh` | the nginx template in a container, three configurations | `T` (folder with the configs, `dist/`) |

GIFs are built from the frames:

```bash
cd out/frames/flow && ffmpeg -f concat -safe 0 -i list.txt \
  -vf "fps=8,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" flow-upload-to-diagnosis.gif
```

`behaviour.mjs` was run on the client as it was (`git archive 91b9954` into another folder, its own dev server) and on the current one; the scenarios that kill the API need access to `docker`.
