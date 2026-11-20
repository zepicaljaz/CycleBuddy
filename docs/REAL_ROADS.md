# Real roads (1:1 climbs)

How Vršič was put into the game on its real road, why it was done this way, and how to
add the next one.

## What is real and what isn't

| Part | Source | Real? |
|---|---|---|
| Road line (every bend, all hairpins) | OpenStreetMap: Borovška cesta from the valley road, then road 206 | Yes |
| Ride start | Borovška cesta at the edge of Kranjska Gora, about 500 m before Lake Jasna | Yes |
| Gradient of the published climb | Published profile (27 pieces), from the Pišnica bridge to the pass | Yes |
| Profile start and summit | OSM bridge "Eriški most" (850 m) and OSM pass node 16521909 (1611 m) | Yes |
| Valley before the bridge | Terrain Tiles, smoothed. Not a published profile | Elevation only |
| Lake Jasna | OpenStreetMap way 36736687 | Yes |
| Parking | OpenStreetMap ways 704414695 (Ajdovska deklica viewpoint) and 704414681 (Erjavčeva koča) | Yes |
| Mountains around the road | Terrain Tiles (SRTM / Copernicus EU-DEM, ~30 m data) | Yes, in low-poly |
| Hairpin signs 1–24 | The 24 sharpest bends of the real line | Positions approximate |
| Forests, meadows, houses, Russian Chapel | Still generated | No (next step: OSM land use) |

## The pipeline

`node scripts/real-track/build.mjs vrsic` does everything offline. The game only reads the
results, so riding costs no more CPU or GPU than a generated road.

1. **Road line.** Reads `data/osm/vrsic-206.json` (road 206) and
   `data/osm/vrsic-kranjska-gora.json` (Borovška cesta from the valley road, fetched
   from the OpenStreetMap API). Joins the ways from that junction to just over the pass,
   then drops the streets through Kranjska Gora. The ride starts about 500 m before Lake Jasna.
   The north stub of road 206, past the junction, is not on the ride.
2. **Smoothing.** Resamples to 1 m, rounds OSM's polygon corners (Gaussian, σ 2.5 m),
   then widens only bends tighter than 7 m radius. More smoothing shortens every hairpin;
   7 m keeps the climb within 1.3 % of the published length (9.12 vs 9.24 km).
3. **Elevation of the road.** The published profile, not the terrain data. 30 m terrain
   data along a hairpin road is off by about 16 m on average and makes fake ramps. The
   run-in from town uses the terrain data, smoothed over 300 m. Grade steps between profile
   pieces are softened over ~30 m.
4. **Closing the lap.** Every route in the game is a loop, so the road turns in a balloon
   loop (60° in, 300° round, 60° out, radius 16 m; closes exactly) at the top and the
   bottom and comes back down the same line. Up and down share the asphalt.
5. **Terrain grids.** 25 m grid within 4 km of the road, 100 m grid out to 15 km (view
   distance is 6–15 km). Near the road the terrain is pulled onto the road's elevation
   (fades out by 600 m), so the road sits on a bench and not in a trench.
6. **Output.**
   - `src/routes/real/tracks/<id>.json`: points every 4 m on straights, denser in bends
     (no more than 4° between points), elevation, section per point (0 valley,
     1 published climb, 2 descent). Vršič also stores `places`: Lake Jasna and the
     two parking lots, projected with the same origin as the road
     (`data/osm/vrsic-places.json`).
   - `src/assets/terrain/<id>.bin`: both grids as unsigned 16-bit decimetres.

The script prints its checks: climb length vs published, start and summit elevation,
terrain error, loop closure and hairpin count.

## In the game

- `RouteDef.track` (`src/routes/types.ts`): when set, `Route` builds from the points
  instead of sections (`src/routes/route.ts`, `trackPath`). Grades come from the real
  elevation; hairpin flags from real bends.
- `realClimbRoute` (`src/routes/real/build.ts`) uses a track when one exists for the climb id.
- `loadRouteTerrain` (`src/routes/real/terrain.ts`) fetches the `.bin` before the world is
  built (`App.mountWorld`). Other routes never download it.
