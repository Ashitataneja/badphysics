# BAD PHYSICS

**YOUR BODY IS THE BUG.**

BAD PHYSICS is a real-time, webcam-controlled 3D installation that runs in your browser. You stand in front of your camera and use your bare hands to bend the rules of a small, impossible universe. A fist grabs gravity. Two palms stretch space. A swipe tears reality open. A punch makes everything fall upward. A pinch collapses the universe into a singularity and rebuilds it.

There is no backend and no account. The video never leaves your device. Hand tracking (MediaPipe Hand Landmarker), rendering (Three.js with custom GLSL) and sound (Web Audio synthesis) all run locally.

---

## Quick start

Requirements: **Node.js 20 or newer**, and a current desktop browser. Chrome is recommended, and Edge and Firefox work too. You need a webcam to use gestures. Without one, mouse and keyboard work.

```bash
npm install          # also fetches the hand model + copies the MediaPipe WASM runtime
npm run dev          # http://localhost:5173
```

1. Open the local URL.
2. Click **ENTER THE SIMULATION**. The browser asks for camera access only at this point, never on page load.
3. Allow camera access.
4. Raise one or both hands into the calibration frame. When a hand has been tracked steadily for about a second, the overlay fades and the simulation begins.

To explore without a camera, click **or explore with mouse & keyboard** on the landing screen.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the Vitest unit tests (gesture classifier and state machine) |
| `npm run typecheck` | Type-check only |
| `npm run fetch-model` | Re-download the hand model and re-copy the WASM runtime |

### Deploying to GitHub Pages

The source must be built before it can be served. GitHub Pages can't serve `index.html` from the repo root directly: it points at TypeScript the browser can't run. The included workflow (`.github/workflows/deploy-pages.yml`) builds the app and publishes `dist/` on every push.

1. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Push, or re-run the **Deploy to GitHub Pages** workflow from the Actions tab.

Pages is served over HTTPS, so camera access works there.

### The hand-tracking model

The app loads two things from `public/`:

- `public/models/hand_landmarker.task`: the MediaPipe Hand Landmarker model (Apache 2.0). Its source and licence are in [`public/models/README.md`](public/models/README.md).
- `public/mediapipe/wasm/`: the MediaPipe WASM runtime. It is copied from `node_modules` by `postinstall` and is not committed.

`npm install` handles both. If the model download fails, for example offline or behind a proxy, the install still succeeds and prints the manual download URL. In that case the app shows a clear **Hand tracking failed to load** error with a retry button, and the mouse and keyboard fallback still works.

### Camera permissions and secure contexts

Browsers only allow camera access in a **secure context**: `http://localhost`, `http://127.0.0.1`, or any `https://` origin. If you open the dev server from another device on your network over plain `http://`, the camera is blocked and the app tells you why. For LAN testing, put it behind HTTPS (for example `vite --https` with a local certificate, or a tunnel).

---

## Gestures

Every gesture changes the space right away. None of them are menu commands.

| Gesture | How | What happens | Keyboard / mouse |
| --- | --- | --- | --- |
| **GRAB GRAVITY** | Close one hand into a fist and hold it, then move it | A local gravity well follows your fist. Nearby objects drift toward it, particles curve into orbits, the structure leans toward you and a lens forms around the palm. Open your hand to release, and things coast before settling. | Hold the left mouse button, or toggle with **G** |
| **STRETCH REALITY** | Two open hands, then pull them apart or push them together | The central structure stretches or compresses along the line between your palms. Ribbons bridge your hands and particles spread or collapse. | **X** toggles; the cursor's distance from centre sets the stretch |
| **TEAR REALITY** | A fast, straight, outward swipe with an open hand | A fissure opens along your swipe. The two sides of the world slide apart, geometry is flung off the line and a burst of particles escapes, with a sharp panned sound. | **T** (direction follows the mouse) |
| **REVERSE GRAVITY** | A deliberate upward punch with a fist | Gravity flips for about 3.6 s. Objects rise, particles pour upward like an inverted waterfall, the camera tilts, a sub-bass pulse sounds, and then it decays smoothly back. | **R** |
| **CONDUCT A STORM** | Wave an open hand. Circle it for a vortex. | Hand velocity becomes wind, acceleration becomes turbulence and circular motion becomes a vortex. Fast motion sheds particles and slow motion leaves delicate trails. The storm keeps its momentum briefly after you stop. | Move the mouse |
| **SNAP THE UNIVERSE** | Pinch thumb and index together, then release | Everything collapses into a singularity near your hand, then bursts into a new arrangement. The new layout is related to the old one (rotated and re-proportioned), so it reads as a transformation. | **S** |
| **FREEZE TIME** | Hold a flat, open palm toward the camera for about 0.5 s | The simulation holds its breath. Particles, objects and the camera drift stop while tracking keeps running. **Swipe outward to resume**, or perform a transformation (tear, punch, snap) to break the freeze. | **F** freezes and resumes |
| **ERASE YOURSELF** | Cover the camera with your open hand | Colour drains and the world inverts into a high-contrast line drawing. Move your hand away and colour returns. | **E** toggles |

