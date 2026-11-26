# Data credits

Real roads (`src/routes/real/tracks/*.json`, `src/assets/terrain/*.bin`) are built by
`scripts/real-track/build.mjs` from:

- **Road lines (Vršič, Alpe d'Huez, the Stelvio from Prato, the D 974 up Mont Ventoux from Bédoin, the D 918 up the Tourmalet from Luz-Saint-Sauveur, the RI-2 and Carretera a L'Angliru from La Vega, the D 902 up the Galibier from Valloire, the SP 638 up Passo Giau from Selva di Cadore, the streets of Ponte di Legno and the SS 300 up the Passo di Gavia, Grad to Plaža on Krvavec), Lake Jasna, the Vršič parking lots, the Angliru summit parking, the meadows and woods along the Angliru, the Galibier summit parking, the Passo Giau parking, Lago Nero, Lago Bianco and the parking on the Passo di Gavia, and the land cover within 4 km of the Gavia road (woods, meadow, grassland, scrub, scree, bare rock, glaciers):** © OpenStreetMap contributors,
  available under the Open Database License (ODbL). The track files are derived
  databases and are shared under the same licence. Raw extracts are in `data/osm/`.
- **Terrain:** Terrain Tiles on AWS Open Data (Mapzen/Tilezen). Sources include SRTM
  (NASA, public domain) and EU-DEM, produced using Copernicus data and information
  funded by the European Union.
- **Road profiles (gradients):** the published climb profiles listed in
  `data/real-climbs.research.json` for each climb.

If the app goes public, show "© OpenStreetMap contributors" and the terrain credit in the
game's credits or on the ride screen of a real road.
