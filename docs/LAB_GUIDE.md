# Laboratory guide

## Ask a reproducible question

1. Open **Experiments** and choose a card whose question interests you, or select **Surprise me**.
2. Pause before changing geometry if you want a clean initial condition.
3. Select a probe or portal mouth and adjust only the variable you want to test.
4. Save a snapshot before running. This gives the experiment a reliable reset point.
5. Run, single-step, or scrub the timeline while watching the event and energy views.
6. Copy a share link when the setup is worth comparing or remixing.

## Read an unexpected event

The event log distinguishes three physical outcomes:

- **Traversal:** the body approached an allowed side, crossed the swept plane, and fully cleared both finite rims.
- **Rim impact:** the body’s finite radius intersected an aperture endpoint; a centerline crossing alone is not enough.
- **Rear-plate impact:** a one-sided mouth was approached from its solid side.

Selecting an event reveals the facts emitted by the solver. Expanding rings on the Canvas mark recent event positions.

## Interpret energy carefully

The graph samples ordinary body kinetic energy plus mass times the project’s canonical scalar potential. Relative drift is measured against the first sample in the current analysis branch.

Passive fixed mouths should not create net energy around a complete route. Damping and inelastic impacts intentionally remove mechanical energy. A moving portal makes the field and collision boundary time-dependent, so a body can gain or lose energy. The **Moving-contact ΔK** value reports the body kinetic-energy change at those contacts; it is not a full decomposition of actuator work, potential change, and dissipative loss.

## Timeline versus undo

- The timeline records simulated motion and lets you inspect or branch from an earlier moment.
- Undo and redo record deliberate edits such as placement, geometry, object properties, and parameters.
- Resuming or stepping after a scrub truncates the abandoned future and records a new branch.
- Visual overlay changes do not erase the motion timeline.

## Canonical assumptions

- Mouths are paired by adjacency: `0 ↔ 1`, `2 ↔ 3`, and so on.
- Position and vectors preserve the along-aperture coordinate and flip the through-plane normal.
- Gravity coupling is reciprocal even when matter traversal is one-sided.
- Portal mouths are zero-thickness kinematic apertures with solid endpoint rims.
- Moving-frame velocity transfer subtracts the entrance-frame velocity, transforms the relative velocity, then adds the exit-frame velocity.

See `PHYSICS_MODEL.md` in this folder for the equations and known numerical limitations.