Other keys: **M** mutes, **Esc** exits, **P** toggles the performance overlay, **`** toggles the gesture debugger, and **H** shows or hides the legend.

Keyboard and mouse input goes through the same event and control types as the hand gestures, so every effect behaves the same whichever input triggers it.

### How conflicts are resolved

Several gestures share hand shapes, so the recogniser follows these rules:

- **Hysteresis.** Each pose has stricter entry thresholds than exit thresholds, so a slightly relaxed fist stays a fist.
- **Stability windows.** A fist must be held about 200 ms before it becomes a gravity well. The freeze palm must be held still for about 500 ms. Covering the lens must persist for about 250 ms.
- **Trajectories for motion gestures.** A punch needs upward speed, a mostly vertical direction and a minimum rise within a short window. Holding or dragging a fist never reverses gravity. A tear needs high speed, a straight path and outward motion, so ordinary waving stays a storm.
- **Cooldowns.** Tear (0.7 s), reverse (2.5 s) and snap (1.2 s) fire once per action, never every frame.
- **Specificity wins.**
  - A pinch overrides the open-hand classification, so an "OK" sign never freezes time.
  - Two open hands mean stretch, which suppresses tear and freeze.
  - A hand covering the lens suppresses everything else.
  - A fist that is rising fast is treated as a punch candidate, not a gravity well.
- **Tracking loss.** Forces fade out over about 450 ms instead of snapping. If a hand vanishes right after growing large and approaching the lens, the recogniser infers "covering the camera". Otherwise a lost hand never triggers erase.

All thresholds live in [`src/camera/gestureConfig.ts`](src/camera/gestureConfig.ts). Open the **gesture debugger** (press `` ` `` or use Settings) to see per-hand features (pose, openness, curl, pinch distance, palm facing, speed, area) and every candidate gesture with its confidence and rejection reason, for example `REJECTED TEAR_REALITY — speed 2.10 < 3.4`.

---

## Architecture

```
src/
  app/        App.tsx, Experience.ts (the single loop), state.ts (Zustand),
              interactionMachine.ts (explicit state machine), fallbackInput.ts
  camera/     CameraManager.ts, HandTracker.ts, landmarkFeatures.ts,
              gestureClassifier.ts, gestureConfig.ts
  scene/      SceneManager.ts, SimulationController.ts, PhysicsController.ts,
              ObjectSystem.ts, ParticleSystem.ts, InteractionFields.ts,
              CameraController.ts, stretch.ts
  shaders/    liquidDisplacement.{vert,frag}, gravityLens.frag, spatialTear.frag,
              particle.{vert,frag}, realityInversion.frag, composite.frag, fields.glsl, …
  audio/      AudioController.ts, soundDesign.ts
  ui/         LandingScreen, CalibrationOverlay, SimulationHUD, GestureLegend,
              SettingsPanel, ErrorState, …
  hooks/      useSimulation.ts, useHandTracking.ts
  utils/      smoothing.ts, math.ts, performanceMonitor.ts
tests/        gestureClassifier.test.ts, interactionMachine.test.ts, syntheticHands.ts
```

### Tracking pipeline

1. **Acquire frame.** One `<video>` element owned by `CameraManager`. It is re-parented between the calibration view and the picture-in-picture preview, so there is only ever one stream.
2. **Detect.** `HandTracker` runs MediaPipe Hand Landmarker in VIDEO mode with up to two hands. It tries the GPU delegate first and falls back to CPU.
3. **Normalise.** `landmarkFeatures.ts` validates the 21 landmarks, corrects for aspect ratio and mirrors x so your movement matches what you see.
4. **Features.** Palm centre, palm size, per-finger extension, openness, curl, thumb-index pinch distance, palm normal and facing, and bounding-box area.
5. **Smooth.** Time-based exponential smoothing, so behaviour is the same at any frame rate. Velocity and acceleration come from the smoothed signal and are clamped, and jumps are treated as discontinuities.
6. **Classify.** Pose hysteresis, then candidate gestures.
7. **Stability and confidence checks.** Hold times, trajectories and cooldowns.
8. **Emit.** One-shot `GestureEvent`s plus continuous `ControlState` values in a calibrated control space (about −1..1, with a dead zone and adjustable sensitivity).
9. **Simulate.** `SimulationController` maps control space onto the world through a camera ray-plane intersection, so the effect appears where your hand appears.
10. **Render.**

