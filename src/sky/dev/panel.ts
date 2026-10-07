// The sky map's development panel: a small bar at the top right of the view
// on the dev server, for switching the sky map on and seeing what it makes
// of a place. It shows the sky map shaded and outlined, the model's sky
// score as a tint, or the model's own labels in colours; and it hands the
// console what probe.ts drives the view with. Loaded only by development
// builds: nothing here is part of the published site.

import { project, unproject, type Camera } from '../../projection';
import type { ChartLook } from '../../skychart';
import type { Look, Sky, SkyHost } from '../index';
import { setSkyEnabled, skyEnabled } from '../preserve';
import { KINDS, kindsOf, type RawMap } from '../types';
import { outlineOf, sampleView } from './area';

export interface PanelHost extends SkyHost {
  /** Where to draw: the element the view fills. */
  view: HTMLElement;
  /** Goes to a panorama by its ID, as a newly chosen place; false if it can't be opened. */
  showPano(id: string): Promise<boolean>;
}

/** Nine places the sky map was worked out at (streets, towers, trees, a pale sky), to go straight to. */
const PLACES: [name: string, where: string, pano: string][] = [
  ['brownstone', '7th Ave, Brooklyn', 'cqNYj2Xk9KcvOh6uGA9SKw'],
  ['london', 'Whitehall, London', '0HLIeuaMeLDeDq_P-z6TnQ'],
  ['midtown', '6th Ave, New York', 'sWTOXXkM7-zFUCKl9b_6Fg'],
  ['riverside', 'W 87th St, New York', 'WrsUAPEwWrZ7ppa_OBntXg'],
  ['seattle', 'Central Library, Seattle', 'ELT1H24mIOaiit07GP-_eQ'],
  ['sunset', 'Noriega St, San Francisco', 'RczgdDnXOunevA-DNMQ8Lw'],
  ['tokyo', 'Ginza, Tokyo', '3wH9YPSHWR-29jzXqGOlEA'],
  ['uws', 'Columbus Ave, New York', 'UOb0dGx2V84xnqxJnacpIg'],
  ['westside', 'West St, New York', '1bs45xlcVyMmKwefUTLOIw'],
];

/** What the panel is handed of the chart drawn over the view (skychart.ts), to show it other ways and to check it. */
export interface ChartTools {
  /** How the chart looks: its numbers, to be changed here; null until the chart is there. */
  look(): ChartLook | null;
  /** Has the view drawn again, after a change to those. */
  redraw(): void;
  /** The chart's weight alone, read back from its canvas, with the view it's of (SkyChart.readWeight). */
  readWeight(): { width: number; height: number; shade: Uint8Array; cam: Camera } | null;
}

