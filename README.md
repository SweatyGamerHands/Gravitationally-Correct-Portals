# Gravitationally Correct Portals

An interactive React + Canvas sandbox for a **conservative Newtonian portal-physics model**. It focuses on coherent 2D portal transforms, gravity coupled through linked apertures, continuous traversal, and field visualizations that agree with object motion.

This is not a complete general-relativity simulation. It is a deliberate educational model: local and linked-image potentials are combined symmetrically, matched mouths share one seam potential, and acceleration is derived from that scalar field's negative gradient. Fixed passive mouths therefore cannot manufacture energy around a closed portal loop.

## Features

- Canonical portal transform for points, vectors, velocity, acceleration, and residual frame motion.
- One authoritative scalar-potential sampler used by body physics, flow arrows, heatmap, streamlines, and grid distortion.
- Full reciprocal gravitational coupling through finite apertures, independent of whether matter traversal is one-sided.
- Smooth symmetric linked-potential coupling with finite-aperture edge and range falloff.
- Fixed-timestep physics accumulator for better render-frame invariance.
- Swept portal crossing helpers, rim collision geometry, and speed-preserving portal motion in vacuum.
- Swept moving-mouth traversal with frame-relative velocity transfer, one-sided back-face response, and moving-rim impacts.
- Collision-aware ball spawning with a 64-body safety cap for the quadratic multi-body solver.
- Retina-aware canvas sizing for crisp iPhone/Safari rendering.
- Dark neon portal aesthetic with flow arrows, field heatmap, RK4 streamlines, trails, metrics, and debug axes support.

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

- `src/App.tsx` — React UI, high-DPI canvas rendering, controls, and orchestration of fixed-step simulation.
- `src/simulation/portalTransform.ts` — canonical portal coordinate and vector transforms.
- `src/simulation/fieldSolver.ts` — authoritative aperture-transported gravity sampler.
- `src/simulation/integrator.ts` — fixed-step-friendly integration and drag pinning helpers.
- `src/simulation/editor.ts` — immutable portal editing and collision-aware spawn placement.
- `src/simulation/movingPortal.ts` — swept moving-mouth crossings, moving-frame velocity mapping, and kinematic contacts.
- `src/simulation/portalTraversal.ts` — swept aperture crossing and teleport mapping helpers.
- `src/simulation/collisions.ts` — portal rim collision geometry.
- `src/simulation/visualization.ts` — RK4 field-line integration helpers.
- `src/simulation/physics.ts` — compatibility barrel for simulation helpers.
- `src/tests/simulation.test.ts` — regression tests for transforms, field solving, traversal, collisions, drag, and frame-rate invariance.
- `docs/PHYSICS_MODEL.md` — equations, assumptions, traversal algorithm, tolerances, and limitations.
