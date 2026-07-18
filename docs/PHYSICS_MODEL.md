# Physics model

This project implements an **idealized Newtonian portal model**, not a complete general-relativity simulation. The sandbox keeps ordinary CSS-pixel world coordinates and uses deterministic fixed-step integration; portals are zero-thickness apertures with solid rims.

## Coordinate conventions

A portal has a center `C`, tangent unit vector `t = (cos(angle), sin(angle))`, and front normal `n = (-sin(angle), cos(angle))`. A world point `p` is represented in portal-local coordinates by:

```text
along  = dot(p - C, t)
normal = dot(p - C, n)
```

The local point returns to world space as:

```text
p = C + along * t + normal * n
```

Portal arrays contain adjacent reciprocal pairs: indices `0 <-> 1`, `2 <-> 3`, and so on. An unpaired final portal is inert rather than silently linking into a ring.

## Portal transform

Entry-to-exit mapping preserves the aperture coordinate and flips the through-plane normal:

```text
along'  = along
normal' = -normal
```

Vectors, velocities, accelerations, and residual displacements use the same basis transform:

```text
v_along  = dot(v, entry.t)
v_normal = dot(v, entry.n)
v'       = v_along * exit.t - v_normal * exit.n
```

This preserves vector magnitude and makes the inverse transform the same operation with entry and exit swapped.

## Portal-transported gravity field

The authoritative field sampler is `sampleField` / `computeGravityAt`. It starts with uniform baseline acceleration `g = (0, BASE_G * gravityMultiplier)`. For each visible portal aperture, the solver computes a smooth aperture-visibility weight using:

- edge softness around finite aperture endpoints,
- subtended-angle-like decay with distance from the aperture,
- optional one-sided front-face rejection,
- inverse-square-style range falloff.

Each branch transports the gravity vector from the linked side through the canonical acceleration transform. Direct and transported branches are normalized into a unit-leakage field, then `portalPull` linearly scales that field's deviation from ambient gravity. Recursive branches compose their vector transforms back into the original sample frame, are limited by `maxDepth`, attenuated geometrically, and clamped by `fieldClamp` to avoid runaway feedback for portal-facing-portal setups.

Because this is a blended vector field, it is intentionally educational and coherent rather than a claim of exact conservative physics.

## Integration and traversal

Live objects use explicit velocity state. The render loop accumulates elapsed time and advances physics in fixed `1/120 s` quanta, with optional internal substeps for collision quality. Large suspended-tab deltas are clamped before entering the accumulator.

Portal crossings are swept from previous to proposed positions. The earliest plane intersection inside the finite aperture maps the crossing point, velocity, and remaining displacement through the same canonical transform. A small separation epsilon prevents immediate precision recrossing without acting as the primary correctness mechanism.

Rim geometry is treated as circular endcaps at the aperture endpoints. Traversal requires the entire body to clear those endcaps. Both traversal and rim impacts use swept time-of-impact tests, so a fast body cannot tunnel through a rim between fixed steps.

Portal placement and rotation are kinematic editor operations rather than simulated portal motion. While either endpoint is being dragged, traversal and split-body rendering are disabled for that reciprocal pair, and the moving endpoint does not collide with bodies. On release, a body intersecting the edited aperture is translated to the nearest clear side, its incoming normal velocity is removed, and its tangential velocity is preserved. This prevents an editor gesture from manufacturing a crossing or a high-energy collision.

## Visualization strategy

Field arrows, heatmap, streamlines, grid distortion, trajectory-related calculations, and body acceleration all sample `computeGravityAt`. The grid is presented as a field-distortion visualization, not a literal spacetime metric. Streamlines are seeded near portal mouths and integrated with RK4 through the same vector field.

## Mobile and performance

The canvas is sized in CSS pixels for physics and rendered at bounded `devicePixelRatio` for Retina crispness. Visualization quality is deliberately low-resolution for heatmaps and sparse for streamlines so the authoritative physics remains stable on mobile Safari.

New bodies are placed into the first collision-free launch slot instead of sharing one exact coordinate. The UI caps the population at 64 because the circle-circle collision pass is quadratic in body count.

## Known limitations

- The field blend is not a conservative potential field.
- Portals are ideal zero-thickness apertures with simplified rim collision geometry.
- Recursive gravity branches are depth-limited for determinism and performance.
- Multiple dynamic rigid bodies use circle approximations rather than full rigid-body rotation.
