<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/926d1ecf-388c-4054-ac11-c6755c54b790

## Security note

`GEMINI_API_KEY` is **server-only**. Never expose it in frontend code, Vite `define` config, or browser bundles. All Gemini calls should go through the backend endpoint (`POST /api/gemini`).

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set `GEMINI_API_KEY` in `.env.local` (for your local server runtime only).
3. Start the frontend app:
   `npm run dev`
4. In a second terminal, start the Gemini proxy server:
   `npm run server`

## Gemini proxy API

Send Gemini requests to:

- `POST /api/gemini`
- JSON body shape (minimal):

```json
{
  "model": "gemini-2.5-flash",
  "contents": [{ "role": "user", "parts": [{ "text": "Hello" }] }]
}
```

The server injects `GEMINI_API_KEY` from runtime env and forwards to Google Gemini.