Detection runs **inside the same `requestAnimationFrame` loop, after the frame has been submitted**. It only runs when the video has a new frame and the tier's minimum interval has passed. If inference gets slow, the interval backs off automatically, so a slow detection never delays the frame already being drawn. There is exactly one animation loop, and restarting never duplicates it.

### Application states

`interactionMachine.ts` is a pure reducer: **landing → activating → calibrating → active ⇄ breach / frozen**, with **error** (retry, or continue with mouse and keyboard) and **exit**, which returns to landing from anywhere.

- A *breach* is a major event such as a tear, reversal or snap. It boosts intensity briefly, then returns to the stable state.
- *Frozen* halts simulation time while tracking continues.
- On exit, every camera track is stopped, the landmarker is closed and the audio context is closed. Unmounting disposes all geometry, materials, render targets and the renderer.

### Simulation

`PhysicsController` is a small, art-directable physics model, not a rigid-body engine. It owns:

- the time base: freeze, plus brief time dilation during major events;
- gravity reversal;
- the tear and singularity lifecycles;
- recovery damping;
- tunable parameters: base gravity, reversal, attraction, wind, turbulence, vortex, deformation, emission, time dilation and recovery.

Every update uses a bounded delta time.

- **ObjectSystem** holds the central deformable structure with its wireframe shell and halo. Around it, chrome spheres, wireframe polyhedra, organic blob clusters and fragments are simulated as structure-of-arrays bodies and drawn with `InstancedMesh`. It also manages the procedural ribbons (lagging chains for delayed secondary motion), practical light shafts, the backdrop and subtle hand markers.
- **ParticleSystem** is a fixed-capacity field: about 30k on high, 10k on medium and 3k on low. Particles are instanced quads stretched along their velocity. The ambient field and a recycled burst pool share preallocated typed arrays, and nothing is allocated per frame.

### Shaders

All interaction data reaches the GPU through a single set of shared uniform objects (`fields.glsl` and `InteractionFields.ts`), so no geometry is rebuilt on the CPU.

| Shader | File | Role |
| --- | --- | --- |
| A: Liquid displacement | `liquidDisplacement.vert/.frag` | Layered simplex noise along normals, with re-derived normals. World-space stretch, well, tear and singularity fields. Procedural liquid-chrome environment, with no textures. |
| B: Gravitational lens | `gravityLens.frag`, `particle.vert` | Bounded radial remap around the projected well or singularity, both in screen space and on particle positions in view space. |
| C: Spatial tear | `spatialTear.frag` | A propagating directional mask with a jagged fissure. The two sides are sampled with opposite offsets and the edge glows hot. Up to two live tears. |
| D: Particle storm | `particle.vert/.frag` | Velocity-stretched capsules with additive blending, depth fade, and colour driven by speed rather than screen position. |
| E: Reality inversion | `realityInversion.frag` | Smooth blend from normal, through desaturated, to an inverted high-contrast image. Particles and surfaces dissolve into outlines. |

Post-processing is a **single** full-screen composite pass that combines B, C and E with restrained chromatic offset, vignette and grain. There is no bloom and no ray marching. Shader compile errors are captured and logged.

### Sound

`AudioController` creates the `AudioContext` only from the ENTER click (autoplay policy). Every level change goes through `setTargetAtTime`. The master bus has a 30 Hz high-pass and a limiter. Continuous textures follow actual physical values, not gesture labels:

- **Grab**: a resonant drone that opens up as objects approach the palm.
- **Stretch**: an FM metallic tension tone pitched by the stretch factor.
- **Storm**: band-passed wind driven by energy and turbulence, panned to your hand.

One-shot sounds:

- **Tear**: transient plus distorted tail.
- **Reverse**: sub pulse plus rising sweep.
- **Snap**: inhale, compressed impact and granular shimmer.
- **Freeze**: chime plus fading pad.
- **Erase**: filtered noise sweep.

There is a visible mute control, plus **M** and a volume setting.

---

## Accessibility and settings

Settings are saved locally:

- volume and mute
- sensitivity (0.5–2×)
- quality (Auto, High, Medium, Low)
- reduced motion: less camera drift, shake and distortion, and gentler time dilation
- reduced flash: no exposure flashes and a softer inversion
- mirror camera, and invert vertical
- camera preview on or off
- gesture debugger and performance overlay

