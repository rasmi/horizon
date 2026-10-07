# Development

Setup, deployment and how Clear Skies works inside. For what it does, see
[FEATURES.md](FEATURES.md).

## Running it

```bash
npm install
cp .env.example .env.local   # add a development key
npm run dev                  # http://localhost:5173
npm test
```

Without a key, dev builds run in Google's keyless "development purposes only"
mode: Street View works but is watermarked, and the map and place search don't.
Production builds without a key show a "not configured" message.

Requires Node 18+ (CI uses Node 22).

## Google Maps API key

The key ships in the page's JavaScript; that's how the Maps JavaScript API
works. It can't be hidden, so lock it down instead:

1. **Separate Cloud project** for this app only. Don't reuse the key for
   server-side APIs.
2. **APIs to enable:** Maps JavaScript API and Places API (New).
3. **Key → API restrictions:** only those two APIs.
4. **Key → Website restrictions:**
   - Production key: `https://YOUR-USERNAME.github.io/*` (plus any custom
     domain). Use the whole subdomain, not the repo path: browsers send only the
     domain to Google by default (`strict-origin-when-cross-origin`), so a path
     restriction may fail to match.
   - Development key (separate): `http://localhost:5173/*`.
5. **Quotas** (APIs & Services → each API → Quotas): set daily request caps
   that fit the traffic you expect. This is the only hard limit on cost.
   Budget alerts only notify you.
6. **Optional:** Firebase App Check (reCAPTCHA-based checks that requests come
   from your real site) is rolling out for some Maps Platform APIs. Check
   whether the Maps JavaScript API and Places API are covered.

The variable is `GOOGLE_MAPS_API_KEY`. Vite normally exposes only `VITE_*`
variables to the browser; `vite.config.ts` allows this exact name as well.

Street View loads only once there's a place: one the visitor chose, or their
own location if they allow the browser to share it. Visitors who decline and
only look at the landing map don't trigger panorama loads. The location is
used in the browser only, but the resulting panorama's coordinates do end up
in the page URL, so a shared link shows roughly where it was taken.

Google's terms require its logo and copyright notices to stay visible. The
mini-map card sits clear of Street View's logo for that reason.

## Deploying to GitHub Pages

1. Push to a GitHub repo with a `main` branch.
2. Settings → Pages → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions → add
   `GOOGLE_MAPS_API_KEY` (the production key).
4. Push. `.github/workflows/deploy.yml` tests, builds and publishes `dist/`.

The build uses relative asset paths, so it works under `/REPO/` or at a domain root.

## The sky map

Where the sky is in the panorama on screen: found in the browser by a
small model, and kept over the whole sky as the view is turned. It's what
the chart of the night sky is drawn by (the next section). **It's in
`src/sky/`, and on wherever the browser has WebGPU, unless the visitor
switches the night sky off in the ⓘ settings.** On the dev server a small
panel has the same switch, and shows the sky map other ways.

```
the viewer's canvas → the model's raw map and labels → the look as taken → the whole-sky grid → the sky map
   frame.ts               detector.ts, model.ts           look.ts, doubt.ts     evidence.ts         fill.ts
```

