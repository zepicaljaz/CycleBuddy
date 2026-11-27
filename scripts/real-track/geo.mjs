// Shared by build.mjs (road + heights) and cover.mjs (land cover), so both put a
// lat/lon on exactly the same game metre.
//
// Local metres around the track origin: x east, z SOUTH (z grows as latitude falls),
// equirectangular with the scale fixed at the origin's latitude. Over the ±25 km a
// track covers that is well under a metre off a proper projection.

export const R = 6371000;
export const rad = (d) => (d * Math.PI) / 180;

/** Projection around (lat0, lon0): toXZ({lat, lon}) → {x, z}; toLL(x, z) → {lat, lon}. */
export function projection(lat0, lon0) {
  const toXZ = (p) => ({ x: rad(p.lon - lon0) * Math.cos(rad(lat0)) * R, z: -rad(p.lat - lat0) * R });
  const toLL = (x, z) => ({ lat: lat0 - (z / R) * (180 / Math.PI), lon: lon0 + (x / (R * Math.cos(rad(lat0)))) * (180 / Math.PI) });
  return { toXZ, toLL };
}
