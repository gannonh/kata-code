import { Mesh, type Material, type Object3D } from "three";

const round = (value: number) => {
  const fixed = value.toFixed(5);
  return fixed === "-0.00000" ? "0.00000" : fixed;
};

/** A stable fingerprint of everything a renderer would draw: transforms, geometry, UVs, materials and visibility. */
export function sceneDigest(root: Object3D) {
  root.updateMatrixWorld(true);
  const lines: string[] = [];
  root.traverse((object) => {
    const parts = [object.type, object.name, String(object.visible)];
    parts.push(object.matrixWorld.elements.map(round).join(","));
    if (object instanceof Mesh) {
      for (const name of ["position", "uv"]) {
        const attribute = object.geometry.getAttribute(name);
        if (attribute)
          parts.push(Array.from(attribute.array as ArrayLike<number>, round).join(","));
      }
      const index = object.geometry.index;
      if (index) parts.push(Array.from(index.array as ArrayLike<number>).join(","));
      const material = object.material as Material & {
        color?: { getHexString: () => string };
        map?: unknown;
      };
      parts.push(material.type, material.color?.getHexString() ?? "", String(!!material.map));
    }
    lines.push(parts.join("|"));
  });
  // FNV-1a keeps the pinned value short while covering every serialized digit.
  let hash = 0x811c9dc5;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      hash ^= line.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `${lines.length}:${hash.toString(16).padStart(8, "0")}`;
}