Reduced motion and reduced flash default to your OS `prefers-reduced-motion` setting.

Gesture recognition never relies on colour alone. The HUD names the gesture, describes its effect, shows confidence as text as well as a bar, and uses glyphs. HUD text uses difference blending, so it stays legible when the world inverts.

## Performance

| Tier | Particles | DPR cap | MSAA | Detection interval |
| --- | --- | --- | --- | --- |
| High | ~30,000 | 2.0 | 4× | every new video frame |
| Medium | ~10,000 | 1.5 | 2× | ≥ 30 ms |
| Low | ~3,000 | 1.0 | off | ≥ 66 ms |

**Auto** picks a starting tier from device signals, then watches frame time. If the average frame takes longer than 22 ms, it steps down in this order: particles to 70%, then 50% with a DPR scale of 0.85, then 35% with 0.7, and finally the next tier down. It recovers when frames come in under 12.5 ms. Hand detection also backs off when inference is slow. These targets are goals, not guarantees: expect 60 fps on a reasonably modern desktop GPU and 30–60 fps on weaker machines at Low.

---

## Testing

```bash
npm test
```

There are 47 unit tests across two suites.

**Gesture classifier.** These drive the real `GestureEngine` with synthetic 21-point hands (open, fist, pinch and neutral, at any position, scale or yaw) over simulated timelines. They cover:

- feature extraction for open palm, fist, pinch, edge-on palm, mirroring and invalid data;
- grab stability and dragging;
- freeze, both the one-shot trigger and the edge-on rejection;
- pinch-release snap, including cooldown, pinch precedence over open hand, and a pinch held too long;
- upward punch, including a slow rise that stays a grab;
- outward-swipe tear and its cooldown;
- storm from waving, with momentum decay;
- two-hand stretch and compress, with clamping and suppression of other gestures;
- erase, including noisy single frames and occlusion inference;
- hysteresis, transitions, tracking loss fade-out, tracking jumps and conflicting candidates.

**Interaction state machine.** Every phase transition, including errors, retry, fallback, breach, freeze, camera disable and enable, and exit and restart.

### Manual validation checklist

What was verified in a headless browser while building, and what still needs a real webcam:

| # | Scenario | Status |
| --- | --- | --- |
| 1 | Loads without requesting the camera | ✅ Verified: no `getUserMedia` call before ENTER |
| 2 | Camera permission starts tracking | ✅ Verified with Chromium's fake camera: model loads (GPU delegate), calibration and no-hand hint appear |
| 3–10 | Each gesture on a real hand | ⚠️ Logic is unit-tested on synthetic landmarks, and each *effect* was verified through the keyboard path, which uses the same events. Thresholds still need tuning against your own camera, lighting and distance. Use the debugger. |
| 11 | Tracking loss does not cause jumps | ✅ Unit-tested (forces fade over 450 ms); "Hand lost" notice verified |
| 12 | Mute and exit safely | ✅ Verified: after exit, 0 live camera tracks and 0 video elements |
| 13 | Restart creates no duplicate loops or streams | ✅ Verified: one canvas, exactly one live track after re-entering |
| 14 | Responsive at lower quality | ✅ Verified: under software rendering, Auto stepped down to Low on its own |

## Troubleshooting

- **"Camera permission denied."** Click the camera icon in the address bar, allow access, then press **RETRY CAMERA**. On macOS, also check System Settings → Privacy & Security → Camera for your browser.
- **"No usable camera."** Another app, such as a video call, may be holding the camera. Close it and retry.
- **"Camera needs a secure page."** Use `http://localhost` or HTTPS (see above).
- **"Hand tracking failed to load."** Run `npm run fetch-model`, check that `public/models/hand_landmarker.task` exists (about 7.8 MB), and restart the dev server.
- **Hands are not detected.** Light your hands from the front, step back so your whole hand is in frame, and keep your palm toward the camera. The calibration view shows the detected skeleton.
- **Gestures trigger too easily or not at all.** Adjust **Sensitivity** in Settings, open the debugger to see rejection reasons, and tune values in `gestureConfig.ts`.
- **Movement feels reversed.** Toggle **Mirror camera** or **Invert vertical** in Settings.
- **Low frame rate.** Set Quality to Low, and make sure hardware acceleration is enabled in your browser (`chrome://gpu`).
- **"Reality failed to render."** Your browser or GPU lacks WebGL2. Update the browser or enable hardware acceleration.

## Licence notes

The MediaPipe Hand Landmarker model and runtime are © Google, under Apache 2.0. Three.js, React and Zustand are under the MIT licence.