| File | What it does |
|---|---|
| `index.ts` | `startSky(host)`: the loop, and the `SkyMap` the rest of the app is handed: `at(alt, az)`, `known(alt, az)`, `level` and `depth()` (two numbers for each cell of the grid, for drawing), `version`, `epoch` (counts each time it starts over for another place), `pictureHere` (false until a place's picture is on screen), `onChange` |
| `watch.ts` | When to look, as two things that touch nothing on the page and so can be tested against a clock: `Pace` (every frame the model keeps up with while the view turns; three times when it stops; a fast turn only for sure sky; a jump not at all) and `Arrival` (not until a new place's picture has arrived) |
| `preserve.ts` | The switch (`horizon.sky` in the browser's local storage: on unless it's `0`, and never on without WebGPU), and what makes the viewer's canvas readable. Imported first by `main.ts`: it has to act before Street View makes its canvas, so switching reloads the page |
| `model.ts`, `detector.ts` | The model, its file kept in the browser's cache, and its runtime (below) |
| `frame.ts` | Copying the viewer's canvas; a frame's brightness; telling when a place's picture has arrived |
| `look.ts`, `doubt.ts` | What's made of a look before the grid has it: the model's doubt taken for sky where the picture looks like sky and it joins sky (never where the model's label is a building, a tree, the ground or water); poles, lights and signs seen through where they stand against the sky |
| `evidence.ts` | The grid, half a degree each way: the looks ranked by how close the view and how near the middle of the frame, and a look at rest weighed against the rests before it |
| `fill.ts` | The sky map: every cell held as sky, what's above the highest cell seen where that's sky, patches above 10° with sky all round them; less whatever is more than 2° under the horizon. Its edge falls between cells where their scores pass a half. And `depth()`: how far inside the sky map each cell is, in degrees, for a soft edge (worked out only when asked for) |
| `places.ts` | What the grid holds of each place, kept in the browser's local storage for coming back to it |
| `geometry.ts`, `types.ts` | Where a view falls on the sky; a raw map; the kinds a model's classes are sorted into |
| `dev/panel.ts`, `dev/area.ts`, `dev/probe.ts` | The development panel, how it lays the sky map over the view, and a script for turning the view and saying what's on screen. Not in a build |
| `evidence.test.ts`, `watch.test.ts`, `places.test.ts`, `dev/area.test.ts` | The grid; the loop's timing against scripted animation frames; keeping places; the panel's outline |

The sky map was worked out in a larger body of development code, with an
evaluation against a ground truth and notes on every step tried. That's
kept out of the repository; what's here is the one way that was settled
on.

**The model** is PP-MobileSeg (base, trained on ADE20K), converted for
LiteRT with its last step and the reading of its scores inside the file:
one 512 × 512 image in, and for each point of a 128 × 128 grid, how far
sky is ahead of the buildings, trees and ground together, and which class
is ahead. One file of it is in `third_party/pp-mobileseg/`: `x2-fp16` in
`model.ts`, `pp-mobileseg-base-ade-512-x2-fp16.tflite`, 12.9 MB, with
16-bit weights.

It was settled on by hand on 7 October 2026, over the same model with
8-bit weights for its large layers (7.4 MB): that one's sky map was much
less steady while panning. **To use another file**, put it in
`third_party/pp-mobileseg/`, add it to `MODELS` in `src/sky/model.ts`,
and change `DEFAULT_MODEL`: nothing else names either.

**The runtime** is LiteRT.js (`@litertjs/core`), on the graphics card
(WebGPU) where it can and the processor (WebAssembly) where it can't. It
fetches its own WebAssembly files by name when it starts: the dev server
serves them from `node_modules`, and a build copies them to `litert/`
beside the page (`vite.config.ts`). A build is 50 MB with them and the
model, of which a visitor with the sky map on fetches the model and one
runtime (about 13 MB and 9.5 MB); with it off, or without WebGPU, none of
it.

**Nothing shows until the model is ready, and nothing if it never is.**
`startSky` hands back a `ready` promise, and `main.ts` puts the chart on
screen, dims the paths and works out the skyline's times only once it
settles. It fails, quietly (a warning in the console), if the model's
file can't be downloaded or the graphics card can't take the model
whole: the model isn't started on the processor. (Once running, a frame
that fails on the graphics card still moves it to the processor.)
**The model's file is kept in the browser's Cache Storage**
(`horizon-sky-model`, by `loadModel` in `model.ts`), so it's downloaded
once; another file's coming in clears the old one out. The viewer's
canvas is made readable for every visitor with WebGPU, whether or not the
model then loads.

**On the dev server** there's a small panel at the top right of the view.
**Night sky** is the same switch as in the ⓘ settings, and reloads the
page. With it on: **Test place** (nine places the sky map was
worked out at); **Show** (the chart, as the
app draws it; the chart with the sky map's edge outlined; the chart's
weight alone as a flat shade; the sky map shaded dark and outlined in
yellow by the panel itself; that with the model's sky score as a tint;
the score alone; the model's own labels in eight colours with a key;
nothing); **Remember places**; **Chart's look…** (sliders for the chart's
strengths, its fade and its lines); and a readout of the runtime, the
model's time, the time to make the sky map from its answer, and how much
of the view the sky map takes up. From the console, `await
__skylineProbe()` turns the view by script and says what's on screen
(`src/sky/dev/probe.ts`; the tab has to be on screen), `__skyline.sky` is
the sky map itself, and `__chart.checkWeight()` reads the chart's weight
back from its canvas and counts where it disagrees with the sky map.

**Not done:** a phone (a phone's browser with WebGPU has it on, and it
hasn't been tried on one); the model in a worker (on the processor it
runs on the page's own thread, and the view stutters: so it's on only
where the browser has WebGPU); and Google's terms weighed (see
FEATURES.md).

