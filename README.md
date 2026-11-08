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

### Big Screen Mode (computer + phone)

On a computer, **PRESS START** shows a QR code. Scan it with your phone and tap **CONNECT** (and **Allow** motion on iPhone). The phone becomes the controller: it reads the flick and sends it over WebRTC (PeerJS; its free public broker only introduces the two devices). The computer runs the physics and the scene. Use `?solo` to force phone-style play and `?host` to force Big Screen Mode.

In dev, `npm run dev` serves over self-signed HTTPS, and the QR code points at your computer's Wi-Fi address. Both devices need to be on the same network, and the phone must accept the certificate warning once.

Every flick (real or synthetic) is logged on the device with its raw sensor peaks, mapped launch and result. In `?debug`, use **copy log JSON** to collect playtest data from friends' phones.

## Deploying (GitHub Pages)

1. Create an empty GitHub repo and push `main` to it.
2. In the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**.
3. Every push to `main` builds and deploys via `.github/workflows/deploy.yml`.

## Look

Everything is a pencil-and-ink sketch: paper white, hatched shadows, black outlines that wobble slightly. The bottle is the only thing in colour. A landing floods the world with colour, spreading out from the bottle; a miss leaves it a sketch. The camera sits behind the thrower's hand.

## The flick: hold, swing, release

Phone flat on your palm. The bottle hangs from its cap in your hand and follows your phone's **pitch** (the front edge tipping up), read from `deviceorientation`, so it's a real angle that doesn't drift. Swing it up and the bottle lets go on its own:

- at **`releaseAngle`** of pitch past where you started (default 65°), or
- at the **peak of a swing faster than `releaseRate`** (default 400°/s), once past 40°.

At that moment the bottle keeps exactly the spin and swing speed it had, plus a lift from the flick's power that levels off at `liftMax` however hard you flick (`launchScale` sets how fast it gets there), so the throw comes from the swing itself. The spin magnet (`assist`) then nudges near-misses toward the ideal spin for that exact pose. `swingGain` is how far the bottle swings per degree of phone pitch; make it negative if it swings the wrong way on your phone.

**Taming overshoot.** Three dials keep a too-fast flick from flying off:
- `releaseSpin` (0.85): fraction of the swing's spin the bottle keeps. Lower it and you need a faster flick to land.
- `releaseCarry` (0.5): fraction of the swing's upward/forward speed the bottle keeps. Lower means height depends less on spin, so an overshoot over-rotates a little instead of rocketing up.
- `overshootForgive` (0.5): up to 40% too fast counts only half as much. Beyond that it passes through, so big double-flip swings still work.

In `?debug` there's **fit to my last 8 flicks**: after a few real throws it sets `releaseSpin` so your typical release speed sits on the target. Copy the tuning JSON to keep it.

Rough numbers from `npm run sweep`: around **770°/s** of pitch speed at release lands, with a window about 160°/s wide. A gentle ~250-300°/s flip can land on the **cap**.

The **Speed** (pitch speed) and **Power** (acceleration) meters, vertical bars at the screen edges, show live readings, the last release's peaks, and a hatched target zone for speed at that power.

## Colour fill and x-ray

A landing floods the world with colour from the bottle outward over about 3.4 s. A paired phone gets the same wash: a flat disc of colour with an ink rim that grows from the middle of the controller screen.

When something blocks the camera's view of the bottle (a cabinet, the island body), a paper cutaway circle with an ink rim opens over it and the bottle is drawn inside (`src/scene/xray.ts`).

## The kitchen is solid

The island (top and edges), the back counter, the back wall, the hanging lamp and the floor are all colliders (`src/physics/world.ts`; the scene is built to match). A bottle can catch the island's edge and tip off, bounce off the lamp or the wall, or fly all the way to the back counter and land there. Coming to rest on the floor is a miss.

## Stars: how cool was that?

Every landed shot gets 1-5 stars (`src/scoring.ts`), with the reasons shown under the result:

| | |
|---|---|
| Wobble save / clean landing / cap landing | 1 / 2 / 3 to start |
| Each extra flip (double, triple...) | +1 |
| Landed on the back counter ("Long shot") | +2 |
| Bounced off the lamp or wall on the way | +1 |
| Clean landing that barely moved ("Dead centre") | +1 |

Earned stars are drawn in gold; unearned ones aren't shown.

Capped at 5. Misses get none. The best of the session shows next to the landing count.

## Test mode and reset

**Test** (solo phone: top-left; controller: bottom row) switches to practice. The bottle never lets go: it hangs from its cap and swings around an inked axis through the cap as you tilt the phone. A swing that would have released shows up on the meters. The water sloshes with the swing (a sharp flick slams it into the base). Nothing is thrown or counted. The camera moves to a side view so the swing reads as a circle, the scene turns watercolour, and the phone gets a blue wash. On desktop `?debug`, test mode swings on a loop.

**Reset** puts the bottle back in hand at any time; on the big screen, clicking anywhere does the same. After a result, the bottle returns to your hand on its own after a few seconds.

## How it works

```
src/
  config.ts            all tuning values (P), bottle geometry
  physics/bottleSim.ts 2.5D sequential-impulse sim: light shell + 2 water slugs on a slider joint
  input/motion.ts      DeviceMotion -> one flick (peak rotation + peak linear accel)
  input/flickMap.ts    flick peaks -> launch (vy, spin) + spin "magnet" assist
  render/sketch.ts     paper + ink renderer: hatching, edge-detected outlines, colour fill
  scene/kitchen.ts     the Stage 01 diorama
  scene/bottleMesh.ts  bottle, water slugs, blob shadow
  ui/sketchui.ts       grip picker, motion guides, speed/power meters
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