- `TerrainField.demAt` (`src/world/terrainField.ts`): real height inside the grids,
  blending to generated terrain at the edges. Road cuts face the side that is really higher.
- `findHairpins` (`src/world/climbs.ts`): with `track.hairpinCount`, keeps the N
  sharpest bends; `track.hairpins: 'up'` numbers them from the foot.
- Vršič sets `climbFromSection` to 0, so the hill climb starts where the road does,
  on the way out of Kranjska Gora. The published 9.24 km is still section 1, from the bridge.
- `track.places` is carved into `TerrainField` after the road blend, and drawn by
  `src/world/mappedPlaces.ts`. The water is only the lake polygon.
- Test: `src/routes/real/track.test.ts` (start, published length, 24 hairpins, lake and lots).

## Alpe d'Huez

Built with `node scripts/real-track/build.mjs alpe`. Same rules as Vršič. The choices
that are particular to this road:

- The line is the D 211 from the roundabout where it leaves the D 1091, at the north
  edge of Bourg-d'Oisans, to the top of Avenue du Rif Nel. That is the published
  profile: 14.59 km, 728 m to 1,840 m. After smoothing, the line is 14.60 km.
- Through the resort the road is Route d'Huez, Route de la Poste, Route du Signal,
  then Avenue de l'Étendard and up Avenue du Rif Nel. It does not continue toward
  the Col de Sarenne.
- The 21 bends are numbered down, 21 at the foot and 1 at the top. A corner in the
  flat streets after bend 1 is not given a number.
- The turn at each end is the same small balloon as Vršič, so the ride comes back
  down this road and can climb it again.
- Two towns, measured from the valley end of the road: Bourg-d'Oisans for the
  first 500 m, and L'Alpe d'Huez from 14,040 m to 14,570 m, on the easing finish
  where the resort is.

## Passo dello Stelvio

Built with `node scripts/real-track/build.mjs stelvio`. Same rules as Vršič, with these choices:

- The line is the SS 38 from the valley side of Prato allo Stelvio to the OpenStreetMap pass
  (node 4353043451, 2,758 m). It stops at the pass.
- The timed climb starts where that road is 25.3 km below the pass. That is the cols-cyclisme
  profile: 916 m at the edge of Prato, 1,842 m of climbing, 48 hairpins. After the corner
  rounding the ridden climb is 25.21 km, and each full kilometre is within 0.3 points of the
  published gradient.
- The signs count down. 48 and 47 are the pair after Gomagoi, 46 and 45 are in Trafoi, and 1
  is the last bend before the pass.
- The turn at the pass and the turn on the valley side of Prato are the same small balloon as
  Vršič, so the ride comes back down this road and can climb it again.
- Towns, measured from the valley end: Prato allo Stelvio (a short street at the foot, about 800 m), Ponte di Stelvio, Gomagoi, Trafoi.
- The extra opening of bends tighter than 7 m is left off (`minRadius: 0`). On this road those
  passes cut about 800 m out of the climb and kinked the apexes. The light rounding of
  OpenStreetMap's polygon corners stays. A bend can be tighter than the 7.6 m carriageway;
  that is the shape of these hairpins.

## Mont Ventoux from Bédoin

Built with `node scripts/real-track/build.mjs ventoux`. Same rules as Vršič, with these choices:

- The line is the D 974, Route du Mont-Ventoux, from the roundabout where it leaves the D 19
  at the edge of Bédoin to the top of the road. After the corner rounding the climb is 21.26 km
  against the published 21.30 km. On a full kilometre the gradient misses the cols-cyclisme
  figure by at most 0.2 points.
- The road continues past the summit and down toward Malaucène. The ride stops at the
  OpenStreetMap vertex beside node 1334330072 (the road summit, tagged 1,898 m). The profile
  ends at 1,903 m, which is the cols-cyclisme figure for that same point. The north side and
  the road from Sault are not in the file the builder reads (`data/osm/ventoux-bedoin.json`,
  cut from the full D 974 fetch in `data/osm/ventoux-d974.json`).
- Places on that line: the hairpin at Saint-Estève near km 5.7 (about 541 m), the Virage du
  Bois near km 10.4, and Chalet Reynard near km 15.2, where the D 164 from Sault joins and
  the forest ends. There is no numbered hairpin series. The sharp bends still get signs.
