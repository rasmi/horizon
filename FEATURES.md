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

- On a phone, the compass button above Street View's zoom buttons turns the
  view with the phone: it faces whatever the back of the phone points at, by
  the phone's compass (corrected from magnetic to true north for the place
  shown; a phone compass is still only good to several degrees). It only pans
  the view; the paths stay fixed to the imagery as always. Dragging the view,
  or turning to an object, switches it off. It replaces Street View's own
  tilt control, which ignores the compass.

## Choosing a time

- Pick a night and scrub through it with the slider, whose track shows how
  dark the sky is. Press play to run through the night; touching the slider
  pauses it. Hold the slider against either end and time keeps running that
  way, into the next or previous night, until you let go or pull back.
- The date and time at the top of the time controls is also the date picker:
  click it for a calendar, or double-click it to type a date.
- Sunset and sunrise are marked above the slider at their places along it;
  click either to jump to that moment.
- ‹ › step a day at the same clock time (hold one to keep stepping, faster
  and faster). On desktop, ←/→ step a day and ↑/↓ an
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
  of view. Tap one to turn toward it.
- **Horizon.** A line at 0° with compass letters.

## Which objects

- Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus and Neptune each
  have a row in the chart. The dot at the left of the row switches the object
  on or off (filled is on), and the name beside it turns the view toward it
  (switching the object on first, if it was off).
- The Sun and Moon always head the chart (the Sun switched off unless you
  turn it on). After them come the planets visible tonight: those observable
  for at least 20 minutes on the night being viewed. The rest follow under a divider. Both groups keep
  the usual order: Sun, Moon, then the planets outward from the Sun.
- Uranus and Neptune are listed with the visible objects when they're
  observable, but they need binoculars or a telescope, so they stay off while
  "Naked-eye objects only" is on (the default; it's in the ⓘ settings). With
  it off they're switched on like the other planets. The setting goes in the
  link when it's off.
- By default the visible ones are on (bar those two) and the rest off, and that follows the
  night and place as you change them.
- Switching one yourself is kept: an object you turned on stays on (pinned)
  even on nights it isn't visible, and one you turned off stays off. Only
  those choices go in the link. Switching an object back to what the night
  would show hands it back to the automatic behaviour. Either way, a row's
  group still says whether the object is visible that night.

## The info panel

- A timeline of the night, one row per object, on the same noon-to-noon axis
  as the slider. Each row is a small plot of the object's altitude, from the
  horizon up to 90° on the same scale for every object, so the peak is at
  transit and heights compare across rows. The plot is faint in daylight and
  solid while the object is **observable**: up, with the Sun below your
  chosen twilight level (civil, nautical or astronomical). In between, the
  fill deepens through twilight. A line marks the
  chosen time, and the background shows how dark the sky is. Objects that
  are switched off keep their row, dimmed.
- The slider sits directly above the chart, exactly as wide as the plots, so
  its thumb lines up with the time line in every row. The date and time are
  shown above it.
- In an open row, clicking a rise, transit or set label, or the transit dot
  and its peak altitude, jumps to that moment.
- An open plot can be dragged along to scrub the time, like the slider,
  including holding it past either end to run on into the next or previous
  night.
- Clicking an object's name, or dragging its plot, locks the view onto it:
  as the time then changes (the slider, playback, the day arrows) the view
  follows it across the sky, and along the horizon while it's below. Dragging
  the view yourself, or switching the object off, lets go.
- Click a row's plot to open it. The plot grows taller and its events are
  written under it at their own times along the axis: the rise, transit
  (with the peak altitude, also dotted on the curve) and set of tonight's
  pass, the one that peaks after dark; for the Sun, sunset, sunrise and when
  darkness starts and ends. (The observable window is the solid part of the
  plot; hovering the plot gives its times.) Where
  the object is at the chosen time is marked on the plot too: a dot where
  the time line crosses the curve, with its altitude and direction beside it
  (kept clear of the peak's label). Beside the plot, under the name, is its
  brightness. Every rise and set the plot shows is
  labelled under its own crossing, with its own time: so an object that's
  still up at the start of the window (the tail of the pass before) has that
  set labelled there. An event of tonight's pass that the plot doesn't show
  at all sits at the nearer end of the axis, marked ‹ or ›.
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
