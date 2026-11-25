(() => {
  'use strict';

  // The open plaza is centered in the 100 × 130 m playing area.
  const center = { x: 50, z: 95 };
  const courtSide = 14;
  const containerWidth = 2.5;
  const sideOffset = (courtSide + containerWidth) / 2;
  const sides = [
    ['o1', 'Sud', 0, -sideOffset, 0],
    ['o2', 'Est', sideOffset, 0, 90],
    ['o3', 'Nord', 0, sideOffset, 0],
    ['o4', 'Ouest', -sideOffset, 0, 90]
  ];

  // Dimensions refer to the complete footprint, including its annexes.
  const buildings = [
    ['o5', 'La remise', 'studio', 5, 4, 2.1],
    ['o6', 'La longère', 'longere', 13, 4.8, 2.3],
    ['o7', 'La maison et son cellier', 'annexe', 9, 7, 2.4],
    ['o8', 'Le local à outils', 'annexe', 6.5, 5, 2.1],
    ['o9', 'Atelier des menuisiers', 'atelier', 18, 12, 2.9, 'atelier'],
    ['o10', 'Marché des toiles', 'patio', 16, 12, 2.6, 'marche'],
    ['o11', 'La grange et sa réserve', 'halles', 12, 8, 2.7],
    ['o12', 'Le pavillon du verger', 'atelier', 9, 6.5, 2.3]
  ];

  function revise(items) {
    const updated = structuredClone(items);
    const byId = new Map(updated.map(item => [item.id, item]));

    for (const [id, side, xOffset, zOffset, rotation] of sides) {
      const container = byId.get(id);
      if (container?.type !== 'container') continue;
      Object.assign(container, {
        name: `Cour · conteneur ${side.toLowerCase()}`, x: center.x + xOffset,
        z: center.z + zOffset, r: rotation, w: 12, d: containerWidth, h: 2.6
      });
    }

    const canopy = byId.get('o31');
    if (canopy?.type === 'tarp') {
      Object.assign(canopy, {
        name: 'Cour couverte', landmark: 'cour', x: center.x, z: center.z,
        r: 0, w: courtSide, d: courtSide, h: 3.3
      });
    }

    for (const [id, name, shape, w, d, h, landmark] of buildings) {
      const building = byId.get(id);
      if (building?.type !== 'building') continue;
      Object.assign(building, { name, shape, w, d, h });
      if (landmark) building.landmark = landmark;
    }

    const pallet = byId.get('o19');
    if (pallet?.type === 'pallet' && Math.abs(pallet.x - center.x) < 11 && Math.abs(pallet.z - center.z) < 11) {
      Object.assign(pallet, { x: 59, z: 107 });
    }

    // Each stall and workbench remains an independently movable object.
    const market = byId.get('o10');
    if (market?.landmark === 'marche') {
      const stalls = [
        { id: 'etal-lin', type: 'tarp', name: 'Étal de lin', x: market.x - 4, z: market.z + 13, r: 0, w: 5.5, d: 3.5, h: 2.8 },
        { id: 'etal-toile', type: 'tarp', name: 'Étal de toile', x: market.x + 3.5, z: market.z + 13, r: 0, w: 4.5, d: 3, h: 2.5 },
        { id: 'table-lin', type: 'table', name: 'Table de l’étal de lin', x: market.x - 4, z: market.z + 13, r: 0, w: 3.6, d: 1.1, h: 0.85 }
      ];
      for (const stall of stalls) {
        if (!byId.has(stall.id)) updated.push(stall);
      }
    }

    const workshop = byId.get('o9');
    if (workshop?.landmark === 'atelier' && !byId.has('etabli')) {
      updated.push({ id: 'etabli', type: 'table', name: 'Grand établi', x: workshop.x + 2, z: workshop.z - 12, r: workshop.r, w: 4, d: 1.5, h: 0.95 });
    }
    return updated;
  }

  // Populate the new version from the last user-edited layout when the host
  // supplies no saved state. A real saved layout is passed directly to revise.
  function seed(base) {
    const saved = structuredClone(base);
    const userPositions = new Map([
      ['o10', [71, 103]], ['o19', [59, 102.5]], ['o32', [23.5, 57]]
    ]);
    for (const item of saved) {
      const position = userPositions.get(item.id);
      if (position) [item.x, item.z] = position;
    }
    return revise(saved);
  }

  window.AirsoftLayoutV2 = { revise, seed };
})();