/** What can be shown over the view, the one it opens with first. */
type Show = 'chart' | 'chart+edge' | 'weight' | 'map' | 'map+score' | 'score' | 'labels' | 'none';
const SHOWS: [Show, string][] = [
  ['chart', 'chart'],
  ['chart+edge', "chart + sky map's edge"],
  ['weight', "chart's weight + sky map's edge"],
  ['map', 'sky map'],
  ['map+score', "sky map + model's sky score"],
  ['score', "model's sky score"],
  ['labels', "model's labels"],
  ['none', 'nothing'],
];
/** The chart's numbers that are chosen by eye, each with a slider: its name, where it is in ChartLook, and its range. (`edgeColour` is a colour, and has a colour picker: its range isn't used.) */
const LOOKS: [
  name: string,
  key:
    | 'backdrop'
    | 'duskSky'
    | 'duskRest'
    | 'sunGlow'
    | 'restTint'
    | 'starsZoomed'
    | 'stars'
    | 'lookedBelow'
    | 'lookedClose'
    | 'closePorthole'
    | 'edgeGlow'
    | 'edgeWidth'
    | 'edgeLine'
    | 'edgeColour'
    | 'fadePx'
    | 'fadeInsidePx'
    | 'lines'
    | 'horizonSoft',
  index: number,
  max: number,
  min?: number,
][] = [
  ['Backdrop: open sky', 'backdrop', 0, 1],
  ['Backdrop: buildings', 'backdrop', 1, 1],
  ['Backdrop: below horizon', 'backdrop', 2, 1],
  ["Buildings and ground: share of the night's colour", 'restTint', -1, 1],
  ['Open sky comes in from Sun at (°)', 'duskSky', 0, 6, -18],
  ['… and is all there by (°)', 'duskSky', 1, 6, -18],
  ['Buildings and ground come in from Sun at (°)', 'duskRest', 0, 6, -18],
  ['… and are all there by (°)', 'duskRest', 1, 6, -18],
  ["The Sun's side of the sky lighter by (°)", 'sunGlow', -1, 12],
  ['Stars: open sky', 'stars', 0, 1],
  ['Stars: buildings', 'stars', 1, 1],
  ['Stars: below horizon', 'stars', 2, 1],
  ['Stars: buildings, zoomed in a little', 'starsZoomed', -1, 1],
  ['Looking down: backdrop below horizon', 'lookedBelow', 0, 1],
  ['Looking down: stars below horizon', 'lookedBelow', 1, 1],
  ['Zoomed in: backdrop over buildings', 'lookedClose', -1, 1],
  ['Buildings’ porthole: full within (°)', 'closePorthole', 0, 30],
  ['… and gone by (°)', 'closePorthole', 1, 40],
  ['Lines', 'lines', -1, 1],
  ['Fade: how deep (px, out over the roofs)', 'fadePx', -1, 40],
  ["Fade: sky all there (px inside the sky map's edge)", 'fadeInsidePx', -1, 20],
  ['Horizon step (° either side)', 'horizonSoft', -1, 12],
  // The line of light along the sky map's edge, with its glow.
  ['Edge glow: strength, zoomed out', 'edgeGlow', 0, 1],
  ['… and zoomed in', 'edgeGlow', 1, 1],
  ["… its line's thickness (px)", 'edgeLine', -1, 20],
  ['… its width (px)', 'edgeWidth', -1, 30],
  ['… its colour', 'edgeColour', -1, 0],
];
/** The sky map is worked out at points of the view this many pixels apart, and shaded this colour (red, green, blue, and how solid). */
const STEP_PX = 4;
const SHADE = [8, 14, 40, 0.62];
const EDGE = '#ffd84f';
/** The shade comes on across the sky map's edge, at full strength from this far above nothing: the least a cell of sky counts for. */
const SHADE_FULL_AT = 0.02;
/** For the readout: how much of the view the sky map takes up is counted at points this many pixels apart. */
const SHARE_STEP_PX = 24;

