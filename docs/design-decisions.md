# Design decisions

Why the page works the way it does, what it replaced, and what was measured. *Measured* numbers come from [measurements/](measurements/): the same scenarios in headless Chrome against the client as it was (git commit `91b9954`) and the current one, with the backend stack
and its **mock** inference service. Each is one run; large differences are the point, small ones are noise.

Contents: [1](#1-heic-is-converted-in-the-browser) · [2](#2-the-page-polls-with-limits-instead-of-waiting-forever) · [3](#3-boxes-are-an-svg-over-the-photo) · [4](#4-the-crop-is-cut-in-the-browser) · [5](#5-errors-are-turned-into-sentences) ·
[6](#6-the-model-is-allowed-to-say-it-is-not-sure) · [7](#7-a-result-survives-the-loss-of-its-photo) · [8](#8-the-background-never-takes-the-page-down) · [9](#9-same-origin-by-default) · [10](#10-the-interface-is-english-and-the-code-says-so) ·
[Fixed while preparing these documents](#fixed-while-preparing-these-documents) · [Considered and not done](#considered-and-not-done)

## 1. HEIC is converted in the browser

**Problem.** Phones save photos as HEIC. Chrome and Firefox cannot show them in an `<img>`, so a thumbnail would be impossible, and the analysis service decodes images with OpenCV, which does not read HEIC in its usual builds (from the code of the inference service; not tested here).

**Decision.** A file that is HEIC/HEIF (by MIME type or by extension) is converted with `heic-to` into a JPEG of quality 0.92. That one JPEG is used for the thumbnail and for the upload, and the run button stays disabled until the conversion is done. The decoder is a 3.0 MB chunk (734 kB gzip) that is fetched with a dynamic `import()` only for HEIC files; everyone else downloads 100 kB.

**Checked.** A real HEIC file (made from the sample picture with `pillow-heif`) went through the page: thumbnail shown, and the backend's task metadata read `aquarium.jpg`, `image/jpeg` ([heic.txt](measurements/heic.txt)). Not checked: a large photo from a real iPhone (conversion time and memory), Live Photos, HDR variants.

## 2. The page polls with limits instead of waiting forever

**Decision.** Polling once per second (see [architecture.md](architecture.md#polling)). Server-sent events would avoid the traffic but need proxy settings; one cheap request per second is easy to proxy and easy to reproduce with `curl`.

**Before.** The loop ran up to 1000 times, handled only `canceled` and "ready", and slept only after a successful answer. Consequences, *measured*:

| Situation | Before | Now |
|---|---|---|
| the analysis fails on the server (`status: "failed"`) | the spinner turned for the whole 25 s of the observation, 25 requests, no message | message after 0.1 s: "The recognition service returned an error (HTTP 500)." |
| the API stops answering | 932 requests in 1.4 s (no pause after errors), then a message that the waiting time was exceeded (not true), 454,290 characters in the console | 5 requests, message after 4.3 s: "Could not reach the server. Check your connection." |
| cancel pressed | no note, one more request after the click | "Analysis canceled." and no more requests |

**Decision details.** Five failed requests in a row end the wait; one good answer resets the count; about seven minutes at most (the inference call itself may take up to 300 s, and the queue adds to it).
Cancel aborts the page's own request and tells the server; the server cannot stop a running model, so the worker stays busy until it returns.

## 3. Boxes are an SVG over the photo

An `<svg>` of exactly the displayed size lies over the `<img>`; each detection is a `<rect>` scaled by displayed / natural size. The size is read from the image on load and by a `ResizeObserver`, so the boxes follow when the window or the panel changes the photo's size. Rectangles take clicks, the rest of the SVG does not (`pointer-events`), so the photo stays selectable.
The alternative, drawing the boxes into a canvas together with the photo, would make them pixel-exact in exports but not clickable without hit-testing. A box is red or green only; no accessible alternative exists yet ([Limitations](../README.md#limitations)).

## 4. The crop is cut in the browser

The panel shows the fish that was clicked. The page already holds the full photo, so it draws the rectangle (natural pixels) into a canvas and shows the data URL: no request, no server storage, and it works for a cached result. The price is that a result needs its photo; see 7.

## 5. Errors are turned into sentences

`axios` messages such as "Request failed with status code 413" are useless to a person. `describeError` and `describeFailure` ([src/api.js](../src/api.js)) map what the backend says to plain sentences: file too large (with the limit parsed from the backend's `detail`), file not accepted (422), server unavailable (5xx), no connection, and the four failure texts of a task.
Everything unknown becomes "Could not complete the analysis." The technical error stays in the console.

## 6. The model is allowed to say it is not sure

The inference service marks a classification `uncertain` when its confidence is below a gate, and returns the three most probable classes. The old client ignored both, so a weak guess looked like a verdict. The panel now shows a note ("The model is not sure about this result: treat it as a hint.") and the top three with their probabilities. The box colour is unchanged (green / red by class).

## 7. A result survives the loss of its photo

The backend keeps the photo apart from the result and for a limited time. If the photo has expired the answer still has the diagnosis. The old page then drew an empty "Analysis result:" box and nothing else. Now it says that the photo is gone and lists the detections as buttons; the panel opens without a crop.
Checked in the browser with a real API answer whose `original_image` was set to `null` ([photo-unavailable.png](media/photo-unavailable.png)); covered by a test.

## 8. The background never takes the page down

See [architecture.md](architecture.md#the-background). Two defects were *measured* and fixed: a new WebGL context for every state change (20 per 20-move drag of the panel; now 0), and a blank page with a `TypeError` when WebGL is unavailable (now the page works, the background is off, a warning is logged). Tests: the renderer is created once across re-renders, and a failing renderer does not throw.

## 9. Same origin by default

`VITE_API_URL` is optional and defaults to `/api`, which is what the nginx template serves. Before, an unset variable sent uploads to `<origin>/undefined/analyze` (*measured*, answer 404, text "Request failed with status code 404").
For development against another port set `VITE_API_URL=http://127.0.0.1:8001` (the backend allows any origin).

## 10. The interface is English, and the code says so

Strings are written in the components; there is no translation layer. The interface, the error texts and the advice that comes from the backend are all English, like the README and these documents. The class codes the API sends (`fin_rot`, `oodiniosis`, ...) are turned into names by a small table in [src/classLabels.js](../src/classLabels.js); the colour logic still works on the codes. (The first versions of the page and of the backend were Russian; everything was switched to English on 2026-10-06, and the screenshots were taken again.)
`index.html` declares `lang="en"`.

## Fixed while preparing these documents

Found by running the page, not by reading it. Behaviour table: [behaviour-old-and-new.txt](measurements/behaviour-old-and-new.txt).

| Defect | Evidence | Now |
|---|---|---|
| a failed analysis (`status: "failed"`) was not handled | spinner for the whole observation, no message | message in 0.1 s |
| failed requests were retried without a pause | 932 requests in 1.4 s | pause, five failures end the wait |
| no stop on repeated errors, misleading "waiting time exceeded" | same run | readable message by kind |
| raw axios text for refused uploads | "Request failed with status code 413" | sentence with the limit |
| unset `VITE_API_URL` | upload went to `/undefined/analyze` | defaults to `/api` |
| the whole result was written to the console on every render | 138,393 characters for one analysis of a 23 KB photo (the photo is inside), 454,290 in the API-down run | 158 |
| a result without its photo showed an empty box | by reading the code, then in the browser | notice and list |
| `uncertain` and `top3` ignored | by reading the code | shown in the panel |
| WebGL context per render; blank page without WebGL | 20 contexts per drag; no `h1` and a `TypeError` | 0; page works |
| the "full width on phones" rule of the side panel lost to an inline style | 320 px panel on a 390 px screen (screenshot), now 390 | full width |
| nginx template: proxy to port 8000 (the API is published on 8001), no `client_max_body_size` | `/api/` answered 502; a 2 MB upload answered 413 by nginx | 200 and 200 ([nginx.txt](measurements/nginx.txt)) |
| `npm run dev` promised to listen on all interfaces (`HOST=0.0.0.0`), Vite ignores that variable | listened on 127.0.0.1 only | plain `vite`; `npm run dev -- --host` to expose it on purpose |
| `npm start` used `react-scripts`, which is not installed | by reading `package.json` | removed |
| lint failed (unused `isCanceled`, `process` undefined) | `eslint .`: 3 errors | clean |
| `axios` and two indirect dependencies had advisories | `npm audit --omit=dev`: 3 (2 high, 1 moderate) | 0 after `npm audit fix` (axios 1.20.0) |
| `index.html` said `lang="en"` over a Russian interface | by reading | `ru`; back to `en` when the interface became English |

## Considered and not done

| Idea | Why not (yet) |
|---|---|
| translations | one language (English) is enough for now; strings would move to a catalogue |
| keyboard and screen-reader access to the boxes, a colour-blind-safe scheme | the boxes are `<rect>`s without roles or labels and differ by colour only; needs a design |
| checking file type and size in the page before the upload | the backend refuses with a clear status and the page now shows it; a pre-check would duplicate the limit |
| server-sent events instead of polling | see 2 |
| TypeScript or schema validation of API answers | the contract is small; the tests pin the fields that are used |
| splitting `App.jsx` further (file choice, result view, panel) | the polling and request code is out already; the rest is one screen |
| end-to-end tests in CI | the Playwright scripts in [capture/](capture/) are run by hand; no CI exists |
