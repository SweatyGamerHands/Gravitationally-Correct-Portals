# Portal Field Laboratory

An interactive React and Canvas laboratory for asking reproducible questions about an idealized, conservative Newtonian portal model. The project combines swept finite-aperture traversal, moving coordinate frames, reciprocal gravity coupling, rewindable experiments, and analysis tools in one self-contained browser app.

This is deliberately not a claim about real portals or a general-relativity solver. The default model is opinionated and internally consistent: passive linked mouths share a seam potential, fixed portal transforms preserve speed, one-sided matter traversal does not make gravity one-way, and kinematically moving mouths can exchange energy with bodies.

## Laboratory workflow

- Pause, resume, slow the clock, advance one fixed step, rewind, and scrub roughly 30 simulated seconds of sampled history.
- Undo and redo placements and parameter changes without an artificial history cap.
- Select any probe or portal mouth from the canvas or the keyboard-accessible entity list, then edit its live state.
- Save named browser-local snapshots and restore them immediately.
- Copy a share link containing the setup, random seed, motion programs, and simulation time. Saved worlds are fitted uniformly when opened at another viewport size.
- Start from ten question-first experiment cards or generate a deterministic, valid “Surprise me” configuration.

## Observation tools

- Velocity and sampled-gravity vectors.
- Portal coordinate frames, one-sided rear plates, rim/clearance guides, debug axes, trails, field arrows, heatmap, streamlines, and grid warping.
- An event log for traversals, rim impacts, and rear-plate contacts, with concise causal explanations.
- Kinetic, potential, and total-energy graphs with relative drift reporting.
- A separate moving-contact kinetic-energy ledger; it is intentionally labeled as an observable, not a complete actuator-work proof.
- A Physics Assumptions panel that separates canonical defaults from speculative interpretations not implemented by the model.

## Portal and object controls

- Drag a full portal segment, rotate it with its handle, resize it numerically, or choose one- versus two-sided matter traversal per mouth.
- Program static, linear, circular, or combined positional/rotational motion independently for each mouth.
- Create up to four adjacent linked pairs.
- Add, duplicate, delete, rename, reposition, resize, and change the mass or velocity of circular probes.
- A 64-body safety limit protects the quadratic body-collision pass.

## Built-in experiments

The library includes infinite fall, a moving-mouth launcher, rotating-exit slingshot, rear-plate comparison, portal ping-pong, near-rim and exact-clearance tests, matched moving frames in zero gravity, a one-sided bulldozer, and a two-pair relay.

## Windows one-click app

Prerequisite: Node.js 20.19 or newer.

Double-click `Install Portal Field Laboratory.cmd` once. It adds **Portal Field Laboratory** to both the Desktop and the current user's Start menu. After that, opening either shortcut works like opening a normally installed app:

- The production build is refreshed automatically only when project files have changed.
- A private helper service runs on `127.0.0.1`; it is not exposed to the network.
- Edge or Chrome opens the laboratory in a dedicated app window without browser tabs.
- The helper shuts itself down after the app has been closed and left idle for ten minutes.

No administrator access is required. Double-click `Launch Portal Field Laboratory.cmd` for a portable one-click launch without installing shortcuts, or `Uninstall Portal Field Laboratory.cmd` to remove only the two shortcuts.

Keep this project folder in its current location while the shortcuts are installed, because they point to the launcher inside it. Uninstalling preserves the dedicated browser profile in `%LOCALAPPDATA%\Portal Field Laboratory` so snapshots and other browser-local laboratory data remain available if the shortcuts are reinstalled.

## Run for development

For live code editing:

```bash
npm install
npm run dev
```

The development server uses port `3000` and binds to `0.0.0.0`.

## Quality checks

```bash
npm run typecheck
npm test
npm run test:coverage
npm run build
```

## Project structure

- `src/App.tsx` — application state, responsive Canvas rendering, timeline/history orchestration, inspectors, and analysis wiring.
- `src/components/` — transport controls, experiment library, event log, energy chart, snapshots, tooltips, and assumptions dialog.
- `src/lab/` — versioned experiment documents, safe share codec, unlimited history, responsive world fitting, seeded randomness, and presets.
- `src/simulation/` — portal transforms, field solver, fixed-step integration, collisions, moving-mouth sweeps, traversal, and visualization helpers.
- `src/tests/` — regression coverage for physics, state serialization, security bounds, responsive fitting, histories, motion paths, and presets.
- `docs/PHYSICS_MODEL.md` — equations, assumptions, traversal rules, energy interpretation, and limitations.
- `docs/LAB_GUIDE.md` — a concise guide to running and interpreting experiments.

## Current model boundary

The app supports circles and kinematic portal mouths. It does not yet solve articulated or deformable bodies spanning both sides, reaction forces on dynamic portal frames, user-routed portal graphs, electromagnetic forces, or recursive gravity images. Those require explicit new physical assumptions and should be introduced as named experimental models rather than silent switches.