- The turn at the summit and the turn at the Bédoin roundabout are the same small balloon as
  Vršič, so the ride comes back down this road and can climb it again.
- The mountain is the limestone colours, and the treeline is 1,500 m, so the forest holds
  through the middle of the climb. The loose gravel takes over at 1,520 m, just above
  where the trees stop past Chalet Reynard. From there the ground and the bank beside
  the road are that stone, a light grey rather than the pale scree colour, and the grass
  tufts stop. The forest floor below is unchanged.
- The transmitter stands off the asphalt on the north side of the finish: a concrete
  tower with the red and white mast. It is kept on the summit bench. Further north the
  terrain grid drops below the road.

## Col du Tourmalet from Luz-Saint-Sauveur

Built with `node scripts/real-track/build.mjs tourmalet`. Same rules as Vršič, with these choices:

- The line is the D 918 from the junction in Luz-Saint-Sauveur where Rue de Barèges leaves the D 921, up the Bastan valley, through Barèges, to the pass. It stops there. The east side toward La Mongie is in the OpenStreetMap extract and is not part of the ride. The old road over the Pont de la Gaubie (Voie Laurent Fignon) is a different way and is not included. Through Barèges the street is Rue Ramond, which OpenStreetMap does not tag with the road number; that one way is in the file so the D 918 stays one road.
- The summit is the D 918 vertex on OpenStreetMap mountain_pass node 261767485, tagged 2,115 m. The cols-cyclisme profile is 19.00 km from 711 m to 2,115 m, 1,404 m of climbing. After the corner rounding the ridden climb is 18.83 km (0.9 % short). On a full kilometre the gradient stays within a tenth of a point of that profile. The 30 m terrain is about 33 m off along the road, so it is used for the mountains and not for the slope.
- There is no published numbered hairpin series. Signs count up from the foot, on the sharp bends of this line only.
- The turn at the pass and the turn at the Luz junction are the same small balloon as Vršič, so the ride comes back down this road and can climb it again.
- The slopes match the valley. Below about 1,300 m the gorge is woodland and pasture together, so the forest is patchy rather than a solid stand. From Barèges up, the D 918 runs through grazed grass and the ski slopes: the Street View at about 1,400 m is open hillside, with a few trees in the gullies and rock on the steep faces. The treeline is set there, and the ground above it stays grass.
- Towns, measured from the valley end: Luz-Saint-Sauveur on the opening street, Esterre, Cabadur (the houses on the road above the gorge), and Barèges as the short spa street around the village centre. Super Barèges is the name of the ski area above the village. The road there has no town.

## Alto de l'Angliru from La Vega

Built with `node scripts/real-track/build.mjs angliru`. Same rules as Vršič, with these choices:

- The line is the RI-2 out of La Vega, then the RI-5 through Porció, then Carretera a L'Angliru to the dead end in the summit parking. Side streets in the village stay out of the file. The published climb is 12.55 km on that line, from the valley junction at 322 m. OpenStreetMap node 2052976081 (named Angliru, tagged 1,570 m) is about 130 m short of that distance; the profile ends further along the same road, where the terrain is 1,574 m. On a full kilometre the gradient stays within 0.4 points of the cols-cyclisme profile.
- The road keeps going, almost level, for about 500 m more to the summit parking (way 205547894). The turn is there, so the ride comes back down this road and can climb it again. The 30 m terrain is about 16 m off along the climb, so it is used for the mountains and not for the slope.
- Cuesta Les Cabanes is on the road just after the flat kilometre at Viapará. La Cueña Les Cabres is the node at the start of the 17.5 % kilometre. That kilometre is the published average. The 23.5 % ramp quoted inside it is not a separate piece on the cols-cyclisme profile, so the road rides the 17.5 %.
- There is no published numbered hairpin series. Signs count down, on the sharp bends of this line only.
- La Vega is the opening half kilometre. The summit parking is the OpenStreetMap polygon, paved flat beside the road.
- The treeline is 1,500 m. The lower slopes stay wooded, and the summit parking is open. A flat stretch up there would otherwise be treated as valley farmland.

## Col du Galibier from Valloire

