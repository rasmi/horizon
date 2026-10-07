// The chart of the sky, drawn over the whole view: the night's colour, the
// constellations' lines and the stars, each at a strength that goes by
// what's there. Where the sky map says open sky, full strength (the day's sky
// in the picture is gone); over anything else above the horizon, a building
// or a tree or sky not looked at yet, fainter (it shows through, darkened);
// below the horizon, a setting of its own.
//
// So the sky map isn't a cut-out here. It's a weight from 0 to 1 for every
// pixel: how far that point is open sky. The weight is nothing at the sky
// map's edge and rises to 1 a dozen pixels inside it, at any zoom, so that
// the full strength never reaches a roof or a leaf.
//
// It's one WebGL canvas under the paths. Every frame it's drawn afresh from
// where the view is that frame, so it's fixed to the picture with no lag.
// What the sky map says is eased, never where it is: skyease.ts.
//
// Google's logo, its copyright line and its controls are kept clear, always:
// the layer fades to nothing round each.

import type { Camera } from './projection';
import { ALT_TOP } from './sky/geometry';
import { plainContext } from './sky/preserve';
import { duskShare, SKY_STOPS } from './skycolor';
import { FAINTER_PER_DEG } from './stars';
import { EasedSky, POUR_HURRIED_MS, POUR_MOST_MS } from './skyease';
import type { Catalogue } from './stars';

const RAD = Math.PI / 180;

/** What the chart draws from: the sky map (SkyMap in sky/index.ts has all of it). */
export interface ChartSky {
  readonly level: ArrayLike<number>;
  depth(): ArrayLike<number>;
  readonly bins: number;
  readonly rows: number;
  readonly step: number;
  readonly version: number;
  readonly epoch: number;
  readonly pictureHere: boolean;
}

/** How the chart looks: the numbers that are chosen by eye. (The development panel has sliders for them.) */
export interface ChartLook {
  /** How solid the night's colour is, once it's night: in open sky, over anything else above the horizon, and below the horizon. */
  backdrop: [open: number, other: number, below: number];
  /**
   * The backdrop comes in as the Sun goes down, and goes as it comes up: not
   * there with the Sun at the first of these altitudes (degrees; below the
   * horizon is less than 0), all there by the second, and smoothly between.
   * One pair for open sky, and one for everything else (buildings, trees,
   * and below the horizon), which can so darken later and more slowly than
   * the sky does, as the ground does at dusk.
   */
  duskSky: [from: number, full: number];
  duskRest: [from: number, full: number];
  /**
   * How much the sky differs from one side to the other around sunset and
   * sunrise, in degrees of the Sun's altitude: low down on the Sun's side
   * it's as light as if the Sun were three-quarters of this higher, and on
   * the far side as dark as if it were most of this lower. So the west is lighter than the east
   * at dusk, in colour and in how far the backdrop has come in, and the
   * stars come out in the east first. 0 for one tone all over. (It fades to
   * nothing by the end of twilight: the night is one tone.)
   */
  sunGlow: number;
  /**
   * What isn't open sky is darkened, not covered: its own light is cut by
   * the backdrop's strength there, and this share of the night's colour is
   * laid on it. At 1 it's the colour in full, which reads as the building
   * faded out towards the sky's colour; at 0, the building only darker, as
   * it is at night. (By day the backdrop isn't there, and it's as the
   * picture has it.)
   */
  restTint: number;
  /** How strong the stars and the constellations' lines are, in the same three. (Over buildings, in a view at its widest: see `starsZoomed`.) */
  stars: [open: number, other: number, below: number];
  /** How strong the stars over buildings are once the view is zoomed in a little (they come up all across it, from 1.1 times its widest to twice). */
  starsZoomed: number;
  /**
   * With the view turned down under the horizon, what's below the horizon is
   * drawn stronger, to be looked at: the backdrop at the first of these and
   * the stars at the second, in place of their "below" strengths. Only
   * round the middle of the view, fading out away from it, as through a
   * porthole of a fixed size in the sky (so it fills more of a view that's
   * zoomed in); and it opens quickly as the view goes down, and shuts as it
   * comes back up. These two are for the view zoomed right out: as it's
   * zoomed in a little, both go up to 1.
   */
  lookedBelow: [backdrop: number, stars: number];
  /**
   * With the view zoomed in, the backdrop over buildings and trees is this
   * solid, in place of its own strength there: through the same porthole,
   * and only by the zoom (it comes on gradually as the view is zoomed in
   * for a close look, from one and a half times its widest to four and a half, whichever way
   * it's turned).
   */
  lookedClose: number;
  /**
   * The size of the porthole over buildings (for the stars there going up on
   * zoom, and `lookedClose`), in degrees of the sky: full within the first
   * of these of the view's middle, and none beyond the second. Much smaller
   * than the one under the horizon (24° and 48°), so that it's a porthole
   * still in a view that's zoomed in.
   */
  closePorthole: [full: number, none: number];
  /**
   * How deep the fade at the sky map's edge is, in pixels: how far it takes
   * to go from the strength over buildings to the open sky's. It runs out
   * from the point where the sky is all there (`fadeInsidePx`), towards and
   * over the roofs: so a deeper fade is a more gradual one that reaches
   * further out over the buildings, and uncovers no more of the day's sky.
   * (As far as the sky map tells of, which is a little over two degrees
   * outside its edge: about 20 px at the widest view.)
   */
  fadePx: number;
  /** How far inside the sky map's edge the open sky is all there, in pixels: where the fade ends. Less brings the night's sky nearer the roofs; 0, right up to them. */
  fadeInsidePx: number;
  /** What isn't open sky goes from its strength above the horizon to the one below it over this many degrees either side of the horizon. (Open sky keeps its own right down to it.) */
  horizonSoft: number;
  /** How strong the constellations' lines are beside the stars. */
  lines: number;
  /**
   * How strongly the sky map's edge is marked, where the night's sky meets
   * the roofs and trees: a thin line of light with a soft glow either side,
   * at any zoom. Two strengths, for a view at its widest and for one zoomed
   * well in (it goes from the one to the other with the zoom). 0 for none.
   * It's this that softens the edge now, in the fade's place: the fade
   * itself is only a few pixels.
   */
  edgeGlow: [widest: number, zoomedIn: number];
  /**
   * How thick the line itself is, in pixels across. Up to a couple of pixels
   * it's placed by the sky map's level, exactly; thicker, by its depth, as
   * the glow is, which keeps it even along a slanting roof. (As far as the
   * depth tells of: about 20 px either side at the widest view.)
   */
  edgeLine: number;
  /** The line's colour: red, green and blue, each 0–1. */
  edgeColour: [number, number, number];
  /** How wide the line's glow is: the distance from the line, in pixels, at which the glow is down to about a third. */
  edgeWidth: number;
  /** Draws only the weight, as one flat shade, with nothing else: for seeing that it's in the right place. */
  flat: boolean;
  /** Draws nothing at all: for looking at the picture, or at something else laid over it. */
  off: boolean;
}

