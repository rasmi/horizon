# Features

What Horizon does today, and what it might do later. For setup, deployment and
how it works inside, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Choosing a place

- Opens at your own location if the browser is allowed to share it (and the
  link doesn't already name a place). The button beside the search box does
  the same later. This only ever opens Google's own imagery, never a
  user-contributed photo, looking up to 2 km away if need be.
- Or search for a place, or click a blue Street View line on the map. Either
  way the app snaps to the nearest panorama, preferring Google's own imagery.
- The mini-map tucks itself away once you've dragged the view around a little
  (about half a second of dragging, or a 25° turn). Reopen it and it stays
  until you next look around.

## Choosing a time

- Pick a night and scrub through it with the slider, whose track shows how
  dark the sky is. Press play to run through the night; touching the slider
  pauses it. Hold the slider against either end and time keeps running that
  way, into the next or previous night, until you let go or pull back.
- ‹ › step a day at the same clock time. On desktop, ←/→ step a day and ↑/↓ an
  hour (except while typing or in the slider, where arrows behave normally).
  These keys replace Street View's own keyboard panning; dragging still pans.
- The slider and the timeline share one time axis, noon to noon, with daytime
  squeezed: an hour of daylight takes a third of the width of an hour of
  night, so most of the travel is the night. On the slider itself, arrow keys
  step five minutes and Page Up/Down an hour.
- Times are shown in the place's own time zone.

## What's drawn on the sky

- **Paths.** Each object's path is solid when it's up after sunset, and dashed
  when it's below the horizon or in daylight, with a dot and label every hour.
- **One arc per object.** Each path is one full cycle around tonight's pass:
  rise, transit, set, and the stretch below the horizon either side. Its two
  ends run on an hour past the cycle, fading out, with a small arrow showing
  the direction of travel. A track never quite closes, so far below the
  horizon the Moon's two ends pass alongside each other a few degrees apart
  (its real day-to-day shift), while a planet's coincide. The Sun's path
  instead runs noon to noon, covering this evening's sunset and tomorrow's
  sunrise.
- **Names.** The solid part carries the object's name, written along the line
  on its left side (the hour labels sit to the right of their dots). The name
  keeps its place across the screen and slides along the line as you pan,
  moving up the line if it would sit on a rise or set time.
- **Rise and set times.** ↑ and ↓ times sit to the right of where each path
  crosses the horizon, rises just above it and sets just below, dimmer if
  that happens in daylight. They take precedence over the same object's hour
  labels: where the two would overlap, the hour's dot stays and its text is
  left out until you zoom in.
- **Markers.** Each object has a marker at the chosen time, sized by
  brightness. Arrows at the screen edge point to objects that are up but out
  of view. Tap one, or an object's name in the panel, to turn toward it.
- **Horizon.** A line at 0° with compass letters.

## Which objects

- Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus and Neptune can each
  be switched on or off.
- By default the objects shown are the Moon (always) and the naked-eye planets
  (Mercury to Saturn) observable for at least 20 minutes on the night being
  viewed, and the selection follows the night and place. Toggling any object
  makes the selection yours: it's then kept and stored in the link.

## The info panel

- A timeline of the night, one row per object, on the same noon-to-noon axis
  as the slider. Each row is a small plot of the object's altitude, from the
  horizon up to 90° on the same scale for every object, so the peak is at
  transit and heights compare across rows. The plot is faint in daylight and
  solid while the object is **observable**: up, with the Sun below your
  chosen twilight level (civil, nautical or astronomical). In between, the
  fill deepens through twilight. A line marks the
  chosen time, and the background shows how dark the sky is. An object's name
  is brighter while it's up.
- Click a row's plot for its details: where it is now, its brightness, the
  rise, transit and set of tonight's pass (the one that peaks after dark),
  its peak altitude and the observable window. For the Sun: sunset, when it
  gets dark, when darkness ends, and sunrise.
- On desktop the panel sits on the left, and the tab on its edge tucks it away
  to give Street View the whole window (remembered in that browser). On
  phones it's a bottom sheet.
- The ⓘ button opens a short About box with the twilight-level setting and
  the keyboard shortcuts.

## Street View imagery dates

- The bar above the mini-map switches between a spot's capture dates, newest
  first. ❄ marks winter captures, useful for seeing past bare trees.
- ‹ › or `[` / `]` step older or newer. The view direction and zoom are kept,
  and walking along the street stays in the chosen year.
- Skylines change: a 2026 tower now hides the Empire State Building from Fifth
  Avenue near 25th Street, which was visible in 2022. The newest capture is the
  best guide to what's there now.

## Sharing

- The whole view (place, imagery date, direction, zoom, time, objects) is
  stored in the URL. The share button copies the link, or opens the share
  sheet on a phone.

## Limits

- Buildings and terrain aren't modelled; judge the skyline by eye.
- Directions are accurate to about 0.1–0.3°. Heights are usually within about
  0.2°, but some captures are off by about 1°, which shifts "clears the
  roofline at…" by roughly 5–8 minutes. Treat an object that clears an edge by
  less than a degree or two as a borderline call. Details are in
  [DEVELOPMENT.md](DEVELOPMENT.md#accuracy-against-the-real-sky).

## Future features

- [ ] **Level adjustment (tilt correction).** Fixes the occasional ~1°
  per-capture height error. The user drags the drawn horizon to match a real
  one (sea, or a flat distant skyline) at two or more headings, and the app
  fits the capture's residual forward/back and sideways tilt:
  e(h) = a·cos(h − H₀) + b·sin(h − H₀) + c. Four headings at Coney Island fit
  this to within 0.01°. That tilt is then applied in `projection.ts` and stored
  per panorama in the URL. Google's tilt/roll metadata can't do this: the
  viewer already applies it, and the residual is error in that metadata. Most
  worthwhile for borderline calls.
- [ ] **Uncertainty band.** A faint ±1° band along the horizon line, showing
  where near-horizon calls are uncertain.
- [ ] **Favourite locations.** Save the current spot (panorama, view
  direction, a name) and return to it from a list near the search box. Stored
  in the browser's `localStorage`, so it needs no account or server, but
  favourites stay on that device and browser. Store the coordinates as well as
  the panorama ID, since Google says IDs can change over time.
- [ ] **Altitude/azimuth grid.** Optional lines of equal altitude (say every
  10°) and azimuth (every 15° or 30°), labelled, drawn in `overlay.ts` with
  the same projection as the horizon line. Makes it easier to read off how
  high something is, and to compare with a star chart.
- [ ] **Skyline segmentation.** Detect where the sky ends in the panorama,
  then either draw a sky map (stars, constellations, paths) only above the
  skyline, or cut the buildings out and lay them over a full sky map. Either
  way, objects would be properly hidden behind buildings rather than drawn
  over them, and "clears the roofline at…" could be worked out automatically.
  The catch: the JS API viewer doesn't let page code read its pixels, so the
  imagery to segment has to come from elsewhere (the Street View Static API,
  or Map Tiles API panorama tiles), with the mask then mapped back by
  direction. Trees, glare and night-time captures make segmentation
  unreliable, so it needs a manual touch-up or an on/off switch.
- [ ] **Nearby imagery dates.** The date bar lists captures of the exact spot
  only, and neighbouring spots a few metres away often have different ones.
  When the list is opened, also check a few points 25–30 m around and offer
  their extra dates, labelled with the distance.
- [ ] **Label user photo spheres.** Mark user-contributed panoramas in the
  date bar (their compass alignment is often off), and offer the nearest
  Google captures alongside.
- [ ] **Multi-date mode.** An object's position at a fixed time across weeks:
  "which night is best?"
- [ ] **Event finder.** Conjunctions, close approaches to the Moon,
  oppositions and elongations.
- [ ] **Sky extras.** A twilight tint; bright stars and constellation lines.
- [ ] **Image export.** Save the view with its overlay, via the Street View
  Static API (the live viewer can't be screenshotted from page code).

Done:

- [x] **Imagery date selector** (`src/imagery.ts`). How it works is described
  in [DEVELOPMENT.md](DEVELOPMENT.md#street-view-imagery-dates).
