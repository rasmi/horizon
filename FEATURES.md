# Features

What Clear Skies does today, and what it might do later. For setup, deployment and
how it works inside, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Choosing a place

- Opens at your own location if the browser is allowed to share it (and the
  link doesn't already name a place). The button beside the search box does
  the same later. This only ever opens Google's own imagery, never a
  user-contributed photo, looking up to 2 km away if need be.
- Or search for a place, or click a blue Street View line on the map. Either
  way the app snaps to the nearest panorama, preferring Google's own imagery.
- The mini-map starts tucked away, as a small button in the corner. Open it
  and it stays until you've dragged the view around a little (about half a
  second of dragging, or a 25° turn), then tucks itself away again.

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
  click either to jump to that moment. A jump like that (and to a rise,
  transit, set or skyline time in the chart, or back to now) runs the time
  there in about half a second where it's within a day or so, so the sky
  is seen to turn to it; further off it goes straight there.
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
- **Pressing what's written on the sky.** A path's name turns the view to
  its object and follows it, like the object's marker. A time on a path
  above the horizon (an hour, a rise, a skyline time) goes to that time
  and follows the object. Such a press is the object's: it doesn't step
  along the street. (A set time sits below the horizon, and is left to
  Street View.)
- **Horizon.** A line at 0° with compass letters.

## The night sky over the view

On wherever the browser can run the sky-finding model on the graphics
card (WebGPU), and not there at all elsewhere. It appears once the model
has loaded (13 MB, downloaded once and kept by the browser); if the model
can't be loaded, the app is simply as it is without it. "Night sky over
the view" in the ⓘ settings switches it off: that's kept in the browser,
and switching it reloads the page.

- **A chart of the whole sky, over the whole view, after sunset.** The
  night's colour, the stars to the naked eye's limit, the constellations'
  lines and names, the brighter stars' names, and Messier's objects with
  the brightest of the rest. It comes in as the Sun goes down, the
  brightest stars first; more stars and names show as the view zooms in.
- **Stars as seen from the place.** By default the chart shows only the
  stars bright enough to get through the place's light pollution: a few
  hundred from a city centre, thousands from a dark site. It goes by a
  coarse map of the world's night-sky brightness shipped with the app
  (about 11 km to the cell, so a small town in dark country reads as
  dark). Zooming in still brings fainter stars out. "Stars as seen from
  this place" in the ⓘ settings switches it off.
- **Full strength in open sky, fainter over everything else.** The app
  finds the sky in the picture on screen, on the device, and keeps what
  it finds as the view turns. Where it finds open sky, the day's sky in
  the picture is replaced by the night's. Buildings and trees show
  through, darkened, with the stars faint over them. Below the horizon
  it's fainter again.
- **It arrives.** At a new place the chart is there at once, darkening
  what isn't known to be sky, and the night pours in from overhead as the sky is found; turning, newly
  found sky fills from the sky beside it. A place been to before has its
  sky at once.
- **Paths and markers dim behind buildings and trees**, and come back to
  full strength in the open. (Dashed still means "not up, or not dark".)
- **Times at the skyline.** Where a path crosses the edge of the open
  sky there's a time, like a rise or set time at the horizon: an open eye
  where the object comes out from behind a building or a tree, a closed
  eye where it goes behind one. Not for stretches too short to read
  (leaves, a pole), nor at the edge of sky that hasn't been looked at.
  An open row in the chart of the night has the same two eyes on its
  plot, on the curve at their times: press one to jump to that moment.
- **"In open sky from here…"**: each object's row in the chart of the
  night is dimmed for the time it's behind something (hover the plot for
  the times, to the nearest five minutes). Only
  for the parts of the sky that have been looked at: turn the view along
  a path to fill in the rest.
- Google's logo, its notices and its controls are kept clear of it.
- Pressing an object's name turns the view to it smoothly, with the
  paths and the chart staying on throughout (this part is always on).

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

- Buildings and terrain aren't modelled; judge the skyline by eye. (With
  the night sky switched on, the app finds the sky in the picture itself:
  a good guide, not a guarantee. It misses some pale skies and takes some
  pale walls for sky.)
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
- [ ] **Skyline segmentation.** Detect where the sky is in the panorama,
  and draw a sky map (stars, constellations, paths) only over it. Objects
  would then be properly hidden behind buildings and trees rather than
  drawn over them, and "clears the roofline at…" could be worked out
  automatically.
  The detection is in the app's code, switched off, with a panel on the
  dev server to switch it on and see it (see
  [DEVELOPMENT.md](DEVELOPMENT.md#the-sky-map)):
  it reads the frame straight from the viewer, finds the sky with a small
  on-device model, and keeps what it finds over the whole sky as the view
  is panned. The sky map is the area itself: every stretch of sky the
  model finds, wherever it is, with as little done to the model's answer
  as will serve.
  Each part of the sky goes by the best view there's been of it (the one
  that had it nearest the middle of the frame, or was zoomed in on it), so
  turning away doesn't spoil what was found and zooming in puts a mistake
  right; and nothing the model itself calls a building is drawn over.
  How the sky map is put together was last settled by eye, and that
  version hasn't been measured against a ground truth.
  The star map is drawn from it, behind a switch that's off to begin
  with: "The night sky over the view", above. It's a
  chart over the whole view at a strength that goes by the sky map, not
  one cut out to the sky, so a mistake in the sky map is a patch that's
  too faint or too strong and not stars on a wall.
  Still to do: measure it, try it on phones, run the
  model off the page's own thread, and handle overcast, glare and trees,
  where it may need a manual touch-up.
  Before publishing: Google's terms forbid "creating content based on Google
  Maps Content", and whether a skyline worked out in the visitor's browser,
  shown only over that same view and never stored, falls under that is
  unsettled. Keep it on-device. (Since 6 October 2026 the prototype does
  store it: each panorama's sky map is kept in the browser's local
  storage, so that a place come back to has its sky at once. It never
  leaves the browser, but it is kept past the view it was made from, and
  that wants weighing again before any of this is published.) The Map
  Tiles API (panorama tiles, 3D tiles) bans image analysis outright, so
  don't use it for this.
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
- [ ] **The night sky without the model (TODO).** Today, if the
  sky-finding model isn't there (no WebGPU, its download failed, the
  graphics card won't take it), none of the night sky is shown. It should
  degrade instead: keep the chart (the twilight tint, the stars, the
  constellation lines and names) at one strength everywhere, on any
  device, and leave out only what needs the sky map: the full-strength
  open sky and darkened buildings, paths dimmed behind things, and the
  times at the skyline. (`main.ts` has a TODO where it gives up.)
- [ ] **Image export.** Save the view with its overlay, via the Street View
  Static API (the live viewer can't be screenshotted from page code).
- [ ] **Cheaper place search (only if costs get high).** Search is the
  dearest thing the app does: Google bills about 2.5¢ per completed search
  (1,000 a month free), against 2.1¢ for the map and Street View of a whole
  visit. Two ways to cut it, in order of preference: keep the suggestions
  but build the box ourselves, waiting for three characters and a pause in
  typing before asking (roughly 1.4¢); or drop the suggestions and look the
  typed text up with Google's Geocoding API on Enter (0.5¢, 10,000 a month
  free). An OpenStreetMap-based search would be free, but sits awkwardly
  with Google's terms on mixing in non-Google map content.

Done:

- [x] **Imagery date selector** (`src/imagery.ts`). How it works is described
  in [DEVELOPMENT.md](DEVELOPMENT.md#street-view-imagery-dates).
