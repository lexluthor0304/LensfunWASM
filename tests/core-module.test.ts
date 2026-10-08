// The real core (dist/assets, from `npm run build:wasm`), not a stand-in:
// map building copies from the module's HEAPF32 view, which Emscripten only
// puts on Module when it is listed in EXPORTED_RUNTIME_METHODS. 0.1.3 was
// released without it and built no maps at all, while every test passed.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LF_MODIFY_DISTORTION,
  LF_MODIFY_TCA,
  LF_MODIFY_VIGNETTING,
  createLensfun,
  type CorrectionMaps,
  type LensfunClient,
  type LensfunModule,
  type MapGridInput,
  type SearchLensesInput,
  type VignettingMapInput
} from '../src/index';

const assetPath = (name: string) => fileURLToPath(new URL(`../dist/assets/${name}`, import.meta.url));
const CORE_JS = assetPath('lensfun-core.js');
const CORE_WASM = assetPath('lensfun-core.wasm');
const CORE_DATA = assetPath('lensfun-core.data');
const built = [CORE_JS, CORE_WASM, CORE_DATA].every((file) => existsSync(file));
// CI builds the core before testing, so a missing core fails there. Locally
// `npm run check` runs without Emscripten and skips these.
const skip = !built && !process.env.CI;

// The core targets web and worker only: run its factory as a script and hand
// it the wasm and the data package that a browser would fetch. What the core
// prints to stderr (Lensfun's database parse errors) goes to `errors`.
function nodeModuleFactory(onModule: (module: LensfunModule) => void, errors: string[]) {
  const factory = new Function(`${readFileSync(CORE_JS, 'utf8')}\nreturn createLensfunCoreModule;`)();
  const wasm = new Uint8Array(readFileSync(CORE_WASM));
  const data = new Uint8Array(readFileSync(CORE_DATA));
  return async (options: Record<string, unknown> = {}) => {
    const module = await factory({
      ...options,
      printErr: (message: string) => errors.push(message),
      instantiateWasm(
        imports: WebAssembly.Imports,
        receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void
      ) {
        WebAssembly.instantiate(wasm, imports).then(({ instance, module }) => receive(instance, module));
        return {};
      },
      getPreloadedPackage: () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    });
    onModule(module);
    return module as LensfunModule;
  };
}

async function startClient(): Promise<{ client: LensfunClient; module: LensfunModule; errors: string[] }> {
  let module: LensfunModule | null = null;
  const errors: string[] = [];
  const client = await createLensfun({ moduleFactory: nodeModuleFactory((m) => { module = m; }, errors) });
  return { client, module: module!, errors };
}

// The lens a search for `query` finds whose model (the database's English
// name) matches `model`.
function findLens(client: LensfunClient, query: SearchLensesInput, model: RegExp) {
  const lens = client.searchLenses(query).find((match) => model.test(match.model));
  if (!lens) throw new Error(`lens not found: ${JSON.stringify(query)}`);
  return lens;
}

const CANON_24_105 = {
  query: { lensMaker: 'Canon', lensModel: 'EF 24-105mm f/4L IS USM', cameraMaker: 'Canon', cameraModel: 'Canon EOS 5D Mark III' },
  model: /^Canon EF 24-105mm f\/4L IS USM$/
};
const NIKKOR_18_55 = {
  query: { lensMaker: 'Nikon', lensModel: 'AF-S DX Nikkor 18-55mm f/3.5-5.6G VR', cameraMaker: 'Nikon Corporation', cameraModel: 'Nikon D7000' },
  model: /18-55mm f\/3\.5-5\.6G DX VR$/
};
const CANON_28_105 = {
  query: { lensMaker: 'Canon', lensModel: 'EF 28-105mm f/3.5-4.5 II USM', cameraMaker: 'Canon', cameraModel: 'Canon EOS 5D Mark III' },
  model: /^Canon EF 28-105mm f\/3\.5-4\.5 II USM$/
};
// Vignetting calibration only: no distortion or TCA data.
const NIKKOR_60_MICRO = {
  query: { lensMaker: 'Nikon', lensModel: 'AF-S Micro Nikkor 60mm f/2.8G ED', cameraMaker: 'Nikon Corporation', cameraModel: 'Nikon D850' },
  model: /^Nikkor AF-S 60 mm f\/2\.8G ED Micro$/
};

