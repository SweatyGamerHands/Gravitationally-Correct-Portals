# Gravitationally Correct Portals

An interactive React + Canvas sandbox for an **idealized Newtonian portal-physics model**. It focuses on coherent 2D portal transforms, aperture-transported gravity, continuous-looking traversal, and field visualizations that agree with object motion.

This is not a complete general-relativity simulation. It is a deliberate educational model: uniform gravity is smoothly blended with linked-aperture gravity transported through paired portal frames.

## Features

- Canonical portal transform for points, vectors, velocity, acceleration, and residual frame motion.
- One authoritative field sampler used by body physics, flow arrows, heatmap, streamlines, and grid distortion.
- Smooth finite-aperture gravity influence with distance/edge falloff, one-sided support, recursive attenuation, and magnitude clamping.
- Fixed-timestep physics accumulator for better render-frame invariance.
- Swept portal crossing helpers, rim collision geometry, and speed-preserving portal motion in vacuum.
- Kinematic portal editing that suspends traversal during drag and separates intersecting bodies safely on release.
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
- `src/simulation/editor.ts` — safe portal-edit finalization and collision-aware spawn placement.
- `src/simulation/portalTraversal.ts` — swept aperture crossing and teleport mapping helpers.
- `src/simulation/collisions.ts` — portal rim collision geometry.
- `src/simulation/visualization.ts` — RK4 field-line integration helpers.
- `src/simulation/physics.ts` — compatibility barrel for simulation helpers.
- `src/tests/simulation.test.ts` — regression tests for transforms, field solving, traversal, collisions, drag, and frame-rate invariance.
- `docs/PHYSICS_MODEL.md` — equations, assumptions, traversal algorithm, tolerances, and limitations.