Built with `node scripts/real-track/build.mjs galibier`. Same rules as Vršič, with these choices:

- The line is the D 902 from the centre of Valloire to OpenStreetMap pass node 5541498001 (2,642 m). It stops at the pass. The file is that chain only. The Tunnel du Galibier is tagged `bicycle=no` and is not in it. The last kilometre is the D 902 B, the open road over the top.
- The published profile is the cols-cyclisme chart from Saint-Michel-de-Maurienne, cut at "Valloire (centre)": 18.02 km, 1,406 m to 2,642 m. After the corner rounding the line is 17.93 km, half a percent short. On a full kilometre the gradient stays within 0.4 points of that profile. The 30 m terrain is about 8 m off along the climb, so it is used for the mountains and not for the slope.
- There is no published numbered hairpin series. Signs count down, on the sharp bends of this line only. The lacets start above Plan Lachat. The last of them are on the open road above the tunnel.
- The turn at the pass and the turn in Valloire are the same small balloon as Vršič, so the ride comes back down this road and can climb it again.
- Towns, measured from the valley end: Valloire on the opening street through the second roundabout, Plan Lachat where the guidepost stands (about 9.6 km, 1,967 m), and Les Granges du Galibier (about 13.7 km, 2,300 m).
- The summit parking is the OpenStreetMap gravel polygon beside the pass.

## Passo Giau from Selva di Cadore

Built with `node scripts/real-track/build.mjs giau`. Same rules as Vršič, with these choices:

- The line is the SP 638 from Via IV Novembre in Selva di Cadore to OpenStreetMap pass node 141490497 (2,236 m). It stops at the pass. The north side, toward Pocol and Cortina, is not in the file.
- The timed climb starts 30 m down Via IV Novembre from the junction where the SP 638 leaves the valley road. OpenStreetMap measures 9.76 km from that junction to the pass, 9.74 km after the corner rounding. The cols-cyclisme drawing is 10.12 km, from 1,314 m to 2,236 m, 922 m of climbing. The ridden climb stays inside 4% of that drawing, and the gain is the published 922 m. On a full kilometre the gradient stays within 0.8 points of the drawing. The 30 m terrain is about 14 m off along the road, so it is used for the mountains and not for the slope.
- The 29 tornanti are numbered down, 29 on the way out of the village and 1 at the last bend before the pass. The bends stay as mapped (`minRadius: 0`). The three avalanche galleries are the `tunnel=yes` ways on this line.
- The turn at the pass and the turn on Via IV Novembre are the same small balloon as Vršič, so the ride comes back down this road and can climb it again.
- Towns, measured from the valley end: Selva di Cadore on the opening street (the square is about 160 m along). The pass is not a town. There is one restaurant there, the same cabin used on the cols, and the OpenStreetMap parking stays. Rifugio Fedare is beside the road at about 1,990 m. It is not a town.
- Parking from OpenStreetMap: three lots at the pass, and the lot at Rifugio Piezza (Da Aurelio) at about 2,150 m. The mountain is the limestone colours. The treeline is 2,000 m, so the forest holds to Fedare and the top is open meadow. Woods and houses are still generated.

## Hairpins and the ground mesh

The grass is an 8 m grid. On a straight the bank starts about 18 m out, so a
triangle that covers the asphalt stays flat, and the rock cut rises at about
0.9 (the same pitch the rest of the mountain uses beside the road).

A hairpin breaks the flat shelf. The next leg comes back between about 7 m
(the Stelvio wall) and about 50 m away (the open bends above Valloire), and several metres higher. Snapping the ground to whichever
road is nearest turns that gap into a vertical step, and on a square grid the
top of the step zigzags instead of following the bend. Stretching the flat
shelf until it covers the other leg does the same thing from the other side:
it buried the lower road and left the upper rail in the air. Do not do that.

