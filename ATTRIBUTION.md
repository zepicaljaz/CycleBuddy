# Data credits

Real roads (`src/routes/real/tracks/*.json`, `src/assets/terrain/*.bin`) are built by
`scripts/real-track/build.mjs` from:

- **Road lines (Vršič, Alpe d'Huez, the Stelvio from Prato, the D 974 up Mont Ventoux from Bédoin, the D 918 up the Tourmalet from Luz-Saint-Sauveur, the RI-2 and Carretera a L'Angliru from La Vega, the D 902 up the Galibier from Valloire, the SP 638 up Passo Giau from Selva di Cadore, Grad to Plaža on Krvavec, the D 213 up the Madeleine from La Chambre), Lake Jasna, the Vršič parking lots, the Angliru summit parking, the meadows and woods along the Angliru, the Galibier summit parking, the Passo Giau parking and the Madeleine summit parking:** © OpenStreetMap contributors,
  available under the Open Database License (ODbL). The track files are derived
  databases and are shared under the same licence. Raw extracts are in `data/osm/`.
- **Terrain:** Terrain Tiles on AWS Open Data (Mapzen/Tilezen). Sources include SRTM
  (NASA, public domain) and EU-DEM, produced using Copernicus data and information
  funded by the European Union.
- **Tree cover (Col de la Madeleine, `src/assets/terrain/*.cover.bin`):** © ESA WorldCover
  project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA
  WorldCover consortium. ESA WorldCover 10 m 2021 v200, CC BY 4.0
  (https://esa-worldcover.org). Read from the open GeoTIFFs on AWS by
  `scripts/real-track/worldcover.mjs`.
- **Road profiles (gradients):** the published climb profiles listed in
  `data/real-climbs.research.json` for each climb.

If the app goes public, show "© OpenStreetMap contributors", the terrain credit and, on the Madeleine,
the ESA WorldCover credit in the
game's credits or on the ride screen of a real road.
