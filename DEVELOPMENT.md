# Development

Setup, deployment and how Horizon works inside. For what it does, see
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

## Design decisions

- **No occlusion.** Paths are drawn over the whole panorama and the user judges
  the skyline by eye. (Skyline segmentation is on the future list in
  FEATURES.md.)
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
`astronomy-engine` and `tz-lookup`.

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
- Turning the view programmatically is animated by Street View, but the target
  direction is reported immediately, so the overlay fades out briefly during
  those turns.
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
| `src/state.ts` | URL ⇄ app state |
| `src/main.ts` | Wiring: Google Maps, events, controls |