## The night sky over the view

A chart of the whole sky drawn over the whole view, after sunset: the
night's colour, the constellations' lines, the stars, and names. Where
the sky map says open sky it's at full strength (the day's sky in the
picture is gone); buildings, trees and sky not looked at yet are
darkened, with the stars faint over them; below the horizon, fainter
again. The paths and markers dim where they pass behind something, and
each object's row in the chart of the night says when it's in open sky.
**On wherever the browser has WebGPU**, once the model has loaded, unless
switched off in the ⓘ settings ("Night sky over the view"), which is kept
in the browser (`horizon.sky`) and reloads the page.

| File | What it does |
|---|---|
| `skychart.ts` | The layer: one WebGL 2 canvas, first inside `#overlay`, drawn afresh every frame from where the view is. A fragment shader finds the direction each pixel looks in, reads the sky map's cells there (a small texture, 201 by 720, level and depth), and makes of them a weight from 0 to 1: nothing at the sky map's edge, 1 a dozen pixels inside it at any zoom. The backdrop, the lines and the stars each take their strength from the weight and the pixel's altitude. Google's logo, notices and controls are kept clear in their own shapes: a mask drawn from the page's own elements (the logo's lettering, the compass's disc, the buttons' and notices' boxes), with no margin |
| `skyease.ts` | What's shown of the sky map lags what it says, so nothing pops: a copy of the cells eased towards the latest (0.2 s up, 0.3 s down), newly found sky poured from the sky beside it or, arriving, from overhead. Touches nothing on the page; tested against a clock |
| `stars.ts`, `third_party/star-catalogues/stars-data.json` | The catalogue (8,921 stars, 88 constellations' lines, 193 deep-sky objects) and where it is in the sky: one rotation from astronomy-engine for the place and time, done for every star by the graphics card, with the same refraction as the planets |
| `skyglow.ts`, `third_party/light-pollution-atlas/skyglow.webp` | How bright artificial light makes the sky at the place shown, which sets how faint a star shows there by default: a cut of David Lorenz's Light Pollution Atlas, a tenth of a degree to the cell, eleven levels, 129 KB. A city centre shows stars to magnitude 3.5 in a view at its widest, a dark site to 5 as before; zooming in still brings fainter ones out. "Stars as seen from this place" in the ⓘ settings switches it off (`horizon.skyglow`) |
| `skycolor.ts` | The sky's colour by the Sun's altitude: in steps for the slider, blended for the chart |
| `overlay.ts` | Paths, hour dots and markers dimmed where the sky map says they're behind something (`splitBySky`), with a time and an eye where a path meets the skyline; the chart's names (stars, constellations, objects) |
| `roofline.ts`, `panel.ts` | When tonight each object is in open sky from here, behind something, or where the sky hasn't been looked at; shown on each row's plot and, in an open row, as eyes to jump by |
| `chart.test.ts`, `skyglow.test.ts` | The depth, the easing and pour, the stars' places against astronomy-engine's, the path split, the clearing times; the light pollution map |

`main.ts` fetches all of it, the sky map and its model included, only
where the switch is on. It draws the chart in the same animation frame
as the paths, and asks for another frame only while something is still
easing.

**Whatever isn't the app's own is in [`third_party/`](third_party/README.md)**:
the stars' catalogue, the light pollution map and the model, each in a
folder with a `README.md` saying whose work it is, what was changed and
on what terms (the model's has its license's text beside it, as
`LICENSE`); and its README lists those and the npm packages the app
is built with. The same list is at the foot of the About panel
(`index.html`): a change to one wants making in the other. The scripts
that cut the data down from its sources are kept out of the repository,
with the downloads.

## Design decisions

- **Occlusion only where the night sky is on.** Without it, paths are
  drawn over the whole panorama and the user judges the skyline by eye.
  With it (see above), the app finds the sky itself and dims what's
  behind a building or a tree.
- **Desktop and mobile equally.** A collapsible left-hand panel on desktop, a
  bottom sheet on phones.
- **Public, static site.** No server. The Maps API key is restricted and
  usage-capped rather than hidden.
- **Google's own viewer.** The imagery is drawn by Google's
  `StreetViewPanorama`, and the overlay matches its camera. Rendering the
  panoramas ourselves from Map Tiles API imagery would remove the
  reverse-engineering described below, but means rebuilding navigation, zoom
  and touch controls.

## How it works

- A full-screen `StreetViewPanorama` with a transparent `<canvas>` on top
  (`pointer-events: none`, so dragging and pinching still reach Street View).
  Object markers are DOM buttons, so they can be tapped and reached by keyboard.
- On every `pov_changed`, `zoom_changed` and time change, each object's
  altitude and azimuth (with refraction, from astronomy-engine) is projected
  through a pinhole camera using the panorama's heading, pitch and zoom, and
  the canvas is redrawn. Redraws are throttled to animation frames.
- Positions are computed once per place and night (a noon-to-noon window in
  the place's time zone, sampled every 5 minutes) and cached; panning only
  re-projects them.
- Each object's drawn path is one full cycle around tonight's pass, from the
  lower culmination before it to the one after, plus an hour beyond each end
  (`cyclePath` in `astro.ts`). Lines change between solid and dashed at the
  exact horizon crossing or sunset/sunrise point (`boldBoundary`), not at the
  nearest sample.
- All state lives in the URL (`state.ts`): place, panorama ID, heading, pitch,
  zoom, time, twilight level, and the visitor's own choices of objects (`b`:
  a name is switched on, `-name` off; everything else follows what's visible
  that night). `eye=0` is added when "Naked-eye objects only" is off.
- The slider and the chart share a time axis on which daytime is squeezed
  (`axis.ts`). The chart's rows are rebuilt only when the night, the objects
  shown or the open rows change; scrubbing and playback just move the time
  line and refresh the open rows' "now" text.

Stack: Vite and TypeScript with no UI framework; `@googlemaps/js-api-loader`,
`astronomy-engine`, `tz-lookup` and `geomagnetism`; and, where the night
sky is switched on, `@litertjs/core`.

## Projection calibration

The overlay uses a pinhole (straight-line) projection from altitude/azimuth to
screen pixels. Street View headings are relative to true north, so no manual
alignment is needed.

The zoom-to-field-of-view relationship is undocumented. It was measured by
placing Google `Marker`s in a panorama at known bearings and reading where
Google drew them:

- focal length (px) = (viewport width / 2) × 2^(zoom − 1)
- equivalently, horizontal FOV = 2·atan(2^(1 − zoom)): 90° at zoom 1, 53° at
  zoom 2, 28° at zoom 3, for any aspect ratio.
- **except** that the imagery never spans more than 90° vertically: focal
  length ≥ viewport height / 2. In wide viewports, Street View's zoom-out
  button keeps lowering the reported zoom (down to 0) past that point, while
  the imagery stays put. Zoom 0.8 and 0 rendered identically in a 920×800
  view. Google's markers follow the reported zoom, so marker probes don't show
  this; the sea horizon does. Street View's own on-load zoom lands exactly at
  the cap (zoom 1.21 in a 664×768 view, where 1 + log₂(768/664) = 1.21).

The commonly quoted `180° / 2^zoom` only agrees at zoom 1. With the measured
formula, our projection matched Google's marker positions to within 1 px for
pitches −20° to +35°, zooms 0.8–3, in phone and desktop viewports. Against the
imagery itself (the Empire State Building's spire, aimed 1.5° off-centre), each
zoom level from 2 to 4 doubled the offset as the formula says.

The marker test shows the overlay matches Google's *model* of each panorama.
It doesn't show that the model matches the real sky. Each probe's height was
anchored at pitch 0, which hides any camera tilt; see below.

### Accuracy against the real sky

Measured (Oct 2026) against targets whose positions can be calculated: the
Empire State Building's spire from Fifth Avenue (9–11 captures, 2011–2026),
and sea horizons at Coney Island, Galveston and Copacabana (pitch 0, zoom 3,
about 0.05° per screenshot pixel).

- **Direction: accurate to about 0.1–0.3°** in every capture year tested.
- **Height: usually within about 0.2°,** but some captures are off by about 1°.
  Galveston (2024) and Copacabana (2026) read 0.1–0.2° low, roughly what
  camera height explains. Coney Island (2016) was off by up to 1°, varying
  with direction as a tilted camera would: 0° at heading 110°, 0.45° at 135°,
  0.84° at 160° and 1.05° at 185°.
- **Google's viewer already corrects each capture's tilt and roll,** despite
  `StreetViewPov.pitch` being documented as "relative to the street view
  vehicle". The Map Tiles API's documented per-capture `tilt`/`roll` metadata
  (`tilt − 90` equals the JS API's undocumented `tiles.originPitch`) shows
  large values for the accurate captures: Copacabana has tilt −2.7° and roll
  +1.7°, yet its horizon was within 0.16°. Uncorrected, those would have shown
  as errors of up to about 2°. So the residual errors are inaccuracies in
  Google's own orientation for that capture. The metadata can't fix them,
  because it's what the viewer already uses.

The error is magnified on screen as you zoom in: 1° is about 7 px at zoom 1
but about 54 px at zoom 4 in a 770-px-wide view. That's why the line seems to
drift relative to the scene at the most zoomed-in levels. In practice, 1° of
altitude shifts "clears the roofline at…" by roughly 5–8 minutes for a planet
low in the sky at mid-northern latitudes.

### Notes

- The 90° vertical cap is why narrow (portrait) viewports start more zoomed
  in. `streetViewHfov()` in `projection.ts` applies the cap, so every zoom
  level, including the dead range below it, lines up.
- Turning the view by one call to `setPov` is animated by Street View, but
  the target direction is reported immediately, so anything drawn over the
  view meanwhile is in the wrong place. So the app makes its own turns a
  step every animation frame (`turnToFollowed` in `main.ts`): a small step
  is shown at once, the direction reported is where the picture is, and
  the overlay stays on.
- Street View resets the zoom when switching panorama, so switching imagery
  date re-applies it once the new capture loads.
- Searches and map clicks prefer Google's own imagery. User-contributed photo
  spheres often have unreliable north alignment (and some fail to load), so
  they're used only when nothing else is nearby, with a warning.
- "Google's own imagery" (`sources: ['google']`) isn't only street imagery. It
  includes isolated one-off captures (© Google, described just as "Google",
  often from 2010, a single date, no links to neighbours), and a nearest
  search returns them like any other. The app treats a panorama with no links
  as off the street network: `findOfficial()` in `main.ts` then probes rings
  of points around the spot for the nearest linked one, since the API returns
  only one result per search. Opening at the browser's location accepts
  nothing else.
- Street View has no option to turn off its keyboard panning, so the arrow-key
  shortcuts are caught in the capture phase, before its handlers.
- In dev builds the panorama is available as `window.__pano` for repeating
  these measurements.

## Street View imagery dates

Not in the documented JS API: `getPanorama()` results include an undocumented
`time` list of `{ pano, <minified>: Date }`, one per capture of that exact
spot. The date is found by type, not by its minified name (`imagery.ts`).
Captures are loaded by ID, which is documented, and a lookup by ID returns the
list too, so shared links to older captures work. Street View's links from an
old capture lead to neighbours of the same date, so walking stays in the
chosen year. If the list disappears, the bar shows just the current capture's
documented `imageDate`.

Each spot has its own list, a few metres apart, and pedestrian areas often
have a single capture separate from the street's history. Direction was as
accurate in 2011 captures as in recent ones.

## Code map

| File | Role |
| --- | --- |
| `src/astro.ts` | astronomy-engine wrappers: positions, paths, rise/set/transit, observable windows |
| `src/projection.ts` | Street View camera model, alt/az → screen projection, label anchoring |
| `src/overlay.ts` | Canvas paths, labels, horizon and compass; DOM markers and edge arrows |
| `src/panel.ts` | The chart of the night (one altitude plot per object, with its toggle and details), and the slider's sky shading, hour marks and sunset/sunrise labels |
| `src/imagery.ts` | Street View capture dates: parsing the undocumented `time` list, labels |
| `src/time.ts` | Time-zone conversion and the noon-to-noon night window |
| `src/axis.ts` | The slider's and timeline's shared time axis, with daytime squeezed |
| `src/compass.ts` | Turning the view with a phone's compass |
| `src/state.ts` | URL ⇄ app state |
| `src/sky/` | The sky map: where the sky is in the panorama on screen (see "The sky map") |
| `src/skychart.ts`, `src/skyease.ts`, `src/stars.ts`, `src/skyglow.ts`, `src/skycolor.ts`, `src/roofline.ts` | The night sky over the view (see that section) |
| `src/main.ts` | Wiring: Google Maps, events, controls |
| `third_party/` | Others' work the app loads (star catalogues, light pollution map, the sky map's model), with their licenses |
