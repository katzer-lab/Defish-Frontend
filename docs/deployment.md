# Deployment

The page is a static build. Everything dynamic is in the API ([fish-demo_backend](https://github.com/George2199/fish-demo_backend)).

Contents: [Build](#build) · [Serving with nginx](#serving-with-nginx) · [Development server](#development-server) · [What was verified](#what-was-verified)

## Build

Requires Node 20.19+ or 22.12+ (the requirement of Vite 7). Checked with Node 26.10.0 and npm 11.

```bash
npm ci
npm run build          # dist/: index.html, assets/*.css, assets/*.js, logo.png, cancel.png
```

| Variable | When | Meaning | Default |
|---|---|---|---|
| `VITE_API_URL` | **build time** (it is compiled into the page) | base URL of the API, without a trailing slash | `/api` |
| `PORT` | development server only | port of `npm run dev` | `5173` |

Examples: `VITE_API_URL=http://api.example:8001 npm run build` for an API on another origin (the backend allows every origin); no variable for the nginx setup below.

## Serving with nginx

[`nginx/fish-demo.conf.template`](../nginx/fish-demo.conf.template) serves `dist/` and proxies `/api/` to the API on the same host, so the browser sees one origin.
Replace `HOST_IP_OR_DOMEN` (`server_name`) and `/path/to/fish-demo_frontend/dist` (`root`), then `nginx -t && nginx -s reload`. The template has no TLS.

What it contains and why:

- `client_max_body_size 12m;`: nginx refuses request bodies over **1 MB** by default, which turns most phone photos into `413` before the API sees them. The API accepts 10 MB (`MAX_UPLOAD_MB`), so 12 MB leaves room for the multipart envelope; change both together.
- `proxy_pass http://127.0.0.1:8001/;`: the backend's docker-compose file publishes the API on `127.0.0.1:8001`. The trailing slash strips `/api/`.
- `X-Real-IP` and `X-Forwarded-For` are set; the API stores the client address taken from them.
- `try_files $uri $uri/ /index.html;`: any path serves the page.

The template was tested in a container (`nginx:alpine`, host network) against the backend stack, with the production build mounted: [measurements/nginx.txt](measurements/nginx.txt), script [capture/nginx-check.sh](capture/nginx-check.sh).
As it was in the repository the template answered `/api/` with 502 (port 8000) and a 2 MB upload with 413; with only the port corrected the upload still got 413; now both succeed.

## Development server

```bash
VITE_API_URL=http://127.0.0.1:8001 npm run dev      # http://localhost:5173, localhost only
npm run dev -- --host                              # also on the network, for a phone on the same Wi-Fi
```

Vite listens on `127.0.0.1` unless told otherwise. The old `dev` script set `HOST=0.0.0.0`, which Vite ignores (measured: it listened on 127.0.0.1 only), so it was replaced by plain `vite` and the flag above.
To get a backend to talk to, start the stack of `fish-demo_backend` with its mock inference service (`MOCK_USE_LAYOUT=1`, see the [README](../README.md#quick-start)).

## What was verified

| | Status |
|---|---|
| `npm ci`, `npm test` (35 tests), `npm run lint`, `npm run build` in a clean copy of what a commit would contain | run, 2026-10-04 |
| the page against the backend stack with the mock inference service: upload, polling, boxes, panel, cancel, failure, 413, API stopped mid-wait, a HEIC file | run in headless Chrome, [measurements/](measurements/), [media](media/) |
| the nginx template with the production build, in a container | run, [nginx.txt](measurements/nginx.txt) |
| the real inference service, real phone photos, Safari, Firefox, a real mobile browser | **not run** |
| TLS, a CDN, caching headers, the production host | **not exercised** |
| continuous integration | none; no workflow has run on GitHub |