export const CHART_LOOK: ChartLook = {
  backdrop: [1, 0.6, 0.8],
  duskSky: [4, -6],
  duskRest: [4, -12],
  sunGlow: 5,
  restTint: 0,
  stars: [1, 0.3, 0.2],
  starsZoomed: 0.8,
  lookedBelow: [0.9, 0.8],
  lookedClose: 0.95,
  closePorthole: [6, 18],
  fadePx: 3,
  fadeInsidePx: 1,
  horizonSoft: 6,
  lines: 0.2,
  edgeGlow: [0.4, 0.8],
  edgeLine: 3,
  edgeColour: [0.9, 0.95, 1],
  edgeWidth: 2,
  flat: false,
  off: false,
};

/** One frame's worth of what the chart is drawn for. */
export interface ChartFrame {
  cam: Camera;
  /** The clock, for what's easing (ms, as requestAnimationFrame gives it). */
  now: number;
  /** Where the Sun is at the chosen time, in degrees: the backdrop's colour, how far it has come in, and how the sky differs from one side to the other all go by it. */
  sunAlt: number;
  sunAz: number;
  /** The faintest star to show, as two limits (stars.ts): by how dark the sky is with the Sun where it is, and the most the view shows however dark. */
  faintestDark: number;
  faintestMost: number;
  /** Where the stars are: the rotation from among the stars to the sky. Null until they're worked out. */
  rotation: Float32Array | null;
}

/** The backdrop is the colour the sky has with the Sun this many degrees lower than it's taken to be: erring on the dark side, so that sunset isn't as bright as day. */
const COLOUR_AHEAD_DEG = 3.4;
/** What's kept clear is measured again this often while drawing: Google's controls come and go. */
const CLEAR_EVERY_MS = 500;
/** Nothing this much of the view across or down is one of Google's controls: it's part of the picture. */
const CLEAR_MOST_SHARE = 0.4;
/** A box counts as there to be kept clear if its background is at least this solid. */
const CLEAR_SOLID_FROM = 0.3;
/** The porthole (ChartLook.lookedBelow) starts to open with the middle of the view this far under the horizon, in degrees, and is wide open by this far; and it gets most of the way to where it's heading in this long. */
const PORTHOLE_FROM_DEG = 1;
const PORTHOLE_OPEN_BY_DEG = 8;
const PORTHOLE_MS = 180;
/** A frame that takes longer than this is late; this many running while something eases, and the easing is dropped. */
const LATE_MS = 50;
const LATE_RUN = 5;
/** The canvas is drawn at no more than this many of its own pixels to one of the page's. */
const SCALE_MOST = 2;

/**
 * The porthole's size in the sky (see ChartLook.lookedBelow): everything
 * within the first of these angles of the view's middle is at its full
 * strength, and nothing beyond the second, in degrees. (At the widest view,
 * 90° across, that's full to nearly half-way out and gone a little past the
 * edge's middle.) As tangents, which is what a flat view measures in.
 */
const PORTHOLE_FULL_DEG = 24;
const PORTHOLE_NONE_DEG = 48;
/**
 * A view counts as zoomed in from this many times the size things have at
 * its widest, and fully by this many. It's what brings the porthole's
 * strengths up (ChartLook.lookedBelow, to 1; .lookedClose, on): zoomed in a
 * little, to look, it's all there.
 */
const ZOOMED_FROM = 1.1;
const ZOOMED_BY = 1.8;
/**
 * Over buildings it comes on gradually, over a long stretch of zooming and
 * evenly for each doubling of size, so that it's never seen to switch: the
 * stars there up to full strength from this many times the view's widest to
 * this many; and the backdrop (ChartLook.lookedClose), which waits for a
 * closer look, from this many to this many.
 */
const STARS_CLOSE_FROM = 1.15;
const STARS_CLOSE_BY = 4;
/**
 * The constellations' lines are faint over buildings in a view at its
 * widest (as faint as they are below the horizon): they come up there, all
 * across the view, as it's zoomed in, from this many times its widest to
 * this many (sooner than the stars finish coming up).
 */
const LINES_CLOSE_FROM = 1.1;
const LINES_CLOSE_BY = 2;
const CLOSE_FROM = 1.5;
const CLOSE_BY = 4.5;
const PORTHOLE_FULL_TAN = Math.tan(PORTHOLE_FULL_DEG * RAD);
const PORTHOLE_NONE_TAN = Math.tan(PORTHOLE_NONE_DEG * RAD);

const SHARED = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform vec2 uSize;
uniform float uFocal;
uniform mat3 uView;
uniform sampler2D uSky;
uniform vec4 uGrid;
uniform float uHorizonSoft;
uniform vec3 uStrength;
uniform vec3 uSun;
uniform vec2 uLookedBelow;
uniform vec2 uLookedClose;
uniform vec2 uClosePorthole;

// Where a point of the sky falls in the sky map's picture: a row across, a direction down.
vec2 skyUv(float alt, float az) {
  return vec2(((uGrid.w - alt) / uGrid.z + 0.5) / uGrid.x, (az / uGrid.z + 0.5) / uGrid.y);
}
// The strength of something at this altitude, where the sky is open by this much, given its strengths in open sky, over
// anything else, and below the horizon. What isn't open sky goes gradually from its strength above the horizon to the one
// below it, over the horizon's step either side. Open sky keeps its own strength right down to the horizon (blended like
// the rest, the day's sky would show through low down), and counts for nothing under it.
float strengthAt(float alt, float open, vec3 strength) {
  float rest = mix(strength.z, strength.y, smoothstep(-uHorizonSoft, uHorizonSoft, alt));
  return mix(rest, strength.x, open * smoothstep(-1.0, 0.0, alt));
}
// The three strengths at a point of the view (given by how far it is from the view's middle, as the tangent of that
// angle). They're the same all over, but for the one below the horizon while the view is turned down under it: then,
// round the middle of the view and fading out away from it, as through a porthole, what's below the horizon is drawn
// at a strength of its own (uLookedBelow: that strength, and how far the porthole is open). The porthole is a size in
// the sky, not on the screen: so it takes up more of a view that's zoomed in, and all of one zoomed in far enough.
// And through the same porthole, in a view that's zoomed in, what's over buildings and trees has a strength of its own
// likewise (uLookedClose: that strength, and how far the view's zoom has brought it on).
// (How far each porthole is open at the point last asked of strengthsAt, 0 to 1: the one under the horizon, and the buildings'.)
float portholeBelow;
float portholeClose;
vec3 strengthsAt(vec2 fromMiddle) {
  portholeBelow = uLookedBelow.y * (1.0 - smoothstep(${PORTHOLE_FULL_TAN.toFixed(4)}, ${PORTHOLE_NONE_TAN.toFixed(4)}, length(fromMiddle)));
  // (The one over buildings is a much smaller porthole than the one under the horizon: uClosePorthole, the tangents of
  // the angles it's full within and gone beyond.)
  portholeClose = uLookedClose.y * (1.0 - smoothstep(uClosePorthole.x, uClosePorthole.y, length(fromMiddle)));
  return vec3(uStrength.x, mix(uStrength.y, uLookedClose.x, portholeClose), mix(uStrength.z, uLookedBelow.x, portholeBelow));
}
// The Sun's altitude as this part of the sky has it. Around sunset the sky isn't one tone: the Sun's side of it, and
// most of all low down there, is as light as if the Sun were some degrees higher, and the side away from it as dark as if
// it were lower. uSun is the Sun's own altitude and azimuth, and how many degrees its side differs by (none, deep in
// the night). Everything that goes by how dark it is goes by this: the backdrop's colour, how far it has come in,
// and how faint a star shows.
float sunHere(float alt, float az) {
  float toward = cos(radians(az - uSun.y));
  // (Erring on the dark side: the Sun's side is lightened by less than the far side is darkened.)
  if (toward > 0.0) toward *= 0.6;
  float low = 1.0 - smoothstep(0.0, 60.0, alt);
  return uSun.x + uSun.z * (toward * (0.35 + 0.65 * low) + 0.15 * low);
}
`;

const FRAGMENT_SHARED = `
uniform float uFade;
uniform float uFadeEnd;
uniform sampler2D uMask;

