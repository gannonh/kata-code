import { Box3, Mesh, MeshPhysicalMaterial, PerspectiveCamera, Texture, Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";
import { createFoldScene, duoPresentation } from "./foldScene.ts";
import { phoneDisplayLayout } from "./phoneScene.ts";
import { sceneDigest } from "./sceneDigest.test-util.ts";

describe("Android fold scene", () => {
  it("moves one physical half around the hinge while preserving both screen halves", () => {
    const texture = new Texture();
    const scene = createFoldScene(
      texture,
      phoneDisplayLayout({ width: 2200, height: 1840, orientation: "landscape_left" }, 2200, 1840),
      180,
    );
    const moving = scene.orientation.children[0]!;
    const fixed = scene.orientation.children[1]!;
    const openWidth = new Box3().setFromObject(scene.root).getSize(new Vector3()).x;
    const leftScreen = scene.root.getObjectByName("left-inner-screen") as Mesh;
    const rightScreen = scene.root.getObjectByName("right-inner-screen") as Mesh;
    leftScreen.geometry.computeBoundingBox();
    rightScreen.geometry.computeBoundingBox();
    const creaseWidth =
      rightScreen.geometry.boundingBox!.min.x - leftScreen.geometry.boundingBox!.max.x;
    expect(creaseWidth).toBeLessThan(0.01);
    const continuousScreen = scene.root.getObjectByName("continuous-inner-screen") as Mesh;
    const positions = continuousScreen.geometry.getAttribute("position");
    expect(continuousScreen.geometry.index).not.toBeNull();
    expect(Array.from({ length: positions.count }, (_, i) => positions.getX(i))).toContain(0);
    scene.setAngle(90);
    expect(moving.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(fixed.rotation.y).toBe(0);
    scene.setAngle(0);
    const closedWidth = new Box3().setFromObject(scene.root).getSize(new Vector3()).x;
    expect(closedWidth).toBeLessThan(openWidth * 0.7);
    expect(scene.root.getObjectByName("cover-screen")?.visible).toBe(true);
    scene.dispose();
    texture.dispose();
  });

  it("maps touches on each open half and the closed cover to the live frame", () => {
    const texture = new Texture();
    const scene = createFoldScene(texture, phoneDisplayLayout(null, 2200, 1840), 180);
    const camera = new PerspectiveCamera(32, 1, 0.1, 30);
    camera.position.z = 6;
    camera.updateMatrixWorld(true);
    const project = (x: number) => {
      const point = new Vector3(x, 0, 0.041).project(camera);
      return scene.screenPoint((point.x + 1) / 2, (1 - point.y) / 2, camera);
    };
    expect(project(-0.52)?.x).toBeCloseTo(0.25, 1);
    expect(project(0.52)?.x).toBeCloseTo(0.75, 1);
    expect(scene.screenPoint(0.99, 0.5, camera, true)?.x).toBe(1);
    scene.setAngle(0);
    expect(project(0.52)?.x).toBeCloseTo(0.5, 1);
    scene.dispose();
    texture.dispose();
  });

  it("shapes the inner display to the raw frame, portrait or landscape", () => {
    const texture = new Texture();
    for (const [width, height] of [
      [2076, 2152],
      [2208, 1840],
    ] as const) {
      const scene = createFoldScene(
        texture,
        phoneDisplayLayout(null, width, height),
        180,
        width / height,
      );
      const screen = scene.root.getObjectByName("continuous-inner-screen") as Mesh;
      screen.geometry.computeBoundingBox();
      const size = screen.geometry.boundingBox!.getSize(new Vector3());
      expect(size.x / size.y).toBeCloseTo(width / height, 2);
      scene.dispose();
    }
    texture.dispose();
  });

  it("pins the Android body at each hinge angle, inner shape and cover touch", () => {
    const texture = new Texture();
    const camera = new PerspectiveCamera(32, 1, 0.1, 30);
    camera.position.z = 6;
    camera.updateMatrixWorld(true);
    const pinned: Record<string, string> = {};
    for (const [width, height] of [
      [2076, 2152],
      [2208, 1840],
    ] as const) {
      for (const orientation of ["portrait", "portrait_upside_down"] as const) {
        const scene = createFoldScene(
          texture,
          phoneDisplayLayout({ width, height, orientation }, width, height),
          180,
          width / height,
        );
        for (const angle of [180, 135, 90, 45, 0]) {
          scene.setAngle(angle);
          const key = `${width}x${height} ${orientation} ${angle}`;
          pinned[key] = `${sceneDigest(scene.root)} ${[0.2, 0.45, 0.55, 0.8]
            .map((x) => {
              const point = scene.screenPoint(x, 0.4, camera);
              return point ? `${point.x.toFixed(3)},${point.y.toFixed(3)}` : "-";
            })
            .join(" ")}`;
        }
        scene.dispose();
      }
    }
    expect(pinned).toEqual({
      "2076x2152 portrait 0": "27:76d56d18 - - 0.134,0.340 0.984,0.340",
      "2076x2152 portrait 135": "27:7fbc2399 - 0.388,0.345 0.582,0.341 0.995,0.341",
      "2076x2152 portrait 180": "27:75290375 0.005,0.341 0.418,0.341 0.582,0.341 0.995,0.341",
      "2076x2152 portrait 45": "27:7e3d39ef - - 0.280,0.346 -",
      "2076x2152 portrait 90": "27:fba12286 - - 0.582,0.341 0.995,0.341",
      "2076x2152 portrait_upside_down 0": "27:76d56d18 - - 0.866,0.660 0.016,0.660",
      "2076x2152 portrait_upside_down 135": "27:7fbc2399 - 0.612,0.655 0.418,0.659 0.005,0.659",
      "2076x2152 portrait_upside_down 180":
        "27:75290375 0.995,0.659 0.582,0.659 0.418,0.659 0.005,0.659",
      "2076x2152 portrait_upside_down 45": "27:7e3d39ef - - 0.720,0.654 -",
      "2076x2152 portrait_upside_down 90": "27:fba12286 - - 0.418,0.659 0.005,0.659",
      "2208x1840 portrait 0": "27:b5f6b0d2 - - 0.107,0.340 0.784,0.340",
      "2208x1840 portrait 135": "27:3d43a529 0.021,0.364 0.410,0.345 0.566,0.341 0.898,0.341",
      "2208x1840 portrait 180": "27:579a98ad 0.102,0.341 0.434,0.341 0.566,0.341 0.898,0.341",
      "2208x1840 portrait 45": "27:6faaa556 - - 0.223,0.346 -",
      "2208x1840 portrait 90": "27:714f1e8b - - 0.566,0.341 0.898,0.341",
      "2208x1840 portrait_upside_down 0": "27:b5f6b0d2 - - 0.893,0.660 0.216,0.660",
      "2208x1840 portrait_upside_down 135":
        "27:3d43a529 0.979,0.636 0.590,0.655 0.434,0.659 0.102,0.659",
      "2208x1840 portrait_upside_down 180":
        "27:579a98ad 0.898,0.659 0.566,0.659 0.434,0.659 0.102,0.659",
      "2208x1840 portrait_upside_down 45": "27:6faaa556 - - 0.777,0.654 -",
      "2208x1840 portrait_upside_down 90": "27:714f1e8b - - 0.434,0.659 0.102,0.659",
    });
    texture.dispose();
  });
});

describe("iPhone Duo fold scene", () => {
  const texture = new Texture();
  // The inner panel reports a portrait framebuffer; the book-style body is its quarter turn.
  const layout = phoneDisplayLayout(
    { width: 1800, height: 2000, orientation: "portrait" },
    1800,
    2000,
  );
  const duo = () => createFoldScene(texture, layout, 180, 2000 / 1800, "iphone-duo");
  const facing = (scene: ReturnType<typeof duo>, name: string, axis = new Vector3(0, 0, 1)) => {
    scene.root.updateMatrixWorld(true);
    return axis
      .clone()
      .transformDirection(scene.root.getObjectByName(name)!.matrixWorld)
      .toArray()
      .map((value) => Math.round(value * 1000) / 1000 + 0);
  };

  it("folds to each hub pose and faces the display the hub streams toward the viewer", () => {
    const diagonal = Math.round(Math.SQRT1_2 * 1000) / 1000;
    const scene = duo();
    const pose = (
      hingePose: "closed" | "book" | "open" | "laptop" | "tent",
      angle: number,
      display: "cover" | "inner",
    ) => {
      scene.setAngle(angle);
      scene.setActiveDisplay(display);
      scene.root.quaternion.copy(duoPresentation({ angle, pose: hingePose, display, layout }));
      return {
        cover: scene.root.getObjectByName("cover-screen")!.visible,
        inner: scene.root.getObjectByName("continuous-inner-screen")!.visible,
        hinge: facing(scene, "hinge-spine", new Vector3(0, 1, 0)),
        movingHalf: facing(scene, "left-inner-screen"),
        fixedHalf: facing(scene, "right-inner-screen"),
        coverFaces: facing(scene, "cover-screen"),
      };
    };
    // Closed: the cover faces the viewer, upright, with the hinge down its side.
    expect(pose("closed", 0, "cover")).toEqual({
      cover: true,
      inner: false,
      hinge: [0, 1, 0],
      movingHalf: [0, 0, -1],
      fixedHalf: [0, 0, 1],
      coverFaces: [0, 0, 1],
    });
    // Open: one flat inner display with the hinge across it.
    expect(pose("open", 180, "inner")).toEqual({
      cover: false,
      inner: true,
      hinge: [-1, 0, 0],
      movingHalf: [0, 0, 1],
      fixedHalf: [0, 0, 1],
      coverFaces: [0, 0, -1],
    });
    // Book: a right angle, both halves turned equally toward the viewer.
    expect(pose("book", 90, "inner")).toEqual({
      cover: false,
      inner: true,
      hinge: [-1, 0, 0],
      movingHalf: [0, diagonal, diagonal],
      fixedHalf: [0, -diagonal, diagonal],
      coverFaces: [0, -diagonal, -diagonal],
    });
    // Laptop: the moving half lies flat as the base; the fixed half stands as the lid.
    expect(pose("laptop", 90, "inner")).toEqual({
      cover: false,
      inner: true,
      hinge: [-0.94, 0, -0.342],
      movingHalf: [-0.089, 0.966, 0.243],
      fixedHalf: [-0.33, -0.259, 0.908],
      coverFaces: [0.089, -0.966, -0.243],
    });
    // Tent: hinge on top, the halves splayed below it, the cover toward the viewer.
    expect(pose("tent", 80, "cover")).toEqual({
      cover: true,
      inner: false,
      hinge: [0.94, 0, 0.342],
      movingHalf: [0.296, -0.5, -0.814],
      fixedHalf: [-0.22, -0.766, 0.604],
      coverFaces: [-0.296, 0.5, 0.814],
    });
    scene.dispose();
  });

  it("shows the display the hub streams, whatever the hinge angle, and the hinge rule otherwise", () => {
    const scene = duo();
    const visible = () =>
      ["cover-screen", "continuous-inner-screen"].filter(
        (name) => scene.root.getObjectByName(name)!.visible,
      );
    expect(visible()).toEqual(["continuous-inner-screen"]);
    scene.setActiveDisplay("cover");
    expect(visible()).toEqual(["cover-screen"]);
    scene.setActiveDisplay(null);
    scene.setAngle(45);
    expect(visible()).toEqual(["cover-screen"]);
    scene.setActiveDisplay("inner");
    expect(visible()).toEqual(["continuous-inner-screen"]);
    scene.dispose();
  });

  it("maps inner touches through the panel's quarter-turn mounting and cover touches directly", () => {
    const scene = duo();
    const camera = new PerspectiveCamera(32, 1, 0.1, 30);
    camera.position.z = 6;
    camera.updateMatrixWorld(true);
    const box = new Box3().setFromObject(scene.root).getSize(new Vector3());
    const touch = (x: number, y: number) => {
      const point = new Vector3(x, y, 0.041).project(camera);
      const raw = scene.screenPoint((point.x + 1) / 2, (1 - point.y) / 2, camera);
      return raw && { x: Math.round(raw.x * 20) / 20, y: Math.round(raw.y * 20) / 20 };
    };
    // Body left half's centre is the bottom half of the raw panel; the right half is its top.
    expect(touch(-box.x / 4, 0)).toEqual({ x: 0.5, y: 0.75 });
    expect(touch(box.x / 4, 0)).toEqual({ x: 0.5, y: 0.25 });
    // Raw X runs down the hinge.
    expect(touch(box.x / 4, 0.55)).toEqual({ x: 0.25, y: 0.25 });
    scene.setAngle(0);
    scene.setActiveDisplay("cover");
    expect(touch(box.x / 4, 0.55)).toEqual({ x: 0.5, y: 0.25 });
    scene.dispose();
  });

  it("builds an iPhone-styled body and samples the feed in raw panel space", () => {
    const scene = duo();
    const back = scene.root.getObjectByName("right-back") as Mesh;
    expect((back.material as MeshPhysicalMaterial).color.getHex()).toBe(0x424b5d);
    const lenses = scene.root.getObjectsByProperty("name", "camera-lens");
    expect(lenses).toHaveLength(2);
    const surface = scene.root.getObjectByName("continuous-inner-screen") as Mesh;
    const positions = surface.geometry.getAttribute("position");
    const uvs = surface.geometry.getAttribute("uv");
    surface.geometry.computeBoundingBox();
    const { min, max } = surface.geometry.boundingBox!;
    // The body's bottom right corner samples the raw panel's top right.
    let corner = 0;
    for (let i = 1; i < positions.count; i++)
      if (positions.getX(i) - positions.getY(i) > positions.getX(corner) - positions.getY(corner))
        corner = i;
    expect(positions.getX(corner)).toBeCloseTo(max.x, 1);
    expect(positions.getY(corner)).toBeCloseTo(min.y, 1);
    expect(
      [uvs.getX(corner), uvs.getY(corner)].map((value) => Math.round(value * 10) / 10),
    ).toEqual([1, 1]);
    scene.dispose();
  });
});