// The pixel position a node stands for (lfw_*: index * step, within the frame
// in the default grid).
const nodeAt = (index: number, step: number, size: number) => Math.min(index * step, size - 1);

// The largest distance of a node's channel from the node's own position.
function largestShift(coords: Float32Array, stride: number, offset: number, grid: { gridWidth: number; gridHeight: number; step: number }, width: number, height: number) {
  let largest = 0;
  for (let gy = 0; gy < grid.gridHeight; gy++) {
    for (let gx = 0; gx < grid.gridWidth; gx++) {
      const i = (gy * grid.gridWidth + gx) * stride + offset;
      const dx = coords[i] - nodeAt(gx, grid.step, width);
      const dy = coords[i + 1] - nodeAt(gy, grid.step, height);
      largest = Math.max(largest, Math.hypot(dx, dy));
    }
  }
  return largest;
}

function expectFinite(values: Float32Array) {
  expect(values.every((v) => Number.isFinite(v))).toBe(true);
}

// Bilinear read of a per-channel map at pixel position (x, y), channel c.
function sampleChannel(map: Float32Array, grid: { gridWidth: number; gridHeight: number; step: number }, x: number, y: number, c: number) {
  const gx = Math.max(0, Math.min(grid.gridWidth - 1, x / grid.step));
  const gy = Math.max(0, Math.min(grid.gridHeight - 1, y / grid.step));
  const x0 = Math.min(Math.floor(gx), grid.gridWidth - 2);
  const y0 = Math.min(Math.floor(gy), grid.gridHeight - 2);
  const fx = gx - x0;
  const fy = gy - y0;
  const at = (ix: number, iy: number, k: number) => map[(iy * grid.gridWidth + ix) * 6 + c * 2 + k];
  const read = (k: number) =>
    (at(x0, y0, k) * (1 - fx) + at(x0 + 1, y0, k) * fx) * (1 - fy) + (at(x0, y0 + 1, k) * (1 - fx) + at(x0 + 1, y0 + 1, k) * fx) * fy;
  return { x: read(0), y: read(1) };
}

