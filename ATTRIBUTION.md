# Data credits

Real roads (`src/routes/real/tracks/*.json`, `src/assets/terrain/*.bin`) are built by
`scripts/real-track/build.mjs` from:

- **Road lines (Vršič, Alpe d'Huez, the Stelvio from Prato, the D 974 up Mont Ventoux from Bédoin, the D 918 up the Tourmalet from Luz-Saint-Sauveur, the RI-2 and Carretera a L'Angliru from La Vega, the D 902 up the Galibier from Valloire, the SP 638 up Passo Giau from Selva di Cadore, Grad to Plaža on Krvavec, the SP 49 and Strada per il Rifugio Auronzo to Tre Cime di Lavaredo), Lake Jasna, the Vršič parking lots, the Angliru summit parking, the meadows and woods along the Angliru, the Galibier summit parking, the Passo Giau parking, and at Tre Cime Lago di Misurina, Lago d'Antorno, the parking and the land cover (woods, meadows, mugo pine, scree and bare rock):** © OpenStreetMap contributors,
  available under the Open Database License (ODbL). The track files are derived
  databases and are shared under the same licence. Raw extracts are in `data/osm/`.
- **Terrain:** Terrain Tiles on AWS Open Data (Mapzen/Tilezen). Sources include SRTM
  (NASA, public domain) and EU-DEM, produced using Copernicus data and information
  funded by the European Union.
- **Tre Cime di Lavaredo terrain and road profile:** Regione del Veneto – L.R. n. 28/76 –
  Formazione della Carta Tecnica Regionale. The DTM LIDAR 5 m from the Veneto geoportal
  (idt2.regione.veneto.it, Download → Modelli digitali), under the Italian Open Data License 2.0
  (IODL 2.0). The road height and the 10 m and 25 m grids around Misurina and the three towers
  come from it. The raw tiles are downloaded to `data/dem-cache/veneto-lidar5/` and not committed.
- **Road profiles (gradients):** the published climb profiles listed in
  `data/real-climbs.research.json` for each climb. Tre Cime is measured on the LiDAR road
  instead and checked against those published figures (`docs/REAL_ROADS.md`).

If the app goes public, show "© OpenStreetMap contributors" and the terrain credit in the
game's credits or on the ride screen of a real road. For Tre Cime the credit also names the
Regione del Veneto line above (it is in that track's `source`).
