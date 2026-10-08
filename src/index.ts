export const LF_SEARCH_LOOSE = 1;
export const LF_SEARCH_SORT_AND_UNIQUIFY = 2;

export const LF_MODIFY_TCA = 0x00000001;
export const LF_MODIFY_VIGNETTING = 0x00000002;
export const LF_MODIFY_DISTORTION = 0x00000008;
export const LF_MODIFY_GEOMETRY = 0x00000010;
export const LF_MODIFY_SCALE = 0x00000020;
export const LF_MODIFY_PERSPECTIVE = 0x00000040;

export interface LensfunModule {
  cwrap: (ident: string, returnType: string | null, argTypes: string[]) => (...args: unknown[]) => unknown;
  UTF8ToString: (ptr: number) => string;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  /**
   * The core's float view of its memory, which the map builders copy from.
   * Cores built before 0.1.4 do not export it (newer Emscripten releases put
   * no HEAP views on Module unless asked), and their maps cannot be read.
   */
  HEAPF32?: Float32Array;
}

export interface LensfunInitOptions {
  moduleFactory?: (options?: Record<string, unknown>) => Promise<LensfunModule>;
  moduleJsUrl?: string;
  wasmUrl?: string;
  dataUrl?: string;
  locateFile?: (path: string, prefix: string) => string;
  dbPath?: string;
  autoInitDb?: boolean;
}

export interface LensMatch {
  handle: number;
  maker: string;
  model: string;
  score: number;
  minFocal: number;
  maxFocal: number;
  minAperture: number;
  maxAperture: number;
  cropFactor: number;
}

export interface CameraMatch {
  maker: string;
  model: string;
  variant: string;
  mount: string;
  cropFactor: number;
  score: number;
}

export interface SearchLensesInput {
  lensMaker?: string;
  lensModel: string;
  cameraMaker?: string;
  cameraModel?: string;
  searchFlags?: number;
}

export interface SearchCamerasInput {
  maker?: string;
  model?: string;
  searchFlags?: number;
}

export interface MapGridInput {
  lensHandle: number;
  width: number;
  height: number;
  focal: number;
  crop: number;
  step?: number;
  reverse?: boolean;
}

export interface CorrectionInput extends MapGridInput {
  includeTca?: boolean;
  includeVignetting?: boolean;
  aperture?: number;
  distance?: number;
}

export interface CorrectionMaps {
  gridWidth: number;
  gridHeight: number;
  step: number;
  geometry: Float32Array;
  tca?: Float32Array;
  vignetting?: Float32Array;
}

export interface SubpixelGeometryMap {
  gridWidth: number;
  gridHeight: number;
  step: number;
  /**
   * Per grid node, the source x, y of red, green and blue with distortion and
   * TCA corrected together: [rx, ry, gx, gy, bx, by, ...].
   */
  coords: Float32Array;
  /** The corrections applied: LF_MODIFY_DISTORTION and/or LF_MODIFY_TCA. */
  modifications: number;
}

type CFn = (...args: unknown[]) => unknown;

interface NativeFns {
  init: CFn;
  dispose: CFn;
  findLensesJson: CFn;
  findCamerasJson: CFn;
  availableMods: CFn;
  buildGeometryMap: CFn;
  buildTcaMap: CFn;
  buildSubpixelGeometryMap: CFn;
  buildVignettingMap: CFn;
  freePtr: CFn;
}

const globalScope = globalThis as Record<string, unknown>;

function requiredString(value: string | undefined, field: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`[lensfun-wasm] ${field} is required`);
  }
  return value;
}

function toFlag(value: boolean | undefined): number {
  return value ? 1 : 0;
}

function toGrid(size: number, step: number): number {
  return Math.floor((size - 1) / step) + 1;
}

function requirePositiveInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[lensfun-wasm] ${field} must be a positive integer`);
  }
  return value;
}

async function loadScript(url: string): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('[lensfun-wasm] moduleJsUrl in non-browser runtime requires moduleFactory instead');
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`[lensfun-wasm] failed to load ${url}`));
    document.head.appendChild(script);
  });
}

async function resolveFactory(options: LensfunInitOptions): Promise<LensfunInitOptions['moduleFactory']> {
  if (options.moduleFactory) {
    return options.moduleFactory;
  }

  const existing = globalScope.createLensfunCoreModule;
  if (typeof existing === 'function') {
    return existing as LensfunInitOptions['moduleFactory'];
  }

  if (options.moduleJsUrl) {
    if (typeof document !== 'undefined') {
      await loadScript(options.moduleJsUrl);
      const globalFactory = globalScope.createLensfunCoreModule;
      if (typeof globalFactory === 'function') {
        return globalFactory as LensfunInitOptions['moduleFactory'];
      }
    } else {
      const imported = await import(/* @vite-ignore */ options.moduleJsUrl);
      const loaded =
        (imported as Record<string, unknown>).default ??
        (imported as Record<string, unknown>).createLensfunCoreModule;
      if (typeof loaded === 'function') {
        return loaded as LensfunInitOptions['moduleFactory'];
      }
    }
  }

  throw new Error(
    '[lensfun-wasm] module factory not found. Provide moduleFactory or preload dist/assets/lensfun-core.js (global createLensfunCoreModule).'
  );
}

function makeLocateFile(options: LensfunInitOptions): (path: string, prefix: string) => string {
  return (path: string, prefix: string) => {
    if (options.locateFile) {
      return options.locateFile(path, prefix);
    }

    if (path.endsWith('.wasm') && options.wasmUrl) {
      return options.wasmUrl;
    }

    if (path.endsWith('.data') && options.dataUrl) {
      return options.dataUrl;
    }

    return `${prefix}${path}`;
  };
}

function parseJsonPtr<T>(module: LensfunModule, freePtr: CFn, ptr: number): T[] {
  if (!ptr) {
    return [];
  }

  const raw = module.UTF8ToString(ptr);
  freePtr(ptr);
  if (!raw) {
    return [];
  }
  return JSON.parse(raw) as T[];
}

function bindFns(module: LensfunModule): NativeFns {
  return {
    init: module.cwrap('lfw_init', 'number', ['string']),
    dispose: module.cwrap('lfw_dispose', null, []),
    findLensesJson: module.cwrap('lfw_find_lenses_json', 'number', ['string', 'string', 'string', 'string', 'number']),
    findCamerasJson: module.cwrap('lfw_find_cameras_json', 'number', ['string', 'string', 'number']),
    availableMods: module.cwrap('lfw_available_mods', 'number', ['number', 'number']),
    buildGeometryMap: module.cwrap('lfw_build_geometry_map', 'number', [
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number'
    ]),
    buildTcaMap: module.cwrap('lfw_build_tca_map', 'number', [
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number'
    ]),
    buildSubpixelGeometryMap: module.cwrap('lfw_build_subpixel_geometry_map', 'number', [
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number'
    ]),
    buildVignettingMap: module.cwrap('lfw_build_vignetting_map', 'number', [
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number'
    ]),
    freePtr: module.cwrap('lfw_free', null, ['number'])
  };
}

export class LensfunClient {
  private readonly module: LensfunModule;
  private readonly fns: NativeFns;
  private disposed = false;

  constructor(module: LensfunModule, fns: NativeFns) {
    this.module = module;
    this.fns = fns;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.fns.dispose();
    this.disposed = true;
  }

  searchLenses(input: SearchLensesInput): LensMatch[] {
    this.ensureAlive();
    const lensModel = requiredString(input.lensModel, 'lensModel');
    const ptr = this.fns.findLensesJson(
      input.cameraMaker ?? '',
      input.cameraModel ?? '',
      input.lensMaker ?? '',
      lensModel,
      input.searchFlags ?? LF_SEARCH_SORT_AND_UNIQUIFY
    ) as number;
    return parseJsonPtr<LensMatch>(this.module, this.fns.freePtr, ptr);
  }

  searchCameras(input: SearchCamerasInput): CameraMatch[] {
    this.ensureAlive();
    const ptr = this.fns.findCamerasJson(
      input.maker ?? '',
      input.model ?? '',
      input.searchFlags ?? 0
    ) as number;
    return parseJsonPtr<CameraMatch>(this.module, this.fns.freePtr, ptr);
  }

  getAvailableModifications(lensHandle: number, crop: number): number {
    this.ensureAlive();
    return this.fns.availableMods(lensHandle, crop) as number;
  }

  buildCorrectionMaps(input: CorrectionInput): CorrectionMaps {
    this.ensureAlive();

    const width = requirePositiveInt(input.width, 'width');
    const height = requirePositiveInt(input.height, 'height');
    const step = requirePositiveInt(input.step ?? 1, 'step');

    const gridWidth = toGrid(width, step);
    const gridHeight = toGrid(height, step);

    const geometry = this.runFloatMap(
      gridWidth * gridHeight * 2,
      this.fns.buildGeometryMap,
      input.lensHandle,
      input.focal,
      input.crop,
      width,
      height,
      toFlag(input.reverse),
      step
    );

    const result: CorrectionMaps = {
      gridWidth,
      gridHeight,
      step,
      geometry
    };

    if (input.includeTca) {
      result.tca = this.runFloatMap(
        gridWidth * gridHeight * 6,
        this.fns.buildTcaMap,
        input.lensHandle,
        input.focal,
        input.crop,
        width,
        height,
        toFlag(input.reverse),
        step
      );
    }

    if (input.includeVignetting) {
      if (typeof input.aperture !== 'number') {
        throw new Error('[lensfun-wasm] aperture is required for vignetting map');
      }
      result.vignetting = this.runFloatMap(
        gridWidth * gridHeight * 3,
        this.fns.buildVignettingMap,
        input.lensHandle,
        input.focal,
        input.crop,
        input.aperture,
        input.distance ?? 1000,
        width,
        height,
        toFlag(input.reverse),
        step
      );
    }

    return result;
  }

  /**
   * Distortion and TCA corrected together, in one map: Lensfun's
   * ApplySubpixelGeometryDistortion, which moves every channel by the
   * distortion correction and then red and blue by the TCA correction at
   * that distorted position. Use it instead of combining `geometry` and
   * `tca` from buildCorrectionMaps: `tca` is built with TCA correction alone,
   * so its coordinates carry no distortion.
   *
   * A lens without TCA calibration gets its distortion correction for all
   * three channels (`modifications` then lacks LF_MODIFY_TCA); one with
   * neither calibration throws (code -4).
   */
  buildSubpixelGeometryMap(input: MapGridInput): SubpixelGeometryMap {
    this.ensureAlive();

    const width = requirePositiveInt(input.width, 'width');
    const height = requirePositiveInt(input.height, 'height');
    const step = requirePositiveInt(input.step ?? 1, 'step');

    const gridWidth = toGrid(width, step);
    const gridHeight = toGrid(height, step);

    const { rc, values } = this.callFloatMap(
      gridWidth * gridHeight * 6,
      this.fns.buildSubpixelGeometryMap,
      [input.lensHandle, input.focal, input.crop, width, height, toFlag(input.reverse), step],
      (code) => code > 0
    );

    return {
      gridWidth,
      gridHeight,
      step,
      coords: values,
      modifications: rc
    };
  }

  private runFloatMap(size: number, fn: CFn, ...args: number[]): Float32Array {
    return this.callFloatMap(size, fn, args, (code) => code === 0).values;
  }

  private callFloatMap(
    size: number,
    fn: CFn,
    args: number[],
    succeeded: (code: number) => boolean
  ): { rc: number; values: Float32Array } {
    const bytes = size * 4;
    const ptr = this.module._malloc(bytes);
    try {
      const rc = fn(...args, ptr, size) as number;
      if (!succeeded(rc)) {
        throw new Error(`[lensfun-wasm] native map builder failed with code ${rc}`);
      }

      // Read after the call: memory growth replaces the view.
      const heap = this.module.HEAPF32;
      if (!heap) {
        throw new Error('[lensfun-wasm] the core module exports no HEAPF32 view; rebuild it with HEAPF32 in EXPORTED_RUNTIME_METHODS');
      }
      const start = ptr >> 2;
      const end = start + size;
      const values = new Float32Array(size);
      values.set(heap.subarray(start, end));
      return { rc, values };
    } finally {
      this.module._free(ptr);
    }
  }

  private ensureAlive(): void {
    if (this.disposed) {
      throw new Error('[lensfun-wasm] LensfunClient is disposed');
    }
  }
}

export async function createLensfun(options: LensfunInitOptions = {}): Promise<LensfunClient> {
  const factory = await resolveFactory(options);
  if (!factory) {
    throw new Error('[lensfun-wasm] failed to resolve module factory');
  }

  const module = await factory({
    locateFile: makeLocateFile(options)
  });

  const fns = bindFns(module);

  if (options.autoInitDb ?? true) {
    const dbPath = options.dbPath ?? '/lensfun-db';
    const rc = fns.init(dbPath) as number;
    if (rc !== 0) {
      throw new Error(`[lensfun-wasm] lfw_init failed with code ${rc} for ${dbPath}`);
    }
  }

  return new LensfunClient(module, fns);
}