`TerrainField` fills the gap with the same kind of bank. From just outside each
verge the ground rises toward the other carriageway, at 0.9 where there is
room and steeper only when the legs are too close for that pitch. The crest is
a fixed distance out from the lower road, so it follows the bend. The cells
that contain the bank drop to 1 m (`meshStep`), to 0.5 m when the gap between
the two asphalts is under 1.6 m, and to 0.25 m when it is under 0.8 m, plus
the cell beside them. A 2 m or 4 m cell still bridges the lane on this wall.
A town does not turn this off: Trafoi sits on the bends. Where the next
carriageway is closer than the gravel shoulder, that shoulder stops halfway
between them, so it does not run into the terrace above. An 8 m cell within
about 10 m of the asphalt whose corners span more than a metre, and any cell
within about 40 m whose face is steeper than the cut, is refined to 1 m too.
Cells coarser than 16 m stay coarse. This is decided when the world is built, so the
next road gets it without a change to the builder.

The fine edge follows the slope and the coarse edge is the straight line
between the same corners. On a steep face that crack is a hole you can see
through. The finer cell closes it with a ribbon between those two edges
(`stitchEdge` in the chunk builder). Do not hide the crack by dropping a wall
below the ground. That wall is the zigzag cliff. The ribbon only spans the
gap that is actually open.

Three things that still turned up on the ridden roads, usually at the hairpins,
and that the mesh above is there to stop. Do not undo them when the next road
is built. They are in `TerrainField`, so a new road gets them on its own.

- A wall tight against the asphalt. The verge stays flat for about 18 m so the
  cell on the road stays level, then the ground has to catch a hillside that is
  already several metres higher, or a valley that is already lower, because the
  next leg of the hairpin sits in the same height stamp. Blending that whole
  offset across the next 4 m is a cliff at the edge of the bench. Leave the
  verge flat, then climb or drop at 0.9 until the hillside is actually met.
  The real mountain takes over further out, where there is room for the slope.
  Do not apply another road's cone inside this verge: on a tight stack that
  cone is the lower terrace, and it pulls the rail down through the asphalt.
- A step where the pair of legs is dropped. The bank used to stop at a fixed
  distance (about 56 m, and again at 76 m). One metre further on, the ground
  fell back to the verge blend and jumped by the whole terrace. Fade the slope
  out between about 70 m and 95 m of separation, including when the point sits
  directly between the legs, and let the search extend past the end of that
  fade so the cutoff itself is not a step. Keeping a full-weight slope out to
  100 m is the opposite fault: that grabs a road across the valley and switches
  it on in one metre.
- A triangular fin, and a floating block, on the bank. The nearest carriageway
  flips from the lower leg to the upper one as you cross the gap. If the bank
  is mixed with that shelf, or the flat shelf snaps to whichever road is
  nearer, the height flips with it. One corner of an 8 m cell stays on the
  verge and the opposite corner is up on the next terrace. The diagonal is the
  fin, and the crack where the fine cells meet the coarse ones is the hole.
  Between the legs the bank owns the height. Where the 0.9 wedges of the
  nearby carriageways still overlap, the ground stays inside that overlap, so
  a different choice of feet cannot step outside it. A closer stack has no
  overlap and the bank is allowed to be steeper. The rock-cut strength is
  blended across the carriageways in range: snapping to one sample's cut, where
  the other leg is cut harder, is the same step. The nearest-road search has
  to cover two hash cells, or a road 35 m away is missed and the nearest sample
  jumps to the terrace on the other side. Do not paper over the fin with a
  vertical skirt.

## Adding the next road

1. Fetch the OSM ways for the road into `data/osm/<name>.json` (Overpass; ask
   for `out geom tags`).
2. Add a config to `CONFIGS` in `scripts/real-track/build.mjs`: OSM file, `from` and `to`
   points, the way where the climb starts (or a `climbStart` coordinate, when the
   profile begins in the middle of a way), the summit point (look for a
   `mountain_pass` node), elevations, how the hairpins are numbered, and `towns`
   (name, `fromM`, `toM`, metres from the valley end of the road). A resort at
   the top is one of those towns, on the stretch where the road actually passes
   through it.
3. The climb must already exist in `data/real-climbs.research.json` with its profile
   (`source_segments`) and sources.
4. Run the script. Check that the length is within ~2 % of the published value and that
   the hairpin count matches. Add a test like `track.test.ts`.

## Credits and licence

See `ATTRIBUTION.md`. The track files are derived from OpenStreetMap (ODbL): if the app
goes public, show "© OpenStreetMap contributors" and share the track data under the
same licence.
