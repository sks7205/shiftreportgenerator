# Shift Report Generator (ARS-2)

Single-file offline-friendly shift report builder (`index.html`) that turns a photographed
production sheet and SAP breakdown screenshots into a ready-to-paste shift report.

## AI extraction

Sheet photos are read by an **Arena agent** through the Arena gateway — there is no Groq
dependency anywhere in the app.

| Setting | Value |
| --- | --- |
| Endpoint | `https://api.preview.arena.ai/v1/chat/completions` (OpenAI-compatible) |
| Model | `coding-router-preview` |
| Auth | `Authorization: Bearer <Arena API key>` |
| Batching | 3 images per request, merged into one figure set |

Two independent passes run per extraction, each with its own prompt:

* **Production sheet** → ARS-2 / ARS-3 / Bath / Warehouse figures, sheet heading (date + shift), SBH-mill and RMT remarks.
* **SAP breakdown log** → one structured event per row (equipment, issue, start, end, remarks) plus verbatim rows.

Both land in the review panel "placeholders" before anything is written into the report
sections. The one-click flow applies the same values straight into the report and keeps the
review panel available for corrections.

## Wiring the Arena API key

**Deployed (GitHub Pages):** add a repository secret named `ARENA_API_KEY`
(Settings → Secrets and variables → Actions). The deploy workflow injects it into
`index.html` at build time, so operators never type a key. If the secret is missing the
workflow warns and the page falls back to per-device entry.

**Local file / no secret:** open the AI panel, press **⚙️ API Key**, paste the key once.
It is kept in this browser only (`localStorage: ars_arena_api_key`).

Two optional `localStorage` overrides exist for advanced setups:

* `ars_arena_model` — a model id to try before `coding-router-preview` (plans that name their own model).
* `ars_arena_base` — a base URL to call instead of the preview gateway, e.g. a proxy
  (`https://my-proxy.example.com` → posts to `/v1/chat/completions`).

The gateway answers with either a plain string or content blocks; both shapes are accepted, and a
body rejected for `response_format` / `max_completion_tokens` is retried once without them.

> The key is baked into a static page, so anyone who views the deployed source can read it.
> Use a key you can rotate, and keep it out of any public fork.

## Tests

```bash
npm install
npm test        # logic, end-to-end, error paths, one-click flow (jsdom, stubbed gateway)
```