// How far the pixel last asked of openAt is from the sky map's edge, in pixels: above nothing inside the sky map, below
// it outside. (Good near the edge, where it's wanted: it's from the level and how steeply the level changes there.)
float edgeAway;
// The same from the sky map's depth, which is good further off too: a true distance, up to a couple of degrees either
// side of the edge.
float edgeDeep;
// (How many pixels a degree is there.)
float edgePxPerDeg;
// And the depth in the sky map's own cells: under a cell's worth, the pixel is beside the edge.
float edgeCells;

// How far a pixel is open sky, 0 to 1 (nothing at the sky map's edge, 1 a fade's depth inside it); its altitude; whether
// it's inside the sky map at all; and its azimuth.
vec4 openAt(vec2 frag) {
  vec3 ray = vec3(frag - uSize * 0.5, uFocal);
  vec3 dir = normalize(uView * ray);
  float alt = degrees(asin(clamp(dir.z, -1.0, 1.0)));
  float az = degrees(atan(dir.x, dir.y));
  vec2 cell = texture(uSky, skyUv(alt, az)).rg;
  // The edge is where the level passes nothing: a pixel wide, however the cells lie.
  float inside = clamp(cell.r / max(fwidth(cell.r), 1e-5) + 0.5, 0.0, 1.0);
  edgeAway = cell.r / max(length(vec2(dFdx(cell.r), dFdy(cell.r))), 1e-5);
  // The fade is a size on screen: so many pixels, at this point's own scale (a view's edges are stretched).
  float toAxis = uFocal / length(ray);
  float pxPerDeg = uFocal / pow(toAxis, 1.5) * ${RAD};
  edgeDeep = cell.g * pxPerDeg;
  edgePxPerDeg = pxPerDeg;
  edgeCells = cell.g / uGrid.z;
  // It's all there so many pixels inside the edge (uFadeEnd), and runs out from that point for as many pixels as the fade
  // is deep (uFade): so a deeper fade reaches further out over the roofs, and uncovers no more of the sky. Both ways
  // only as far as the depth tells of, which is a little over two degrees either side of the edge.
  float end = min(uFadeEnd / pxPerDeg, 2.3);
  float start = max(end - uFade / pxPerDeg, -2.3);
  float deep = clamp((cell.g - start) / max(end - start, 1e-4), 0.0, 1.0);
  // (Started outside the edge, the fade is its own soft edge; from the edge or inside it, nothing is drawn outside.)
  float within = start < 0.0 ? 1.0 : inside;
  // (Nearly a straight run from nothing to all, a little eased at its two ends: eased more, most of the change came in
  // the middle third, and it read as an edge.)
  return vec4(within * mix(deep, deep * deep * (3.0 - 2.0 * deep), 0.35), alt, inside, az);
}
// 1 where the layer may draw, and 0 over what's kept clear: Google's logo, notices and controls, in their own shapes,
// which the mask is a picture of.
float mayDraw(vec2 frag) {
  // (Only where a thing is solid. Its own soft rim, a pixel of half-there edge, is drawn over like the picture beside it:
  // held back by half, the day's sky would show through there as a pale line round the thing.)
  float solid = texture(uMask, vec2(frag.x, uSize.y - frag.y) / uSize).a;
  return 1.0 - smoothstep(0.6, 0.85, solid);
}
`;

const VERTEX_SHARED = `
uniform mat3 uSkyRot;
// Where a direction among the stars is in the sky, as it's seen: turned for the place and time, and lifted by the air's
// bending of light near the horizon (stars.ts has the same sum). Its altitude and azimuth, in degrees, come back in "where".
vec3 seen(vec3 star, out vec2 where) {
  vec3 sky = uSkyRot * star;
  float alt = degrees(asin(clamp(sky.z, -1.0, 1.0)));
  float from = max(alt, -1.0);
  float lift = 1.02 / tan(radians(from + 10.3 / (from + 5.11))) / 60.0;
  if (alt < -1.0) lift *= (alt + 90.0) / 89.0;
  alt += lift;
  float az = atan(sky.x, sky.y);
  where = vec2(alt, degrees(az));
  float flat2 = cos(radians(alt));
  return vec3(flat2 * sin(az), flat2 * cos(az), sin(radians(alt)));
}
`;

const BACKDROP_VERTEX = `#version 300 es
in vec2 aCorner;
void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

