# Data credits

Real roads (`src/routes/real/tracks/*.json`, `src/assets/terrain/*.bin`) are built by
`scripts/real-track/build.mjs` from:

- **Road lines (Vršič, Alpe d'Huez, the Stelvio from Prato, the D 974 up Mont Ventoux from Bédoin, the D 918 up the Tourmalet from Luz-Saint-Sauveur, the RI-2 and Carretera a L'Angliru from La Vega, the D 902 up the Galibier from Valloire, the SP 638 up Passo Giau from Selva di Cadore, Grad to Plaža on Krvavec), Lake Jasna, the Vršič parking lots, the Angliru summit parking, the meadows and woods along the Angliru, the Galibier summit parking and the Passo Giau parking:** © OpenStreetMap contributors,
  available under the Open Database License (ODbL). The track files are derived
  databases and are shared under the same licence. Raw extracts are in `data/osm/`.
- **Land cover** (`src/assets/terrain/*.cover.bin`, built by `scripts/real-track/cover.mjs`):
  forests, meadows, scrub, rock, scree, cliffs, glaciers, water and built-up areas from
  © OpenStreetMap contributors (ODbL, as above; derived data under the same licence), with
  the gaps filled from **ESA WorldCover 10 m 2021 v200**: © ESA WorldCover project 2021 /
  Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.
  Licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). The classes are
  remapped and resampled to the game's 25 m and 100 m grids (see `docs/REAL_ROADS.md`, "Land cover").
- **Landmarks beside the real roads** (`src/routes/real/landmarks.json`, built by
  `scripts/real-track/landmarks.mjs`; Overpass answers in `data/osm/landmarks-<id>.json`):
  the Russian Chapel, mountain huts and refuges, wayside shrines and crosses on Vršič,
  the Galibier, the Stelvio and Passo Giau. © OpenStreetMap contributors, ODbL.
- **Terrain:** Terrain Tiles on AWS Open Data (Mapzen/Tilezen). Sources include SRTM
  (NASA, public domain) and EU-DEM, produced using Copernicus data and information
  funded by the European Union.
- **Road profiles (gradients):** the published climb profiles listed in
  `data/real-climbs.research.json` for each climb.

If the app goes public, show "© OpenStreetMap contributors", the terrain credit and
"© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021)" in the
game's credits or on the ride screen of a real road.
