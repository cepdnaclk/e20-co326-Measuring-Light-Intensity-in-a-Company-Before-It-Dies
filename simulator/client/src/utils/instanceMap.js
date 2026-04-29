const parseIndexFromLabel = (value) => {
  const match = String(value ?? "").match(/(\d+)$/);
  if (!match) return null;
  return Math.max(1, Number(match[1]));
};

const sortByIndexedLabel = (a, b) => {
  const idxA = parseIndexFromLabel(a);
  const idxB = parseIndexFromLabel(b);
  if (idxA !== null && idxB !== null && idxA !== idxB) return idxA - idxB;
  if (idxA !== null && idxB === null) return -1;
  if (idxA === null && idxB !== null) return 1;
  return String(a).localeCompare(String(b));
};

export function buildSiteMaps(instances) {
  const siteGroups = instances.reduce((acc, lamp) => {
    const site = lamp?.location?.site || "unknown-site";
    if (!acc[site]) acc[site] = [];
    acc[site].push(lamp);
    return acc;
  }, {});

  const siteMaps = Object.entries(siteGroups).map(([site, siteLamps]) => {
    const floorGroups = siteLamps.reduce((acc, lamp) => {
      const floor = lamp?.location?.floor || "unknown-floor";
      if (!acc[floor]) acc[floor] = [];
      acc[floor].push(lamp);
      return acc;
    }, {});

    const floorMaps = Object.entries(floorGroups).map(([floor, lamps]) => {
      const lineKeys = [...new Set(lamps.map((lamp) => lamp.location?.line || "line1"))].sort(sortByIndexedLabel);
      const cellKeys = [...new Set(lamps.map((lamp) => lamp.location?.cell || "cell1"))].sort(sortByIndexedLabel);
      const matrix = {};

      for (const lamp of lamps) {
        const lineKey = lamp.location?.line || "line1";
        const cellKey = lamp.location?.cell || "cell1";
        const key = `${lineKey}__${cellKey}`;
        if (!matrix[key]) matrix[key] = [];
        matrix[key].push(lamp);
      }

      for (const key of Object.keys(matrix)) {
        matrix[key].sort((a, b) => a.id.localeCompare(b.id));
      }

      return { floor, lineKeys, cellKeys, matrix };
    });

    floorMaps.sort((a, b) => sortByIndexedLabel(a.floor, b.floor));
    return { site, floorMaps };
  });

  siteMaps.sort((a, b) => sortByIndexedLabel(a.site, b.site));
  return siteMaps;
}