const BACKDROP_FRAGMENT = `${SHARED}${FRAGMENT_SHARED}
uniform int uFlat;
uniform vec4 uDusk;
uniform float uTint;
uniform float uEdgeThick;
uniform vec4 uEdge;
uniform vec4 uEdgeLine;
uniform float uStopAlt[${SKY_STOPS.length}];
uniform vec3 uStopColour[${SKY_STOPS.length}];
out vec4 colour;
// How far something has come in for the night with the Sun this high: nothing at the first altitude, all of it by the second.
float cameIn(float sun, vec2 between) {
  if (between.x == between.y) return sun <= between.y ? 1.0 : 0.0;
  float share = clamp((sun - between.x) / (between.y - between.x), 0.0, 1.0);
  return share * share * (3.0 - 2.0 * share);
}
// The sky's colour with the Sun this high: the slider's own steps, blended (skycolor.ts).
vec3 skyColour(float sun) {
  vec3 mixed = uStopColour[0];
  for (int i = 0; i < ${SKY_STOPS.length - 1}; i++) {
    mixed = mix(mixed, uStopColour[i + 1], clamp((uStopAlt[i] - sun) / (uStopAlt[i] - uStopAlt[i + 1]), 0.0, 1.0));
  }
  return mixed;
}
// How far inside the sky map the point of the sky at a pixel is, in degrees: the depth alone (see openAt).
float depthAt(vec2 frag) {
  vec3 dir = normalize(uView * vec3(frag - uSize * 0.5, uFocal));
  return texture(uSky, skyUv(degrees(asin(clamp(dir.z, -1.0, 1.0))), degrees(atan(dir.x, dir.y)))).g;
}
void main() {
  vec4 open = openAt(gl_FragCoord.xy);
  if (uFlat == 1) {
    float shade = 0.55 * open.z * mayDraw(gl_FragCoord.xy);
    colour = vec4(vec3(0.3, 0.62, 1.0) * shade, shade);
    return;
  }
  // Each pixel by the Sun as its own part of the sky has it: so at dusk the west is lighter than the east, and the sky
  // low down lighter than overhead.
  float sun = sunHere(open.y, open.w);
  float skyIn = cameIn(sun, uDusk.xy);
  float restIn = cameIn(sun, uDusk.zw);
  vec3 strengths = strengthsAt((gl_FragCoord.xy - uSize * 0.5) / uFocal) * vec3(skyIn, restIn, restIn);
  float solid = strengthAt(open.y, open.x, strengths) * mayDraw(gl_FragCoord.xy);
  // Open sky is covered with the night's colour: the day's sky is gone. What isn't open sky is darkened instead, its own
  // light cut and only a share of the night's colour laid on it (uTint): mixed with the colour in full, a building's
  // shadows are lifted as its lights are lowered, and it looks faded out, not dark. (Through a porthole it's the sky
  // behind that's being shown, and the colour is there in full again.)
  float above = smoothstep(-uHorizonSoft, uHorizonSoft, open.y);
  float rest = mix(strengths.z, strengths.y, above);
  float sky = open.x * smoothstep(-1.0, 0.0, open.y);
  float tint = mix(uTint, 1.0, mix(portholeBelow, portholeClose, above));
  float coloured = (rest * (1.0 - sky) * tint + strengths.x * sky) / max(rest * (1.0 - sky) + strengths.x * sky, 1e-4);
  // And the glow itself, low down on the Sun's side while it's not far under the horizon: a little warmth in the colour.
  float toward = max(cos(radians(open.w - uSun.y)), 0.0);
  float low = 1.0 - smoothstep(0.0, 35.0, open.y);
  float warm = toward * toward * toward * low * low * smoothstep(-10.0, -4.0, sun) * (1.0 - smoothstep(-1.0, 2.0, sun)) * clamp(uSun.z / 5.0, 0.0, 1.0);
  // (The colour runs ahead of the Sun by some degrees: laid thinly over a day's sky, the day's own blue darkens nothing,
  // and the view at sunset would still be as bright as noon.)
  colour = vec4(mix(skyColour(sun - ${COLOUR_AHEAD_DEG.toFixed(1)}), vec3(0.93, 0.56, 0.4), 0.4 * warm) * solid * coloured, solid);
  // The sky map's edge is marked, there once the night's sky is, above the horizon: a thin line of light with a soft glow
  // either side, at any zoom, and stronger as the view is zoomed in (uEdge.x at its widest to uEdge.y, by uEdge.z). It's
  // what softens the edge: the sky itself comes all but straight up to it (the fade is a few pixels now). The line is
  // placed by the level, which is exact at the edge and good for a pixel or two either side; its glow reaches further,
  // and goes by the depth (by the level it came out in blocks the size of the sky map's cells).
  float shown = skyIn * smoothstep(-1.0, 0.5, open.y) * mayDraw(gl_FragCoord.xy);
  float near = edgeAway / uEdge.w;
  float away = abs(edgeDeep / uEdge.w);
  // (The line only where the depth agrees the edge is near. The level by itself also comes close to nothing at a cell of
  // sky that was only just scored as sky, in the middle of open sky: no edge, but it drew as a little cross of line there.)
  float atEdge = 1.0 - smoothstep(0.4, 0.75, abs(edgeCells));
  // (And the glow is gone by as far as the depth tells of, a couple of degrees: beyond that every pixel reads as "that far",
  // and a wide glow would lie faintly over the whole view, stronger towards its stretched edges, like a lens flare.)
  float reach = 1.0 - smoothstep(1.2, 2.2, abs(edgeCells * uGrid.z));
  // The line itself: a band uEdgeThick pixels across, its two sides a pixel and a half soft. A thin one is placed by the
  // level, which is exact; a thick one by the depth, like the glow (by the level it would come out in blocks the size of
  // the sky map's cells, and be cut off where the depth says the edge is no longer near).
  float out2 = 0.5 * uEdgeThick;
  float thin = (1.0 - smoothstep(max(out2 - 0.75, 0.0), out2 + 0.75, abs(near))) * atEdge;
  // A thick one is smoother as well as wider, or it would trace every kink of the edge at its full width: it runs where
  // the depth, taken as the mean over a ring half its thickness out, passes nothing (which rounds a corner off and steps
  // over a notch smaller than itself), and its sides are softer the thicker it is.
  float byDepth = smoothstep(2.0, 3.5, uEdgeThick);
  float along = away;
  if (byDepth > 0.0) {
    float sum = edgeCells * uGrid.z;
    for (int i = 0; i < 8; i++) {
      float turn = float(i) * 0.7853982;
      sum += depthAt(gl_FragCoord.xy + out2 * uEdge.w * vec2(cos(turn), sin(turn)));
    }
    along = abs(sum / 9.0 * edgePxPerDeg) / uEdge.w;
  }
  float soft = max(0.75, 0.25 * uEdgeThick);
  float thick = 1.0 - smoothstep(max(out2 - soft, 0.0), out2 + soft, along);
  float core = mix(thin, thick, byDepth);
  float line = mix(uEdge.x, uEdge.y, uEdge.z) * (core + 0.38 * exp(-away / max(uEdgeLine.w, 0.05)) * reach) * shown;
  colour += vec4(uEdgeLine.rgb * line, 0.35 * line);
}
`;

const STARS_VERTEX = `${SHARED}${VERTEX_SHARED}
in vec3 aStar;
in float aMagnitude;
in float aColour;
uniform vec3 uFaintest;
uniform float uScale;
uniform float uFadeDeg;
uniform float uFadeStartDeg;
out vec4 vColour;
out float vRadius;
void main() {
  vec2 where;
  vec3 cam = transpose(uView) * seen(aStar, where);
  // The faintest star that shows where this one is: by how dark that part of the sky is (uFaintest.x, with the Sun as it
  // is; .z magnitudes fainter for each degree lower the Sun is taken to be there), and no fainter than the view's own
  // limit (.y). So at dusk the stars come out in the east first.
  float faintest = min(uFaintest.x - uFaintest.z * (sunHere(where.x, where.y) - uSun.x), uFaintest.y);
  // Stars come out one by one as the faintest shown gets fainter: each over a magnitude's worth.
  float shown = smoothstep(faintest + 0.4, faintest - 0.6, aMagnitude);
  if (shown <= 0.0 || cam.z < 0.02) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }
  vec2 fromMiddle = cam.xy / cam.z;
  gl_Position = vec4(fromMiddle * uFocal / (uSize * 0.5), 0.0, 1.0);
  // Each star reads the sky map where it is, once: full strength in open sky, fainter over a building.
  vec2 cell = textureLod(uSky, skyUv(where.x, where.y), 0.0).rg;
  float deep = cell.r > 0.0 || uFadeStartDeg < 0.0 ? clamp((cell.g - uFadeStartDeg) / uFadeDeg, 0.0, 1.0) : 0.0;
  float strength = strengthAt(where.x, mix(deep, deep * deep * (3.0 - 2.0 * deep), 0.35), strengthsAt(fromMiddle));
  // Brighter is bigger, and more solid.
  vRadius = uScale * (0.85 + 0.52 * max(0.0, 5.2 - aMagnitude));
  float solid = (0.5 + 0.5 * clamp((4.5 - aMagnitude) / 4.0, 0.0, 1.0)) * shown * strength;
  // Its colour, from blue-white through white to orange (by B−V), kept pale.
  float warm = clamp((aColour + 0.3) / 1.9, 0.0, 1.0);
  vec3 tint = warm < 0.37 ? mix(vec3(0.66, 0.78, 1.0), vec3(1.0), warm / 0.37) : mix(vec3(1.0), vec3(1.0, 0.72, 0.48), (warm - 0.37) / 0.63);
  vColour = vec4(tint, solid);
  gl_PointSize = 2.0 * vRadius + 3.0;
}
`;