/** `sky` is the sky map, if it's on and its model is ready; null shows only the switch. */
export function startSkyPanel(host: PanelHost, sky: Sky | null, chart: ChartTools): void {
  const top = document.createElement('div');
  top.style.cssText = 'position:absolute;top:8px;left:8px;right:8px;z-index:5;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none';
  const panel = document.createElement('div');
  panel.style.cssText =
    'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px 8px;align-items:center;max-width:100%;box-sizing:border-box;padding:6px 8px;' +
    'border-radius:8px;background:rgba(16,20,28,.88);color:#fff;font:12px system-ui,sans-serif;pointer-events:auto';
  const boxed = 'display:flex;gap:4px;align-items:center;white-space:nowrap';
  const selectStyle = 'min-height:0;padding:2px 4px;font:inherit';
  const named = (name: string, control: HTMLElement, tip: string, before = true): HTMLLabelElement => {
    const label = document.createElement('label');
    label.style.cssText = boxed;
    label.title = tip;
    if (before) label.append(name, control);
    else label.append(control, name);
    return label;
  };
  const tick = (checked: boolean) => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = checked;
    return box;
  };
  const list = (label: string, options: [value: string, text: string][], chosen: string) => {
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    select.style.cssText = selectStyle;
    for (const [value, text] of options) select.add(new Option(text, value, false, value === chosen));
    return select;
  };

  // Whether the sky is looked for at all. (The viewer's canvas has to be created with it already on: see preserve.ts.)
  const onBox = tick(skyEnabled());
  onBox.addEventListener('change', () => {
    setSkyEnabled(onBox.checked);
    location.reload();
  });
  panel.append(named('Night sky', onBox, 'Find the sky in the view, and draw the chart of the night sky over it (the same switch as in the settings)', false));
  top.append(panel);
  host.view.append(top);
  if (!sky) return;

  // Straight to one of the recorded places. (probe.ts finds this list by its label.)
  const placeSelect = list('Recorded place', [['', 'choose…'], ...PLACES.map(([name, where]): [string, string] => [name, `${name} (${where})`])], '');
  const showPlace = () => (placeSelect.value = PLACES.find(([, , id]) => id === host.panoId())?.[0] ?? '');
  placeSelect.addEventListener('pointerdown', showPlace);
  placeSelect.addEventListener('change', () => {
    const place = PLACES.find(([name]) => name === placeSelect.value);
    if (place) void host.showPano(place[2]).then(showPlace);
    else showPlace();
  });
  const showSelect = list('Show', SHOWS, SHOWS[0][0]);
  const show = () => showSelect.value as Show;
  const rememberBox = tick(sky.remember);
  rememberBox.addEventListener('change', () => (sky.remember = rememberBox.checked));
  const status = document.createElement('span');
  status.style.cssText = 'opacity:.8;white-space:nowrap';
  panel.append(
    named('Test place', placeSelect, 'Go to one of the places the sky map was worked out at'),
    named(
      'Show',
      showSelect,
      "What's drawn over the view. Chart: as the app draws it. Its weight: how far each pixel counts as open sky, as one flat shade. " +
        "Sky map: shaded dark and outlined, by this panel. Model's sky score: how sky-like the model scored each part of the frame, " +
        "as a blue tint as faint as the score is low. Model's labels: what the model itself calls each part of the frame, in colours, with a key.",
    ),
    named('Remember places', rememberBox, "Keep each place's sky map, in this browser, so that a place come back to has it at once", false),
    status,
  );
  // The chart's numbers, on sliders: behind a button, since they're many.
  const looks = document.createElement('div');
  looks.style.cssText =
    'display:none;grid-template-columns:auto 120px 32px;gap:2px 8px;align-items:center;padding:6px 8px;border-radius:8px;' +
    'background:rgba(16,20,28,.88);color:#fff;font:12px system-ui,sans-serif;pointer-events:auto';
  const looksButton = document.createElement('button');
  looksButton.type = 'button';
  looksButton.style.cssText = 'min-height:0;padding:2px 6px;font:inherit;border-radius:6px;cursor:pointer';
  // The button opens the sliders and folds them away again. (By its style, not `hidden`: the box is laid out as a grid, which `hidden` doesn't undo.)
  let looksOpen = false;
  const showLooks = () => {
    looks.style.display = looksOpen ? 'grid' : 'none';
    looksButton.textContent = looksOpen ? 'Chart’s look ▴' : 'Chart’s look ▾';
    looksButton.setAttribute('aria-expanded', String(looksOpen));
  };
  showLooks();
  looksButton.addEventListener('click', () => {
    looksOpen = !looksOpen;
    showLooks();
    const look = chart.look();
    if (!looksOpen || !look || looks.childElementCount) return;
    /** Each slider's way back to what the chart opened with. */
    const resets: (() => void)[] = [];
    // A colour: a colour picker, with the colour written out under it (red, green and blue, 0–1, as CHART_LOOK has them)
    // to be copied down once it's right.
    const hex = (rgb: number[]) => `#${rgb.map((part) => Math.round(Math.max(0, Math.min(1, part)) * 255).toString(16).padStart(2, '0')).join('')}`;
    const colourRow = (name: string) => {
      const opened = [...look.edgeColour] as [number, number, number];
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.setAttribute('aria-label', name);
      picker.title = 'Double-click to put this one back';
      picker.style.cssText = 'width:120px;height:20px;min-height:0;padding:0;border:0;background:none;cursor:pointer';
      const value = document.createElement('span');
      value.style.cssText = 'grid-column:1 / -1;justify-self:end;opacity:.75;font-variant-numeric:tabular-nums';
      const set = (to: [number, number, number]) => {
        look.edgeColour = to;
        picker.value = hex(to);
        value.textContent = to.map((part) => part.toFixed(2)).join(', ');
        chart.redraw();
      };
      picker.addEventListener('input', () => set([1, 3, 5].map((at) => parseInt(picker.value.slice(at, at + 2), 16) / 255) as [number, number, number]));
      picker.addEventListener('dblclick', (event) => {
        event.preventDefault();
        set([...opened]);
      });
      resets.push(() => set([...opened]));
      looks.append(name, picker, document.createElement('span'), value);
      set([...opened]);
    };
    for (const [name, key, index, max, min = 0] of LOOKS) {
      if (key === 'edgeColour') {
        colourRow(name);
        continue;
      }
      const read = () => (index < 0 ? (look[key] as number) : (look[key] as number[])[index]);
      const write = (to: number) => {
        if (index < 0) (look[key] as number) = to;
        else (look[key] as number[])[index] = to;
      };
      const opened = read();
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String((max - min) / 100);
      slider.value = String(opened);
      slider.setAttribute('aria-label', name);
      slider.title = 'Double-click to put this one back';
      const value = document.createElement('span');
      value.textContent = opened.toFixed(2);
      const set = (to: number) => {
        write(to);
        slider.value = String(to);
        value.textContent = to.toFixed(2);
        chart.redraw();
      };
      slider.addEventListener('input', () => set(Number(slider.value)));
      slider.addEventListener('dblclick', () => set(opened));
      resets.push(() => set(opened));
      looks.append(name, slider, value);
    }
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset all';
    reset.title = 'Put every one of these back to what the chart opens with';
    reset.style.cssText = 'grid-column:1 / -1;justify-self:end;min-height:0;margin-top:4px;padding:2px 8px;font:inherit;border-radius:6px;cursor:pointer';
    reset.addEventListener('click', () => resets.forEach((back) => back()));
    looks.append(reset);
  });
  panel.append(looksButton);
  top.append(looks);
  const key = document.createElement('div');
  key.style.cssText =
    'align-self:flex-start;max-width:min(360px,100%);box-sizing:border-box;padding:6px 8px;' +
    'border-radius:8px;background:rgba(16,20,28,.88);color:#fff;font:12px/1.5 system-ui,sans-serif';
  key.hidden = true;
  top.append(key);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none';
  host.view.append(canvas);
  const draw = canvas.getContext('2d')!;

  /** The last look: pictures of the model's score (as the grid took it) and of its labels, to lay over the view, and the view they're of. */
  let last: { score: HTMLCanvasElement; labels: HTMLCanvasElement; cam: Camera; pano: string } | null = null;

  /** A picture a pixel to each of a map's cells, coloured by `colour` (red, green, blue, and how solid, 0–255). */
  function picture(map: RawMap, colour: (i: number) => [number, number, number, number]): HTMLCanvasElement {
    const image = document.createElement('canvas');
    image.width = map.width;
    image.height = map.height;
    const ctx = image.getContext('2d')!;
    const pixels = ctx.createImageData(map.width, map.height);
    for (let i = 0; i < map.sky.length; i++) pixels.data.set(colour(i), i * 4);
    ctx.putImageData(pixels, 0, 0);
    return image;
  }

  /** The key to the labels: each kind there's any of, with how much of the frame it takes up and what the model's own names for it there are. */
  function writeKey(map: RawMap): void {
    const { classes, names } = map.labels;
    const kinds = kindsOf(names);
    const cells = new Float64Array(names.length);
    for (let i = 0; i < classes.length; i++) cells[classes[i]]++;
    const share = (count: number) => {
      const percent = (count / classes.length) * 100;
      return percent >= 10 ? `${Math.round(percent)}%` : percent >= 0.95 ? `${percent.toFixed(1)}%` : '<1%';
    };
    key.replaceChildren();
    const title = document.createElement('div');
    title.style.cssText = 'opacity:.8;margin-bottom:2px';
    title.textContent = `What the model calls each of ${map.width}×${map.height} points`;
    key.append(title);
    KINDS.forEach((kind, k) => {
      const mine = [...cells.keys()].filter((c) => kinds[c] === k && cells[c] > 0).sort((a, b) => cells[b] - cells[a]);
      if (!mine.length) return;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:baseline';
      const swatch = document.createElement('span');
      swatch.style.cssText = `flex:none;width:10px;height:10px;border-radius:2px;background:rgb(${kind.colour.join(',')});align-self:center`;
      const text = document.createElement('span');
      const all = mine.reduce((sum, c) => sum + cells[c], 0);
      const own = mine.slice(0, 5).map((c) => `${names[c]} ${share(cells[c])}`);
      if (mine.length > 5) own.push(`${mine.length - 5} more`);
      text.textContent = mine.length === 1 && names[mine[0]] === kind.name ? `${kind.name} ${share(all)}` : `${kind.name} ${share(all)}: ${own.join(', ')}`;
      row.append(swatch, text);
      key.append(row);
    });
  }

  /** How much of a view the sky map takes up, for the readout. */
  function share(cam: Camera): number {
    const { values } = sampleView(cam, SHARE_STEP_PX, (alt, az) => sky!.at(alt, az));
    let has = 0;
    for (const value of values) if (value > 0) has++;
    return Math.round((has / values.length) * 100);
  }

  /** Every look as the app makes it, for whatever a script wants of them (see probe.ts). */
  let recorder: ((map: RawMap, cam: Camera, still: boolean, taken: RawMap) => void) | null = null;
  sky.onLook((look: Look) => {
    const { map, taken, cam } = look;
    const kinds = kindsOf(map.labels.names);
    last = {
      score: picture(taken, (i) => [60, 160, 255, taken.sky[i] * 255]),
      labels: picture(map, (i) => [...KINDS[kinds[map.labels.classes[i]]].colour, 255]),
      cam,
      pano: host.panoId(),
    };
    if (show() === 'labels') writeKey(map);
    status.textContent =
      `${sky.status} · model ${Math.round(look.modelMs)} ms, sky map ${Math.round(look.mapMs)} ms · ` +
      `${map.width}×${map.height} cells · sky map over ${share(cam)}% of the view`;
    recorder?.(map, cam, look.still, taken);
  });
  /** Has the chart drawn as what's shown wants it: itself, its weight alone, or not at all (under the panel's own drawings). */
  const setChart = () => {
    const look = chart.look();
    if (!look) return;
    look.flat = show() === 'weight';
    look.off = !show().startsWith('chart') && show() !== 'weight';
    chart.redraw();
  };
  showSelect.addEventListener('change', () => {
    key.hidden = show() !== 'labels';
    key.textContent = 'looking…';
    // (What the model makes of a frame is of the frame on screen, whatever is known of the sky there.)
    sky.lookAlways = show() === 'map+score' || show() === 'score' || show() === 'labels';
    setChart();
  });

  /**
   * Draws a picture of what the model made of a frame over the view as it
   * is now: each part of it where that part of the scene now is on screen.
   * A look is always of the view a moment ago, so while the view turns the
   * picture is carried along with the scene until the next look's replaces
   * it. (Laid by three points of the frame it's of: right for a view that
   * has turned a degree or two since, which is all it's asked for.)
   */
  function drawOver(image: HTMLCanvasElement, from: Camera, cam: Camera, alpha: number, crisp: boolean): void {
    const now = (u: number, v: number) => {
      const { alt, az } = unproject(u * from.width, v * from.height, from);
      return project(alt, az, cam);
    };
    const a = now(0.25, 0.25);
    const b = now(0.75, 0.25);
    const c = now(0.25, 0.75);
    if (![a, b, c].every((p) => p.z > 0 && Number.isFinite(p.x) && Number.isFinite(p.y))) return;
    const ux = (b.x - a.x) / (image.width / 2);
    const uy = (b.y - a.y) / (image.width / 2);
    const vx = (c.x - a.x) / (image.height / 2);
    const vy = (c.y - a.y) / (image.height / 2);
    draw.save();
    draw.transform(ux, uy, vx, vy, a.x - (ux * image.width + vx * image.height) / 4, a.y - (uy * image.width + vy * image.height) / 4);
    draw.globalAlpha = alpha;
    draw.imageSmoothingEnabled = !crisp;
    draw.drawImage(image, 0, 0);
    draw.restore();
  }

  /** The sky map as last worked out for drawing: what view and version of it, its shade (a pixel for each point), and its edge. */
  let drawn: { key: string; edge: Path2D } | null = null;
  const shade = document.createElement('canvas');
  const shadeCtx = shade.getContext('2d')!;
  function skyMapFor(cam: Camera): Path2D {
    const drawnKey = [host.panoId(), cam.heading, cam.pitch, cam.hfov, cam.width, cam.height, sky!.version].join('|');
    if (drawn?.key === drawnKey) return drawn.edge;
    const field = sampleView(cam, STEP_PX, (alt, az) => sky!.at(alt, az));
    shade.width = field.cols;
    shade.height = field.rows;
    const pixels = shadeCtx.createImageData(field.cols, field.rows);
    const [red, green, blue, solid] = SHADE;
    for (let i = 0; i < field.values.length; i++) {
      // (Half strength on the edge itself, full just inside it.)
      const strength = 0.5 + field.values[i] / (2 * SHADE_FULL_AT);
      pixels.data.set([red, green, blue, Math.max(0, Math.min(1, strength)) * solid * 255], i * 4);
    }
    shadeCtx.putImageData(pixels, 0, 0);
    const edge = new Path2D();
    const ends = outlineOf(field, 0);
    for (let i = 0; i < ends.length; i += 4) {
      edge.moveTo(ends[i], ends[i + 1]);
      edge.lineTo(ends[i + 2], ends[i + 3]);
    }
    drawn = { key: drawnKey, edge };
    return edge;
  }

  function render(): void {
    const cam = host.camera();
    const scale = window.devicePixelRatio || 1;
    const width = host.view.clientWidth;
    const height = host.view.clientHeight;
    if (canvas.width !== width * scale || canvas.height !== height * scale) {
      canvas.width = width * scale;
      canvas.height = height * scale;
    }
    draw.setTransform(scale, 0, 0, scale, 0, 0);
    draw.clearRect(0, 0, width, height);
    if (!last) status.textContent = sky!.status;
    if (!cam) return;
    // (What the model made of a place isn't shown over the next one.)
    if (last && last.pano !== host.panoId()) last = null;
    // The model's own labels, and nothing of ours over them.
    if (show() === 'labels') {
      if (last) drawOver(last.labels, last.cam, cam, 0.6, true);
      return;
    }
    if (show() === 'chart') return;
    const withMap = show() === 'map' || show() === 'map+score';
    const edge = withMap || show() === 'chart+edge' || show() === 'weight' ? skyMapFor(cam) : null;
    if (edge && withMap) draw.drawImage(shade, -STEP_PX / 2, -STEP_PX / 2, shade.width * STEP_PX, shade.height * STEP_PX);
    if ((show() === 'map+score' || show() === 'score') && last) drawOver(last.score, last.cam, cam, 0.35, false);
    if (edge) {
      draw.lineWidth = 1.5;
      draw.strokeStyle = EDGE;
      draw.stroke(edge);
    }
  }
  const loop = () => {
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  /**
   * Whether the chart's weight is where the sky map is: the chart drawn as
   * its flat shade alone, read back, and set against `at` at points of the
   * view `step` pixels apart. Gives how many points were asked, how many
   * disagree (shaded and not sky, or sky and not shaded), and how many of
   * those are more than a pixel from the sky map's edge, which none should
   * be. (Not while the sky map is still easing in: what's drawn then lags it
   * on purpose.)
   */
  function checkWeight(step = 3): { points: number; differ: number; farFromEdge: number } | null {
    const read = chart.readWeight();
    if (!read) return null;
    const { width, height, shade, cam } = read;
    const scale = width / cam.width;
    const skyAt = (x: number, y: number) => {
      const { alt, az } = unproject(x, y, cam);
      return sky!.at(alt, az) > 0;
    };
    let points = 0;
    let differ = 0;
    let farFromEdge = 0;
    for (let y = step; y < cam.height - 40; y += step) {
      for (let x = step; x < cam.width - step; x += step) {
        points++;
        // (The canvas's rows run from the bottom up; a pixel's middle is half a pixel in.)
        const shaded = shade[(height - 1 - Math.min(height - 1, Math.floor((y + 0.5) * scale))) * width + Math.min(width - 1, Math.floor((x + 0.5) * scale))] > 70;
        const is = skyAt(x + 0.5, y + 0.5);
        if (shaded === is) continue;
        differ++;
        const near = [-1.5, 0, 1.5].some((dy) => [-1.5, 0, 1.5].some((dx) => skyAt(x + 0.5 + dx, y + 0.5 + dy) !== is));
        if (!near) farFromEdge++;
      }
    }
    chart.redraw();
    return { points, differ, farFromEdge };
  }

  // For the console, and for probe.ts, which turns the view by script and says what's on screen:
  // `const probe = await __skylineProbe()`.
  Object.assign(window, {
    __chart: { look: () => chart.look(), redraw: () => chart.redraw(), checkWeight },
    __skylineProbe: () => import('./probe'),
    __skyline: {
      get grid() {
        return sky.cells;
      },
      get fill() {
        return sky.fill;
      },
      counts: sky.counts,
      snapshot: () => sky.snapshot(),
      setRecorder: (to: typeof recorder) => (recorder = to),
      busy: () => sky.busy(),
      places: {
        get count() {
          return sky.places.count;
        },
        forget: () => sky.places.forget(),
      },
      setRemember: (on: boolean) => (sky.remember = rememberBox.checked = on),
      startAfresh: () => {
        sky.startAfresh();
        last = null;
      },
      sky,
    },
  });
}
