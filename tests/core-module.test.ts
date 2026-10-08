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
  type SearchLensesInput
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

// The pixel position a node stands for (lfw_*: index * step, clamped).
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
});
