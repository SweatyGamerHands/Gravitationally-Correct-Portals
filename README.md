<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/926d1ecf-388c-4054-ac11-c6755c54b790

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Dependency notes for contributors

- `@types/node` is intentionally retained because TypeScript checks `vite.config.ts`, which imports Node's `path` module.
- `tailwindcss` is intentionally retained as an indirect build dependency, consumed by the `@tailwindcss/vite` plugin and `@import "tailwindcss"` in `src/index.css`.

- Remaining dependencies are mapped as follows: `react`/`react-dom`/`lucide-react`/`motion` are imported from `src/*.tsx`, and `vite`/`@vitejs/plugin-react`/`@tailwindcss/vite`/`tailwindcss` are imported or referenced by `vite.config.ts` and `src/index.css`.
