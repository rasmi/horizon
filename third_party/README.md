# Third-party work

What Clear Skies ships that isn't its own, and so isn't under its own license
([MIT](../LICENSE)). The same list is at the bottom of the app's About
panel.

## In this folder

Loaded by the app as they are. Each folder's `README.md` says whose work
it is, what was changed, and on what terms. The model's folder has its
license's text as `LICENSE`; the catalogues' README links to theirs; the
light pollution atlas states none.

| Folder | What | From | License |
|---|---|---|---|
| `star-catalogues/` | `stars-data.json`: the stars, the constellations' figures, and Messier, NGC and IC objects | The HYG database (David Nash); ConstellationLines (Marc van der Sluys); OpenNGC (Mattia Verga) | CC BY-SA 4.0 (the sources: CC BY-SA 4.0, CC BY 4.0, CC BY-SA 4.0) |
| `light-pollution-atlas/` | `skyglow.webp`: how bright the night sky is, by place | Light Pollution Atlas 2025 (David J. Lorenz) | None stated: used with credit |
| `pp-mobileseg/` | The model that finds the sky in a picture | PP-MobileSeg (PaddleSeg; weights as published by MMSegmentation), trained on ADE20K | Apache 2.0 |

## Fetched when the app is built

Not kept here: installed from npm (`package.json`), and built into the
app or copied beside it.

| Package | What for | License |
|---|---|---|
| [astronomy-engine](https://github.com/cosinekitty/astronomy) | Where the Sun, the Moon, the planets and the stars are | MIT |
| [@litertjs/core](https://www.npmjs.com/package/@litertjs/core) (LiteRT.js, Google) | Runs the model; its WebAssembly files are copied to `litert/` | Apache 2.0 |
| [@googlemaps/js-api-loader](https://github.com/googlemaps/js-api-loader) | Loads Google Maps | Apache 2.0 |
| [geomagnetism](https://github.com/naturalatlas/geomagnetism) | Magnetic north to true north, for a phone's compass | Apache 2.0 |
| [tz-lookup](https://github.com/darkskyapp/tz-lookup-oss) | A place's time zone | CC0 1.0 |

The map and the Street View imagery are Google's, shown by Google's own
viewer under the Google Maps Platform terms; none of it is kept or
shipped.
