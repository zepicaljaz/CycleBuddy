# src/ui: HUD and ride panels

What the rider sees during a ride, plus shared DOM helpers. Menu screens are built in `game/app.ts`, `game/*View.ts`, `career/panel.ts` and `analytics/view.ts`, but the same look rules apply there.

## What lives here
- `hud.ts` (`Hud`): metrics (power, W/kg, cadence, HR, speed), brake/draft flags, map, top bar (climb or lap), ride stats, standings / coach side panel, profile, group gaps, countdown.
- `minimap.ts` (`Minimap`): nearby road, wider road and full loop maps.
- `profileChart.ts` (`ProfileChart`, `CssSize`): elevation profiles for the HUD, cards and stages.
- `roadAhead.ts` (`RoadAhead`): grade, next pitch, km to the top, zone, pace line.
- `roadbook.ts`: roadbook profile (`drawRoadbook`). `rideBar.ts`: lap bar. `riderTag.ts`: label over the AI rider under the mouse.
- `helpContent.ts`: trainer setup and help text (`HELP_SECTIONS`).
- `dom.ts`: `$`, `$$`, `esc`, `toast`, `gradeColor`.
- `menus.css`: home menu styles. Most HUD styles are in `src/styles.css` → "Broadcast skin" section.

## Look rules
- Big type, readable from the saddle at 2 m. Numbers that change use tabular figures (`font-variant-numeric: tabular-nums`) so they don't jitter.
- No card grids, no pills, no emoji (the conventions test fails on emoji in `src/`, `styles.css`, `menus.css`). Typographic marks like ★ are fine.
- Keep the broadcast look: display font, uppercase headings, glass panels already in `styles.css`. Reuse classes before adding new ones.
- Escape every name or user string with `esc()`.

## Update rules
- The HUD and road-ahead panel update at 10 Hz (called from `app.ts` every 100 ms), never per frame. The standings side panel refreshes every 400 ms.
- Only write what changed: `Hud.text()`, `html()`, `style()` and `RoadAhead.set()` compare against the last written value and skip the DOM write. Use them for every new field; never set `textContent`/`innerHTML` directly in `update()`.
- Cache element lookups (`Hud.node()`); no `querySelector` per update.
- Canvases: draw the static part once to an offscreen canvas keyed by what it depends on (route id, range, direction, size), then blit it and draw only the moving marker. `Minimap.loopCache` and `ProfileChart.cache` do this; key changes on resize.
- Read element sizes through `CssSize` (ResizeObserver), not `clientWidth` per draw, to avoid forced layout.
- Per-frame and per-update cost rules: `docs/PERFORMANCE.md`.

## Add a HUD field
1. Add the element to the `Hud` constructor markup with an `id`.
2. In `update()`, compute the string and write it with `this.text('#id', value)` (or `style`).
3. Style it in the "Broadcast skin" section of `src/styles.css`, tabular figures for numbers.
4. If it needs data from the ride, add a getter on `RideSession`, not a calculation over the field in the HUD.

## Tests
- `npx vitest run src/ui/minimap.test.ts src/ui/hud.test.ts src/ui/rideBar.test.ts src/ui/riderTag.test.ts`
- `npx vitest run src/screens.test.ts` for menu screens and the help text.

## Traps
- `ProfileChart.draw()` samples 301 elevations and builds the `ys` array on every call, before it checks the cache key; only the drawing is cached.
- `Hud.updateSide()` rebuilds the side panel with `innerHTML` every 400 ms without the changed-value check, so listeners inside it are lost each time; wire clicks on a parent.
- `CssSize` reads 0 until the ResizeObserver fires on hidden elements; `ProfileChart` clamps to 10 px.