const STARS_FRAGMENT = `${SHARED}${FRAGMENT_SHARED}
in vec4 vColour;
in float vRadius;
out vec4 colour;
void main() {
  float away = length(gl_PointCoord - 0.5) * (2.0 * vRadius + 3.0);
  float solid = vColour.a * min(1.0, 1.25 * exp(-1.7 * away * away / (vRadius * vRadius))) * mayDraw(gl_FragCoord.xy);
  colour = vec4(vColour.rgb * solid, solid);
}
`;

const LINES_VERTEX = `${SHARED}${VERTEX_SHARED}
in vec3 aFrom;
in vec3 aTo;
in vec2 aCorner;
in float aBrightest;
uniform float uWidth;
uniform float uGap;
out float vAcross;
flat out float vBrightest;
void main() {
  vBrightest = aBrightest;
  vec2 where;
  vec3 a = transpose(uView) * seen(aFrom, where);
  vec3 b = transpose(uView) * seen(aTo, where);
  vec2 from = a.xy * uFocal / a.z;
  vec2 along = b.xy * uFocal / b.z - from;
  float length2 = length(along);
  if (a.z < 0.05 || b.z < 0.05 || length2 < 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 dir = along / length2;
  // (Each line stops a little short of its stars, as on a printed chart.)
  float gap = min(uGap, length2 * 0.25);
  vAcross = aCorner.y * (uWidth * 0.5 + 1.0);
  vec2 at = from + dir * mix(gap, length2 - gap, aCorner.x) + vec2(-dir.y, dir.x) * vAcross;
  gl_Position = vec4(at / (uSize * 0.5), 0.0, 1.0);
}
`;

const LINES_FRAGMENT = `${SHARED}${FRAGMENT_SHARED}
in float vAcross;
flat in float vBrightest;
uniform float uWidth;
uniform float uSolid;
uniform vec3 uFaintest;
out vec4 colour;
void main() {
  vec4 open = openAt(gl_FragCoord.xy);
  // The lines come out with the middling stars, where each part of them is (see the stars' own shader).
  float faintest = min(uFaintest.x - uFaintest.z * (sunHere(open.y, open.w) - uSun.x), uFaintest.y);
  float out2 = clamp((faintest - 1.5) / 2.5, 0.0, 1.0);
  // (And a figure is drawn only as far as its brightest star is showing, as a star is: with none of its stars out, as
  // under a city's sky, its lines would join nothing.)
  out2 *= smoothstep(faintest + 0.4, faintest - 0.6, vBrightest);
  float solid = uSolid * out2 * strengthAt(open.y, open.x, strengthsAt((gl_FragCoord.xy - uSize * 0.5) / uFocal)) * smoothstep(uWidth * 0.5 + 1.0, uWidth * 0.5, abs(vAcross)) * mayDraw(gl_FragCoord.xy);
  colour = vec4(vec3(0.62, 0.72, 0.96) * solid, solid);
}
`;

interface Program {
  program: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
}

