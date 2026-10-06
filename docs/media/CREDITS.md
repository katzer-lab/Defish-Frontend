# Media

Nothing here is a photograph or third-party content.

| File | What it is | Source and licence |
|---|---|---|
| [`../examples/aquarium-synthetic.jpg`](../examples/aquarium-synthetic.jpg) | the picture uploaded in every screenshot and GIF | Drawn from scratch by a script in [`Defish-backend`](https://github.com/George2199/Defish-backend) (`docs/examples/make_test_image.py`, fixed seed, Pillow): a gradient, plants and four fish-like ellipses. Byte-identical copy. MIT, like this repository. |
| `*.png`, `*.gif` in this folder | screenshots and recordings of this page | Taken on 2026-10-04 with headless Chrome driven by the scripts in [`../capture/`](../capture/), against the backend stack with the **mock** inference service started with `MOCK_USE_LAYOUT=1`. The boxes sit on the drawn fish because the mock knows where they were drawn; the classes, confidences and advice are canned or taken from the backend's fixed texts, not a model's output. The yellow ring in the GIFs is a cursor drawn by the recording script. |

[`photo-unavailable.png`](photo-unavailable.png) was produced by letting the page receive a real API answer in which the script had set `original_image` to `null`, the shape the API returns when the photo has expired; the API was not put in that state.
