# Gravitationally Correct Portals

An interactive React + Canvas sandbox for experimenting with portal-linked gravity fields, collision response, and momentum transfer through paired apertures.

## Features

- Canvas-based 2D physics simulation with configurable substeps.
- Paired portals that reorient motion and gravity across the bridge.
- One-sided or two-sided portal entry modes.
- Draggable balls, portals, and portal rotation handles.
- Visual field-flow arrows, warped grid overlay, and speed-based trails.
- Node test coverage for core simulation math and known portal-edge regressions.

## Run locally

**Prerequisite:** Node.js 20+

```bash
npm install
npm run dev
```

The dev server starts on port `3000` and binds to `0.0.0.0` for container-friendly previews.

## Quality checks

```bash
npm test
npm run lint
npm run build
```

## Project structure

- `src/App.tsx` — React UI, canvas rendering, and the live simulation loop.
- `src/simulation/physics.ts` — shared math helpers for integration, gravity, portal crossing, collision geometry, and drag pinning.
- `src/simulation/Ball.ts` — standalone ball model used by focused simulation tests.
- `src/tests/simulation.test.ts` — Node test suite for physics and portal edge cases.