function build(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`The chart's shader didn't compile: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`The chart's shaders didn't link: ${gl.getProgramInfoLog(program)}`);
  const found = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniform(name) {
      if (!found.has(name)) found.set(name, gl.getUniformLocation(program, name));
      return found.get(name)!;
    },
  };
}

export class SkyChart {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private readonly pano: HTMLElement;
  private readonly look: ChartLook;
  private readonly gentle: boolean;
  private sky: ChartSky | null = null;
  private ease: EasedSky | null = null;
  private catalogue: Catalogue | null = null;
  /** The sky map as last taken up: which version of it, of which start; and whether a place has been arrived at whose sky hasn't been poured yet. */
  private version = -1;
  private epoch = -1;
  private arriving = false;
  private pourWhole = false;
  /** The programs and what they draw with: made by `prepare`, and again if the graphics card forgets them. */
  private backdrop!: Program;
  private stars!: Program;
  private lines!: Program;
  private skyTexture!: WebGLTexture;
  private corners!: WebGLVertexArrayObject;
  private starsArray: WebGLVertexArrayObject | null = null;
  private linesArray: WebGLVertexArrayObject | null = null;
  private lineCount = 0;
  private textureFor: EasedSky | null = null;
/** What's kept clear: a picture of Google's logo, notices and controls where they are, as a texture; what it was last made of; and when that was last looked at. */
  private maskTexture!: WebGLTexture;
  private readonly mask = document.createElement('canvas');
  private maskOf = '';
  private clearAt = -Infinity;
  private lastFrame = 0;
  private late = 0;
  /** How far the porthole is open, 0 to 1 (see ChartLook.lookedBelow), and when it was last moved on. */
  private porthole = 0;
  private portholeAt = 0;
  /** The strengths through the porthole for the view as it is: the backdrop's and the stars' (their own, or nearer 1 as the view is zoomed in). */
  private portholeStrengths: [backdrop: number, stars: number] = [0, 0];
  /** How far the view is zoomed in for a close look, 0 to 1 (CLOSE_FROM to CLOSE_BY): what brings on the backdrop's own strength over buildings, through their porthole. */
  private zoomedIn = 0;
  /** And how far it's zoomed in for the stars over buildings, 0 to 1 (STARS_CLOSE_FROM to STARS_CLOSE_BY): what takes them up to full strength there. */
  private zoomedALittle = 0;
  /** And how far the constellations' lines have come in over buildings, 0 (the view at its widest: none) to 1. */
  private linesIn = 0;

  /** The chart, with its canvas put first inside `container` (under the paths); null where the browser can't draw it. */
  static create(container: HTMLElement, pano: HTMLElement, look: ChartLook = CHART_LOOK): SkyChart | null {
    const canvas = document.createElement('canvas');
    canvas.className = 'overlay-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    // (Not through the canvas's own getContext: the sky map has that keep every canvas's drawing, which this one has no use for.)
    const gl = plainContext(canvas, 'webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) return null;
    try {
      const chart = new SkyChart(canvas, gl as WebGL2RenderingContext, pano, look);
      container.prepend(canvas);
      return chart;
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, pano: HTMLElement, look: ChartLook) {
    this.canvas = canvas;
    this.gl = gl;
    this.pano = pano;
    this.look = look;
    this.gentle = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.prepare();
    canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => this.prepare());
  }

  private prepare(): void {
    const gl = this.gl;
    this.backdrop = build(gl, BACKDROP_VERTEX, BACKDROP_FRAGMENT);
    this.stars = build(gl, STARS_VERTEX, STARS_FRAGMENT);
    this.lines = build(gl, LINES_VERTEX, LINES_FRAGMENT);
    // One triangle over the whole view.
    this.corners = gl.createVertexArray()!;
    gl.bindVertexArray(this.corners);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(gl.getAttribLocation(this.backdrop.program, 'aCorner'), 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.getAttribLocation(this.backdrop.program, 'aCorner'));
    // The sky map's cells, as a picture a row wide and a direction high: it joins up round the compass, and stops at the top and bottom rows.
    this.skyTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.skyTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.textureFor = null;
    this.maskTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    // (A pixel of it to a pixel of the canvas: nothing to blend.)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.maskOf = '';
    this.clearAt = -Infinity;
    this.starsArray = this.linesArray = null;
    if (this.catalogue) this.setCatalogue(this.catalogue);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** The sky map to draw by; null for none (everything above the horizon is then drawn as a building is). */
  setSky(sky: ChartSky | null): void {
    this.sky = sky;
    this.ease = sky ? new EasedSky(sky.bins, sky.rows, sky.step, ALT_TOP, this.gentle) : null;
    this.version = this.epoch = -1;
  }

  /** The stars and the constellations' lines to draw. */
  setCatalogue(catalogue: Catalogue): void {
    this.catalogue = catalogue;
    const gl = this.gl;
    const attribute = (program: Program, name: string, data: Float32Array, size: number, stride: number, offset: number, each: boolean, buffer?: WebGLBuffer) => {
      const made = buffer ?? gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, made);
      if (!buffer) gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const at = gl.getAttribLocation(program.program, name);
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(at, each ? 1 : 0);
      return made;
    };
    this.starsArray = gl.createVertexArray()!;
    gl.bindVertexArray(this.starsArray);
    attribute(this.stars, 'aStar', catalogue.vectors, 3, 0, 0, false);
    attribute(this.stars, 'aMagnitude', catalogue.magnitudes, 1, 0, 0, false);
    attribute(this.stars, 'aColour', catalogue.colours, 1, 0, 0, false);
    // Each line is a thin four-cornered strip between its two stars, laid out on screen by the shader.
    this.linesArray = gl.createVertexArray()!;
    gl.bindVertexArray(this.linesArray);
    attribute(this.lines, 'aCorner', new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2, 0, 0, false);
    const ends = attribute(this.lines, 'aFrom', catalogue.lines, 3, 24, 0, true);
    attribute(this.lines, 'aTo', catalogue.lines, 3, 24, 12, true, ends);
    attribute(this.lines, 'aBrightest', catalogue.lineBrightest, 1, 0, 0, true);
    this.lineCount = catalogue.lines.length / 6;
    gl.bindVertexArray(null);
  }

  /**
   * Keeps the picture of what's to be kept clear up to date: Google's logo,
   * its notices and its controls, wherever the viewer has them now, each in
   * its own shape. The logo is its lettering and the compass its disc (both
   * are drawings, and are drawn into the mask as they are); the zoom
   * buttons and the notices are boxes with a background, and are filled in
   * with their own rounded corners. So the chart stops exactly at each, with
   * no margin and nothing faded.
   */
  private measureClear(now: number, scale: number): void {
    if (now - this.clearAt < CLEAR_EVERY_MS) return;
    this.clearAt = now;
    const frame = this.canvas.getBoundingClientRect();
    const shapes: { image: HTMLImageElement | null; box: DOMRect; radius: number }[] = [];
    let made = `${this.canvas.width}x${this.canvas.height}`;
    const take = (el: Element, depth: number) => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      const box = el.getBoundingClientRect();
      const sized = box.width >= 2 && box.height >= 2 && box.width <= frame.width * CLEAR_MOST_SHARE && box.height <= frame.height * CLEAR_MOST_SHARE;
      if (sized && el instanceof HTMLImageElement) {
        // (The compass's needle turns with the view, inside its disc: the disc covers it.)
        if (el.complete && el.naturalWidth > 0 && !el.closest('.gm-compass-needle')) {
          shapes.push({ image: el, box, radius: 0 });
          made += `|i${box.left - frame.left},${box.top - frame.top},${box.width},${box.height},${el.src.length}`;
        }
        return;
      }
      if (sized) {
        const solid = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)?.[1].split(',').map(Number);
        if (solid && (solid.length < 4 || solid[3] >= CLEAR_SOLID_FROM)) {
          shapes.push({ image: null, box, radius: parseFloat(style.borderTopLeftRadius) || 0 });
          made += `|b${box.left - frame.left},${box.top - frame.top},${box.width},${box.height}`;
          return;
        }
      }
      if (depth < 8) for (const child of el.children) take(child, depth + 1);
    };
    // (The logo is a link to Google Maps; the notices and the controls each carry one of these classes.)
    for (const el of this.pano.querySelectorAll('a[href*="google.com/maps"], .gm-style-cc, .gmnoprint')) {
      if (!el.parentElement?.closest('.gm-style-cc, .gmnoprint')) take(el, 0);
    }
    if (made === this.maskOf) return;
    this.maskOf = made;
    const { gl, mask } = this;
    mask.width = this.canvas.width;
    mask.height = this.canvas.height;
    const ctx = mask.getContext('2d')!;
    const paint = (asBoxes: boolean) => {
      ctx.setTransform(scale, 0, 0, scale, -frame.left * scale, -frame.top * scale);
      ctx.clearRect(frame.left, frame.top, frame.width, frame.height);
      ctx.fillStyle = '#fff';
      for (const { image, box, radius } of shapes) {
        if (image && !asBoxes) {
          // A drawing (an SVG) keeps its own shape inside its box, in the middle of it, as the page shows it; a canvas
          // would stretch it to the box. (The logo is drawn 69 by 29 in a box 66 by 26: stretched, its letters come out
          // up to two pixels from where they are.) A photograph fills its box either way.
          const drawn = /^data:image\/svg|\.svg(\?|$)/.test(image.src);
          const fit = drawn ? Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight) : 0;
          const width = drawn ? image.naturalWidth * fit : box.width;
          const height = drawn ? image.naturalHeight * fit : box.height;
          ctx.drawImage(image, box.left + (box.width - width) / 2, box.top + (box.height - height) / 2, width, height);
        } else {
          ctx.beginPath();
          ctx.roundRect(box.left, box.top, box.width, box.height, radius);
          ctx.fill();
        }
      }
    };
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    try {
      paint(false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    } catch {
      // A drawing the browser won't let a page read back (it isn't one of the page's own): its box is kept clear instead.
      mask.width = mask.width;
      paint(true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Brings what's shown of the sky map up to this frame's time. Returns whether it's still moving. */
  private follow(now: number): boolean {
    const { sky, ease } = this;
    if (!sky || !ease) return false;
    if (sky.epoch !== this.epoch) {
      // Another place, or everything forgotten: what's drawn of the old sky draws back, and the new is held until its picture is there.
      this.epoch = sky.epoch;
      this.arriving = this.pourWhole = true;
      ease.retarget(null, null, now, { pour: false, fromAbove: false, most: 0 });
    }
    if (this.arriving && sky.pictureHere) {
      this.arriving = false;
      this.version = -1;
    }
    if (!this.arriving && sky.version !== this.version) {
      const first = this.version === -1;
      this.version = sky.version;
      // A place's sky is poured from overhead, at the pour's own pace (quicker where it was kept and is there at once);
      // what's found after that is never far behind the looks that found it.
      const most = this.pourWhole ? (first ? POUR_MOST_MS / 2 : POUR_MOST_MS) : POUR_HURRIED_MS;
      if (ease.retarget(sky.level, sky.depth(), now, { pour: true, fromAbove: true, most }) > 0) this.pourWhole = false;
    }
    // A device that isn't keeping up loses the motion first: jumpy is better than slow.
    const gone = now - this.lastFrame;
    this.lastFrame = now;
    this.late = ease.busy && gone > LATE_MS && gone < 1000 ? this.late + 1 : 0;
    if (this.late >= LATE_RUN) ease.settle();
    ease.advance(now);
    return ease.busy || this.arriving;
  }

  /** Sends the cells that have changed to the graphics card. */
  private upload(): void {
    const { gl, ease } = this;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.skyTexture);
    if (!ease) {
      if (this.textureFor) return;
      // No sky map: one cell that isn't sky, for everywhere.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, 1, 1, 0, gl.RG, gl.FLOAT, new Float32Array([-1, -2.5]));
      return;
    }
    if (this.textureFor !== ease) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, ease.rows, ease.bins, 0, gl.RG, gl.FLOAT, ease.shown);
      this.textureFor = ease;
      ease.taken();
    } else if (ease.changed) {
      const [from, to] = ease.changed;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, from, ease.rows, to - from + 1, gl.RG, gl.FLOAT, ease.shown.subarray(from * ease.rows * 2, (to + 1) * ease.rows * 2));
      ease.taken();
    }
  }

  /**
   * The porthole just now, for what's drawn outside this canvas to go by too
   * (the names): the stars' strength through it, for the view as last
   * drawn; how far it's open, 0 to 1; and its size, as the tangents of the
   * angles from the view's middle within which it's at full strength and
   * beyond which there's none of it. And how far the view is zoomed in a
   * little, 0 to 1: through a tighter porthole (its own two tangents), that
   * takes the stars over buildings up to full strength. And how far the
   * constellations' lines have come in over buildings, 0 to 1, which their
   * names there go by.
   */
  get lookingBelow(): { strength: number; open: number; full: number; none: number; zoomed: number; zoomedFull: number; zoomedNone: number; lines: number } {
    return {
      lines: this.linesIn,
      strength: this.portholeStrengths[1],
      open: this.porthole,
      full: PORTHOLE_FULL_TAN,
      none: PORTHOLE_NONE_TAN,
      zoomed: this.zoomedALittle,
      zoomedFull: this.closeTangents()[0],
      zoomedNone: this.closeTangents()[1],
    };
  }

  /**
   * The stars' three strengths for the view as last drawn (the names go by
   * them too). Over buildings they're faint in a view at its widest
   * (ChartLook.stars) and come up all across the view as it's zoomed in, as
   * the lines do and as soon, to ChartLook.starsZoomed; the buildings'
   * porthole takes them on from there to full strength.
   */
  get starStrengths(): [open: number, other: number, below: number] {
    const { stars, starsZoomed } = this.look;
    return [stars[0], stars[1] + (Math.max(starsZoomed, stars[1]) - stars[1]) * this.linesIn, stars[2]];
  }

  /** The buildings' porthole (ChartLook.closePorthole) as tangents, the outer one kept a little past the inner. */
  private closeTangents(): [full: number, none: number] {
    const [full, none] = this.look.closePorthole;
    return [Math.tan(full * RAD), Math.tan(Math.max(none, full + 0.5) * RAD)];
  }

  /** Draws the chart for this frame. Returns whether it wants another (something is still easing). */
  draw(frame: ChartFrame): boolean {
    const { gl, look } = this;
    const { cam } = frame;
    let moving = this.follow(frame.now);
    // The porthole opens as far as the view is turned down under the horizon, and gets there quickly, not at once.
    const wanted = Math.max(0, Math.min(1, (-cam.pitch - PORTHOLE_FROM_DEG) / (PORTHOLE_OPEN_BY_DEG - PORTHOLE_FROM_DEG)));
    const since = Math.max(0, Math.min(100, frame.now - this.portholeAt));
    this.portholeAt = frame.now;
    this.porthole += (wanted - this.porthole) * (this.gentle ? 1 : 1 - Math.exp(-since / (PORTHOLE_MS / 3)));
    if (Math.abs(wanted - this.porthole) < 0.004) this.porthole = wanted;
    else moving = true;
    // Through it, the strengths are their own in a view zoomed right out, and go up to 1 as it's zoomed in a little.
    // ("Zoomed in" is against the widest this view goes, not a width in degrees: a tall, narrow view, a phone's, is never
    // more than 60° across, and would count as zoomed in always. Street View's widest is zoom 0, or 90° top to bottom
    // if that's narrower: projection.ts.)
    const widest = Math.max(cam.width / 4, cam.height / 2);
    const zoom = cam.width / 2 / Math.tan((cam.hfov / 2) * RAD) / widest;
    const closer = Math.max(0, Math.min(1, (zoom - ZOOMED_FROM) / (ZOOMED_BY - ZOOMED_FROM)));
    const all = closer * closer * (3 - 2 * closer);
    // (Over buildings, by how many doublings in the view has come: the same step for each, eased at the two ends.)
    const doublings = (from: number, by: number) => {
      const share = Math.max(0, Math.min(1, Math.log(zoom / from) / Math.log(by / from)));
      return share * share * (3 - 2 * share);
    };
    this.zoomedALittle = doublings(STARS_CLOSE_FROM, STARS_CLOSE_BY);
    const linesIn = doublings(LINES_CLOSE_FROM, LINES_CLOSE_BY);
    this.linesIn = linesIn;
    this.zoomedIn = doublings(CLOSE_FROM, CLOSE_BY);
    this.portholeStrengths = [look.lookedBelow[0] + (1 - look.lookedBelow[0]) * all, look.lookedBelow[1] + (1 - look.lookedBelow[1]) * all];
    if (gl.isContextLost()) return moving;
    const scale = Math.min(window.devicePixelRatio || 1, SCALE_MOST);
    const width = Math.max(1, Math.round(cam.width * scale));
    const height = Math.max(1, Math.round(cam.height * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // By day there's nothing to draw: the sky in the picture is the day's own. (The flat shade is for looking at the weight, whatever the hour.)
    // How many degrees the Sun's side of the sky differs by: all of the setting through twilight, and none deep in the night.
    const fading = Math.max(0, Math.min(1, (frame.sunAlt + 18) / 6));
    const glow = look.sunGlow * fading * fading * (3 - 2 * fading);
    // (The darkest any part of the sky is taken to be: low down, away from the Sun. See the shader's sunHere.)
    const darkest = frame.sunAlt - 0.85 * glow;
    const faintestAnywhere = Math.min(frame.faintestDark + FAINTER_PER_DEG * 0.85 * glow, frame.faintestMost);
    if (look.off || (Math.max(duskShare(darkest, look.duskSky), duskShare(darkest, look.duskRest)) <= 0.002 && faintestAnywhere <= -1.6 && !look.flat)) return moving;
    this.upload();
    this.measureClear(frame.now, scale);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.activeTexture(gl.TEXTURE0);

    const focal = (cam.width / 2 / Math.tan((cam.hfov / 2) * RAD)) * scale;
    const sh = Math.sin(cam.heading * RAD);
    const ch = Math.cos(cam.heading * RAD);
    const sp = Math.sin(cam.pitch * RAD);
    const cp = Math.cos(cam.pitch * RAD);
    // The camera's right, up and forward, in the frame the sky is in (x east, y north, z up): projection.ts.
    const view = [ch, -sh, 0, -sp * sh, -sp * ch, cp, cp * sh, cp * ch, sp];
    const sky = this.ease;
    const closeTan = this.closeTangents();
    const use = (program: Program, strength: [number, number, number], lookedBelow: number, lookedClose: number, closeBy: number) => {
      gl.useProgram(program.program);
      gl.uniform2f(program.uniform('uSize'), width, height);
      gl.uniform1f(program.uniform('uFocal'), focal);
      gl.uniformMatrix3fv(program.uniform('uView'), false, view);
      gl.uniform1i(program.uniform('uSky'), 0);
      gl.uniform4f(program.uniform('uGrid'), sky ? sky.rows : 1, sky ? sky.bins : 1, sky ? sky.step : 1, ALT_TOP);
      gl.uniform1f(program.uniform('uHorizonSoft'), look.horizonSoft);
      gl.uniform3f(program.uniform('uStrength'), strength[0], strength[1], strength[2]);
      gl.uniform2f(program.uniform('uLookedBelow'), lookedBelow, this.porthole);
      gl.uniform2f(program.uniform('uLookedClose'), lookedClose, closeBy);
      gl.uniform2f(program.uniform('uClosePorthole'), closeTan[0], closeTan[1]);
      gl.uniform1f(program.uniform('uFade'), look.fadePx * scale);
      gl.uniform1f(program.uniform('uFadeEnd'), look.fadeInsidePx * scale);
      gl.uniform1i(program.uniform('uMask'), 1);
      gl.uniform3f(program.uniform('uSun'), frame.sunAlt, frame.sunAz, glow);
      gl.uniform3f(program.uniform('uFaintest'), frame.faintestDark, frame.faintestMost, FAINTER_PER_DEG);
      if (frame.rotation) gl.uniformMatrix3fv(program.uniform('uSkyRot'), false, frame.rotation);
    };

    // The backdrop: its three strengths, each as far in as the hour has it where the pixel is (the open sky by its own pair of
    // altitudes, the rest by theirs), in the sky's colour for that hour there.
    use(this.backdrop, look.backdrop, this.portholeStrengths[0], look.lookedClose, this.zoomedIn);
    gl.uniform4f(this.backdrop.uniform('uDusk'), look.duskSky[0], look.duskSky[1], look.duskRest[0], look.duskRest[1]);
    gl.uniform1fv(this.backdrop.uniform('uStopAlt[0]'), SKY_STOPS.map(([alt]) => alt));
    gl.uniform3fv(this.backdrop.uniform('uStopColour[0]'), SKY_STOPS.flatMap(([, colour]) => colour.map((part) => part / 255)));
    gl.uniform1i(this.backdrop.uniform('uFlat'), look.flat ? 1 : 0);
    gl.uniform1f(this.backdrop.uniform('uTint'), look.restTint);
    gl.uniform1f(this.backdrop.uniform('uEdgeThick'), look.edgeLine);
    gl.uniform4f(this.backdrop.uniform('uEdge'), look.edgeGlow[0], look.edgeGlow[1], this.zoomedALittle, scale);
    gl.uniform4f(this.backdrop.uniform('uEdgeLine'), look.edgeColour[0], look.edgeColour[1], look.edgeColour[2], look.edgeWidth);
    gl.bindVertexArray(this.corners);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (look.flat || !frame.rotation || !this.catalogue) return moving;

    // The lines come out with the middling stars, and the stars one by one as it darkens: each where it is in the sky.
    if (this.linesArray && look.lines > 0.004 && faintestAnywhere > 1.5) {
      // (Over buildings the stars and lines go up to full strength through the porthole as the view is zoomed in a little,
      // as those below the horizon do.)
      // But in a view at its widest the lines over buildings are only as strong as the stars there, which is not at all:
      // from that they come up with the zoom.
      use(this.lines, look.stars, this.portholeStrengths[1], 1, linesIn);
      // (All across the view, not through the buildings' small porthole: once zoomed in, the figures are whole behind the buildings.)
      gl.uniform2f(this.lines.uniform('uClosePorthole'), 1e3, 2e3);
      gl.uniform1f(this.lines.uniform('uWidth'), 1.1 * scale);
      gl.uniform1f(this.lines.uniform('uGap'), 7 * scale);
      gl.uniform1f(this.lines.uniform('uSolid'), look.lines);
      gl.bindVertexArray(this.linesArray);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.lineCount);
    }
    if (this.starsArray && faintestAnywhere > -1.6) {
      use(this.stars, this.starStrengths, this.portholeStrengths[1], 1, this.zoomedALittle);
      // (A little bigger as the view closes in.)
      gl.uniform1f(this.stars.uniform('uScale'), scale * (1 + 0.18 * Math.max(0, Math.log2(90 / cam.hfov))));
      // (The fade as the backdrop has it, at the scale of the view's middle.)
      const pxPerDeg = (focal / scale) * RAD;
      const fadeEnd = Math.min(look.fadeInsidePx / pxPerDeg, 2.3);
      const fadeStart = Math.max(fadeEnd - look.fadePx / pxPerDeg, -2.3);
      gl.uniform1f(this.stars.uniform('uFadeDeg'), Math.max(fadeEnd - fadeStart, 1e-4));
      gl.uniform1f(this.stars.uniform('uFadeStartDeg'), fadeStart);
      gl.bindVertexArray(this.starsArray);
      // (Brightest first in the catalogue: only as many as are bright enough are sent.)
      let count = this.catalogue.count;
      while (count > 0 && this.catalogue.magnitudes[count - 1] > faintestAnywhere + 0.4) count--;
      gl.drawArrays(gl.POINTS, 0, count);
    }
    gl.bindVertexArray(null);
    return moving;
  }

  /**
   * For checking the weight against the sky map: draws this frame as the
   * flat shade alone and reads it back, a number 0–255 for each of the
   * canvas's own pixels (rows from the bottom up), with the canvas's size.
   */
  readWeight(frame: ChartFrame): { width: number; height: number; shade: Uint8Array } {
    const { gl, look } = this;
    const flat = look.flat;
    look.flat = true;
    this.draw(frame);
    look.flat = flat;
    const { width, height } = this.canvas;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const shade = new Uint8Array(width * height);
    for (let i = 0; i < shade.length; i++) shade[i] = pixels[i * 4 + 3];
    return { width, height, shade };
  }
}
