# Daily Bottle Flip

One flip. Once a day. Everyone gets the same bottle.

This is the **Phase 1 prototype** from the pitch: one kitchen scene, motion-sensor flick input, a physics bottle and landing tiers, played in a phone browser. Its job is to prove the flip *feels* right before anything daily, social or backend gets built.

**Phase 1 gate:** new players land 25–45% of flips and keep warming up without being asked.

## Play / test

| What | How |
|---|---|
| Play on a phone | Open the GitHub Pages URL (HTTPS is required for motion sensors). Hold the phone upright, tap **PRESS START**, then snap your wrist up and back. |
| Tune on a phone | Add `?debug` to the URL. A collapsed panel (top right) holds tuning sliders, a landing-window map and the raw flick log. |
| Tune on desktop | `npm run dev`, open `http://localhost:5173/?debug`, and press **Space** or **FIRE** for synthetic flicks. |
| Balance headlessly | `npm run sweep` prints a tier map over flick space and land rates for a simulated player. |

Every flick (real or synthetic) is logged on the device with its raw sensor peaks, mapped launch and result. In `?debug`, use **copy log JSON** to collect playtest data from friends' phones.

## Deploying (GitHub Pages)

1. Create an empty GitHub repo and push `main` to it.
2. In the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**.
3. Every push to `main` builds and deploys via `.github/workflows/deploy.yml`.

## How it works

```
src/
  config.ts            all tuning values (P), bottle geometry
  physics/bottleSim.ts 2.5D sequential-impulse sim: light shell + 2 water slugs on a slider joint
  input/motion.ts      DeviceMotion -> one flick (peak rotation + peak linear accel)
  input/flickMap.ts    flick peaks -> launch (vy, spin) + spin "magnet" assist
  render/retro.ts      low-res render target, vertex snap, affine UVs, Bayer dither to 15-bit
  render/textures.ts   procedural pixel textures
  scene/kitchen.ts     the Stage 01 diorama
  scene/bottleMesh.ts  bottle, water slugs, blob shadow
  ui/stats.ts          local stats + flick log
  ui/debug.ts          ?debug panel
  main.ts              state machine, camera, slow-mo, HUD
```

**Why the water matters.** In flight, centrifugal pull spreads the two water slugs toward both ends of the bottle. That raises the moment of inertia, and because angular momentum is conserved, the spin slows. On touchdown, only the light plastic shell is stopped by the counter; the heavy water slides on down the axis and slams into the base, planting the bottle. A one-lump rigid body can't do this, and in testing it was almost impossible to land.

**Landing tiers**

- **CAP LANDING:** comes to rest upside down on the cap.
- **CLEAN:** upright, tilts less than `cleanTiltDeg` after touchdown, no bounce.
- **WOBBLE SAVE:** upright after a bigger tilt or a bounce.
- **MISS:** on its side, off the edge, or no flip at all.

**Difficulty dials** (all in `?debug`)

- `assist`: the spin magnet. Flicks within roughly ±`assistWidth` of the ideal spin get pulled toward it, and wild flicks stay wild. The ideal spin is found by bisection on the sim itself, so it adapts to fill level and future daily twists.
- `landingGrip`: how much spin the landing soaks up. It stands in for sideways slosh and base squish.
- `spinScale`, `launchBase`, `launchScale`: wrist-to-bottle mapping. These need real phone data.

The sweep's player model gives these land rates (`landingGrip` 45):

| assist | spin error σ 10% | σ 20% | σ 30% |
|---|---|---|---|
| 0 | 63% | 45% | 37% |
| 0.4 | 80% | 60% | 48% |

How consistent real phone flicks are is unknown until playtesting. That's what the flick log is for.

## Decisions log (Phase 1 interview, 2026-11-07)

| Decision | Choice |
|---|---|
| Scope | Phase 1 only: no daily seed, share card, streaks or backend yet |
| Stack | Vite + TypeScript + Three.js, custom physics |
| Physics | 2.5D planar sim in a 3D world |
| Camera | Side-on with a slight 3/4 angle; slow-mo push-in on landing |
| Input | Portrait, wrist flick up-and-back; phone sensors only (no mouse fallback) |
| Dev tools | Hidden `?debug` panel |
| Assets | Procedural, generated in code |
| Hosting | GitHub Pages via Actions |
| Tiers | Cap / Clean (<12° tilt, no bounce) / Wobble save / Miss |

## Open questions for playtesting

- **Cap landings are very rare** (about 0–1%; the pitch targets 2–5%). Should they be a deliberate half-flip shot, or a lucky accident on normal flips?
- Should the flick use total rotation rate (current) or only the up-and-back axis (`beta`)? The log records both.
- Android devices without `event.acceleration` fall back to a gravity-filtered estimate. Check `accSource` in the log.