describe.skipIf(skip)('the built core module', () => {
  it('is built', () => {
    expect(built).toBe(true);
  });

  it('exports the HEAPF32 view the map builders read', async () => {
    const { client, module } = await startClient();
    try {
      expect(module.HEAPF32).toBeInstanceOf(Float32Array);
    } finally {
      client.dispose();
    }
  });

  it('builds geometry, TCA and vignetting maps for a lens with all three calibrations', async () => {
    const { client } = await startClient();
    try {
      const lens = findLens(client, CANON_24_105.query, CANON_24_105.model);
      const width = 600;
      const height = 400;
      const mods = client.getAvailableModifications(lens.handle, 1);
      expect(mods & (LF_MODIFY_DISTORTION | LF_MODIFY_TCA | LF_MODIFY_VIGNETTING))
        .toBe(LF_MODIFY_DISTORTION | LF_MODIFY_TCA | LF_MODIFY_VIGNETTING);

      const maps: CorrectionMaps = client.buildCorrectionMaps({
        lensHandle: lens.handle, width, height, focal: 24, crop: 1, step: 8,
        includeTca: true, includeVignetting: true, aperture: 8, distance: 1000
      });
      const nodes = maps.gridWidth * maps.gridHeight;
      expect(maps.gridWidth).toBe(Math.floor((width - 1) / 8) + 1);
      expect(maps.gridHeight).toBe(Math.floor((height - 1) / 8) + 1);
      expect(maps.geometry.length).toBe(nodes * 2);
      expect(maps.tca?.length).toBe(nodes * 6);
      expect(maps.vignetting?.length).toBe(nodes * 3);
      [maps.geometry, maps.tca!, maps.vignetting!].forEach(expectFinite);

      // 24 mm is distorted: the corners read pixels several pixels away.
      expect(largestShift(maps.geometry, 2, 0, maps, width, height)).toBeGreaterThan(2);
      // The TCA map is built with TCA correction alone: green stays put, red
      // and blue move a little; it carries no distortion.
      expect(largestShift(maps.tca!, 6, 2, maps, width, height)).toBeLessThan(1e-3);
      const tcaRed = largestShift(maps.tca!, 6, 0, maps, width, height);
      expect(tcaRed).toBeGreaterThan(0.05);
      expect(tcaRed).toBeLessThan(2);
      // Vignetting gains brighten the corners, not the centre.
      const centre = (Math.floor(maps.gridHeight / 2) * maps.gridWidth + Math.floor(maps.gridWidth / 2)) * 3;
      expect(maps.vignetting![0]).toBeGreaterThan(1.05);
      expect(Math.abs(maps.vignetting![centre + 1] - 1)).toBeLessThan(0.02);
    } finally {
      client.dispose();
    }
  });

  it('fails the TCA or vignetting map of a lens without that calibration', async () => {
    const { client } = await startClient();
    try {
      const nikkor = findLens(client, NIKKOR_18_55.query, NIKKOR_18_55.model);
      expect(client.getAvailableModifications(nikkor.handle, 1.528) & LF_MODIFY_TCA).toBe(0);
      const grid = { lensHandle: nikkor.handle, width: 450, height: 300, focal: 18, crop: 1.528, step: 6 };
      expect(() => client.buildCorrectionMaps({ ...grid, includeTca: true })).toThrow(/code -4/);
      const maps = client.buildCorrectionMaps({ ...grid, includeVignetting: true, aperture: 5.6 });
      expect(largestShift(maps.geometry, 2, 0, maps, grid.width, grid.height)).toBeGreaterThan(2);

      const canon = findLens(client, CANON_28_105.query, CANON_28_105.model);
      expect(client.getAvailableModifications(canon.handle, 1) & LF_MODIFY_VIGNETTING).toBe(0);
      const plain = { lensHandle: canon.handle, width: 300, height: 200, focal: 28, crop: 1, step: 4 };
      expect(() => client.buildCorrectionMaps({ ...plain, includeVignetting: true, aperture: 8 })).toThrow(/code -4/);
      expectFinite(client.buildCorrectionMaps(plain).geometry);
    } finally {
      client.dispose();
    }
  });

  it('reads maps right after the heap grows', async () => {
    const { client, module } = await startClient();
    try {
      const lens = findLens(client, CANON_24_105.query, CANON_24_105.model);
      const grid = { lensHandle: lens.handle, width: 3000, height: 2000, focal: 24, crop: 1 };
      const heapBefore = module.HEAPF32!.buffer.byteLength;
      // 6 M nodes x 2 floats: more than the heap holds after start-up.
      const fine = client.buildCorrectionMaps({ ...grid, step: 1 });
      expect(module.HEAPF32!.buffer.byteLength).toBeGreaterThan(heapBefore);
      const coarse = client.buildCorrectionMaps({ ...grid, step: 16 });
      let differences = 0;
      for (let gy = 0; gy < coarse.gridHeight; gy++) {
        for (let gx = 0; gx < coarse.gridWidth; gx++) {
          const a = (gy * coarse.gridWidth + gx) * 2;
          const b = (nodeAt(gy, 16, grid.height) * fine.gridWidth + nodeAt(gx, 16, grid.width)) * 2;
          if (fine.geometry[b] !== coarse.geometry[a] || fine.geometry[b + 1] !== coarse.geometry[a + 1]) differences++;
        }
      }
      expect(differences).toBe(0);
    } finally {
      client.dispose();
    }
  });

  it('parses every database file', async () => {
    const { client, errors } = await startClient();
    try {
      // 0.1.3 failed 19 files with "Inappropriate context" (its element
      // stack moved the names the parser kept): 282 of 1558 lenses, among
      // them every Samyang SLR lens, and 272 of 1045 cameras.
      expect(errors.filter((message) => message.includes('[Lensfun]'))).toEqual([]);
      const samyang = client.searchLenses({ lensMaker: 'Samyang', lensModel: '10mm f/2.8 ED AS NCS CS', cameraMaker: 'Nikon Corporation', cameraModel: 'Nikon D7000' });
      expect(samyang.some((lens) => lens.model === 'Samyang 10mm f/2.8 ED AS NCS CS')).toBe(true);
    } finally {
      client.dispose();
    }
  });

  it('searches every mount when no camera model is given', async () => {
    const { client } = await startClient();
    try {
      // An empty camera model once stood for the first camera of the database.
      for (const query of [{ lensMaker: 'Canon', lensModel: 'EF 24-105mm f/4L IS USM' },
        { lensMaker: 'Canon', lensModel: 'EF 24-105mm f/4L IS USM', cameraMaker: 'Canon', cameraModel: '' }]) {
        expect(client.searchLenses(query).some((lens) => CANON_24_105.model.test(lens.model))).toBe(true);
      }
    } finally {
      client.dispose();
    }
  });

  it('builds distortion and TCA together, TCA taken at the distorted position', async () => {
    const { client } = await startClient();
    try {
      const lens = findLens(client, CANON_24_105.query, CANON_24_105.model);
      const width = 600;
      const height = 400;
      const grid: MapGridInput = { lensHandle: lens.handle, width, height, focal: 24, crop: 1, step: 8 };
      const maps = client.buildCorrectionMaps({ ...grid, includeTca: true });
      const nodes = maps.gridWidth * maps.gridHeight;
      const combined = client.buildSubpixelGeometryMap(grid);
      expect(combined.modifications).toBe(LF_MODIFY_DISTORTION | LF_MODIFY_TCA);
      expect([combined.gridWidth, combined.gridHeight, combined.step]).toEqual([maps.gridWidth, maps.gridHeight, maps.step]);
      expect(combined.coords.length).toBe(nodes * 6);
      expectFinite(combined.coords);
      // Green is the geometry map's position; red and blue add TCA's shift,
      // taken where the distortion correction reads (Lensfun's order).
      let greenOff = 0;
      let composeOff = 0;
      let tcaShift = 0;
      for (let node = 0; node < nodes; node++) {
        const gx = maps.geometry[node * 2];
        const gy = maps.geometry[node * 2 + 1];
        greenOff = Math.max(greenOff, Math.hypot(combined.coords[node * 6 + 2] - gx, combined.coords[node * 6 + 3] - gy));
        for (const c of [0, 2]) {
          const expected = sampleChannel(maps.tca!, maps, gx, gy, c);
          composeOff = Math.max(composeOff, Math.hypot(combined.coords[node * 6 + c * 2] - expected.x, combined.coords[node * 6 + c * 2 + 1] - expected.y));
          tcaShift = Math.max(tcaShift, Math.hypot(combined.coords[node * 6 + c * 2] - gx, combined.coords[node * 6 + c * 2 + 1] - gy));
        }
      }
      expect(greenOff).toBeLessThan(1e-3);
      expect(composeOff).toBeLessThan(0.02);
      expect(tcaShift).toBeGreaterThan(0.05);
      expect(tcaShift).toBeLessThan(2);
      // The combined red moves by the distortion too; the TCA map's does not.
      expect(largestShift(combined.coords, 6, 0, combined, width, height))
        .toBeGreaterThan(largestShift(maps.geometry, 2, 0, maps, width, height) - 2);
    } finally {
      client.dispose();
    }
  });

  it('builds vignetting gains without a geometry map, for a lens without distortion calibration too', async () => {
    const { client } = await startClient();
    try {
      // The gains buildCorrectionMaps gives with includeVignetting, alone.
      const canon = findLens(client, CANON_24_105.query, CANON_24_105.model);
      const grid: MapGridInput = { lensHandle: canon.handle, width: 600, height: 400, focal: 24, crop: 1, step: 8 };
      const maps = client.buildCorrectionMaps({ ...grid, includeVignetting: true, aperture: 8, distance: 1000 });
      const alone = client.buildVignettingMap({ ...grid, aperture: 8, distance: 1000 });
      expect([alone.gridWidth, alone.gridHeight, alone.step]).toEqual([maps.gridWidth, maps.gridHeight, maps.step]);
      expect(Buffer.from(alone.gains.buffer).equals(Buffer.from(maps.vignetting!.buffer))).toBe(true);

      // A lens with vignetting calibration only: buildCorrectionMaps fails
      // its geometry map, the gains alone build.
      const micro = findLens(client, NIKKOR_60_MICRO.query, NIKKOR_60_MICRO.model);
      expect(client.getAvailableModifications(micro.handle, 1) & (LF_MODIFY_DISTORTION | LF_MODIFY_TCA | LF_MODIFY_VIGNETTING))
        .toBe(LF_MODIFY_VIGNETTING);
      const microGrid: MapGridInput = { lensHandle: micro.handle, width: 450, height: 300, focal: 60, crop: 1, step: 6 };
      expect(() => client.buildCorrectionMaps({ ...microGrid, includeVignetting: true, aperture: 4 })).toThrow(/code -4/);
      const vignetting = client.buildVignettingMap({ ...microGrid, aperture: 4 });
      expect([vignetting.gridWidth, vignetting.gridHeight]).toEqual([Math.floor(449 / 6) + 1, Math.floor(299 / 6) + 1]);
      expect(vignetting.gains.length).toBe(vignetting.gridWidth * vignetting.gridHeight * 3);
      expectFinite(vignetting.gains);
      const centre = (Math.floor(vignetting.gridHeight / 2) * vignetting.gridWidth + Math.floor(vignetting.gridWidth / 2)) * 3;
      expect(vignetting.gains[1]).toBeGreaterThan(1.05);
      expect(Math.abs(vignetting.gains[centre + 1] - 1)).toBeLessThan(0.02);

      // A lens without vignetting calibration fails; the aperture is required.
      const plain = findLens(client, CANON_28_105.query, CANON_28_105.model);
      expect(() => client.buildVignettingMap({ lensHandle: plain.handle, width: 300, height: 200, focal: 28, crop: 1, step: 4, aperture: 8 }))
        .toThrow(/code -4/);
      expect(() => client.buildVignettingMap({ ...microGrid } as VignettingMapInput)).toThrow(/aperture is required/);
    } finally {
      client.dispose();
    }
  });

  it('builds grids that cover the frame', async () => {
    const { client } = await startClient();
    try {
      const lens = findLens(client, CANON_24_105.query, CANON_24_105.model);
      // 600 x 400 at step 8: by default nodes at 0-592 and 0-392, and the last
      // 7 columns and rows past them; covering, one more node each way, at
      // 600 and 400 (past the last pixel, 599 and 399).
      const width = 600;
      const height = 400;
      const grid: MapGridInput = { lensHandle: lens.handle, width, height, focal: 24, crop: 1, step: 8 };
      const all = { includeTca: true, includeVignetting: true, aperture: 8 };
      const plain = client.buildCorrectionMaps({ ...grid, ...all });
      const covered = client.buildCorrectionMaps({ ...grid, ...all, coverFrame: true });
      expect([plain.gridWidth, plain.gridHeight]).toEqual([75, 50]);
      expect([covered.gridWidth, covered.gridHeight, covered.step]).toEqual([76, 51, 8]);
      const subpixel = client.buildSubpixelGeometryMap({ ...grid, coverFrame: true });
      const gains = client.buildVignettingMap({ ...grid, aperture: 8, coverFrame: true });
      expect([subpixel.gridWidth, subpixel.gridHeight, gains.gridWidth, gains.gridHeight]).toEqual([76, 51, 76, 51]);
      const coveredMaps: [Float32Array, Float32Array, number][] = [
        [plain.geometry, covered.geometry, 2], [plain.tca!, covered.tca!, 6], [plain.vignetting!, covered.vignetting!, 3],
        [client.buildSubpixelGeometryMap(grid).coords, subpixel.coords, 6],
        [client.buildVignettingMap({ ...grid, aperture: 8 }).gains, gains.gains, 3]
      ];
      for (const [map, cover, stride] of coveredMaps) {
        expect(cover.length).toBe(76 * 51 * stride);
        expectFinite(cover);
        // The default grid's nodes, value for value.
        let differences = 0;
        for (let gy = 0; gy < 50; gy++) {
          for (let gx = 0; gx < 75; gx++) {
            for (let k = 0; k < stride; k++) {
              if (map[(gy * 75 + gx) * stride + k] !== cover[(gy * 76 + gx) * stride + k]) differences++;
            }
          }
        }
        expect(differences).toBe(0);
      }
      // The new nodes are Lensfun's values at node * step, as a covering
      // grid at step 4 has them (600 = 150 x 4, 400 = 100 x 4).
      const half = client.buildSubpixelGeometryMap({ ...grid, step: 4, coverFrame: true });
      expect([half.gridWidth, half.gridHeight]).toEqual([151, 101]);
      let edgeDifferences = 0;
      for (let gy = 0; gy < 51; gy++) {
        for (let gx = 0; gx < 76; gx++) {
          if (gx < 75 && gy < 50) continue;
          for (let k = 0; k < 6; k++) {
            if (subpixel.coords[(gy * 76 + gx) * 6 + k] !== half.coords[(gy * 2 * 151 + gx * 2) * 6 + k]) edgeDifferences++;
          }
        }
      }
      expect(edgeDifferences).toBe(0);
      // Every pixel lies between nodes: the covering grid interpolates to
      // Lensfun's own positions (its map at step 1) within 0.02 px at every
      // pixel; the default grid, held at its last node past it, is several
      // pixels off at the corner.
      const exact = client.buildSubpixelGeometryMap({ ...grid, step: 1 });
      const sample = (map: Float32Array, at: { gridWidth: number; gridHeight: number; step: number }, x: number, y: number, k: number) => {
        const gx = x / at.step;
        const gy = y / at.step;
        const x0 = Math.min(Math.floor(gx), at.gridWidth - 1);
        const y0 = Math.min(Math.floor(gy), at.gridHeight - 1);
        const x1 = Math.min(x0 + 1, at.gridWidth - 1);
        const y1 = Math.min(y0 + 1, at.gridHeight - 1);
        const fx = Math.min(gx - x0, 1);
        const fy = Math.min(gy - y0, 1);
        const node = (ix: number, iy: number) => map[(iy * at.gridWidth + ix) * 6 + k];
        return (node(x0, y0) * (1 - fx) + node(x1, y0) * fx) * (1 - fy) + (node(x0, y1) * (1 - fx) + node(x1, y1) * fx) * fy;
      };
      const defaultGrid = client.buildSubpixelGeometryMap(grid);
      let coveredError = 0;
      let defaultError = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          for (let c = 0; c < 3; c++) {
            const i = (y * width + x) * 6 + c * 2;
            const ex = exact.coords[i];
            const ey = exact.coords[i + 1];
            coveredError = Math.max(coveredError, Math.hypot(sample(subpixel.coords, subpixel, x, y, c * 2) - ex, sample(subpixel.coords, subpixel, x, y, c * 2 + 1) - ey));
            defaultError = Math.max(defaultError, Math.hypot(sample(defaultGrid.coords, defaultGrid, x, y, c * 2) - ex, sample(defaultGrid.coords, defaultGrid, x, y, c * 2 + 1) - ey));
          }
        }
      }
      expect(coveredError).toBeLessThan(0.02);
      expect(defaultError).toBeGreaterThan(5);
      // A frame whose sides step divides: the same grid either way.
      const even = { ...grid, width: 601, height: 401 };
      const evenCovered = client.buildCorrectionMaps({ ...even, coverFrame: true });
      expect([evenCovered.gridWidth, evenCovered.gridHeight]).toEqual([76, 51]);
      expect(Buffer.from(evenCovered.geometry.buffer).equals(Buffer.from(client.buildCorrectionMaps(even).geometry.buffer))).toBe(true);
    } finally {
      client.dispose();
    }
  });

  it('refuses coverFrame with a core that cannot build it', async () => {
    const errors: string[] = [];
    const factory = nodeModuleFactory(() => {}, errors);
    // A core before 0.1.4: no lfw_grid_flags, the default grid only.
    const client = await createLensfun({
      moduleFactory: async (options) => {
        const module = await factory(options);
        delete module._lfw_grid_flags;
        return module;
      }
    });
    try {
      const lens = findLens(client, CANON_24_105.query, CANON_24_105.model);
      const grid: MapGridInput = { lensHandle: lens.handle, width: 120, height: 80, focal: 24, crop: 1, step: 8 };
      expect(() => client.buildCorrectionMaps({ ...grid, coverFrame: true })).toThrow(/covers the frame/);
      expect(() => client.buildSubpixelGeometryMap({ ...grid, coverFrame: true })).toThrow(/covers the frame/);
      expect(() => client.buildVignettingMap({ ...grid, aperture: 8, coverFrame: true })).toThrow(/covers the frame/);
      expect(client.buildCorrectionMaps(grid).gridWidth).toBe(15);
    } finally {
      client.dispose();
    }
  });

  it('gives a lens without TCA calibration its distortion in the combined map', async () => {
    const { client } = await startClient();
    try {
      const lens = findLens(client, NIKKOR_18_55.query, NIKKOR_18_55.model);
      const grid: MapGridInput = { lensHandle: lens.handle, width: 450, height: 300, focal: 18, crop: 1.528, step: 6 };
      const maps = client.buildCorrectionMaps(grid);
      const combined = client.buildSubpixelGeometryMap(grid);
      expect(combined.modifications).toBe(LF_MODIFY_DISTORTION);
      let differences = 0;
      for (let node = 0; node < maps.gridWidth * maps.gridHeight; node++) {
        for (let c = 0; c < 3; c++) {
          if (combined.coords[node * 6 + c * 2] !== maps.geometry[node * 2]
            || combined.coords[node * 6 + c * 2 + 1] !== maps.geometry[node * 2 + 1]) differences++;
        }
      }
      expect(differences).toBe(0);
    } finally {
      client.dispose();
    }
  });
});
