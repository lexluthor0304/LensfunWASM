# lensfun-wasm

Language: **English** | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md)

Compile [Lensfun](https://github.com/lensfun/lensfun) into WebAssembly and expose a frontend-friendly JavaScript API.

## Overview

`lensfun-wasm` ships:

- Upstream `lensfun` source as a pinned git submodule
- Full official lens database (`data/db`) packaged into `.data`
- A C bridge layer for stable wasm exports
- A high-level TypeScript API for browser applications
- ESM and UMD bundles for npm and CDN usage

## What You Can Do

- Initialize Lensfun database in browser
- Search lenses and cameras
- Build correction maps for:
  - Geometry/distortion
  - TCA (transverse chromatic aberration)
  - Vignetting

The output maps are designed for WebGL/WebGPU/canvas remap pipelines.

## Project Layout

- `third_party/lensfun`: upstream source (submodule)
- `native/`: wasm bridge, GLib compatibility, native CMake build
- `src/`: public TypeScript API
- `scripts/build-wasm.sh`: wasm build entry
- `dist/assets/`: generated `lensfun-core.js/.wasm/.data`

## Requirements

### Runtime (using package)

- Modern browser with WebAssembly support

### Build from source

- Node.js 22+
- npm 10+
- CMake 3.20+
- Emscripten (`emcc`, `emcmake` in PATH); CI and releases build with 6.0.4

## Installation

```bash
npm install @neoanaloglabkk/lensfun-wasm
```

## Quick Start (Bundler)

```ts
import { createLensfun } from '@neoanaloglabkk/lensfun-wasm';
import createLensfunCoreModule from '@neoanaloglabkk/lensfun-wasm/core';
import wasmUrl from '@neoanaloglabkk/lensfun-wasm/core-wasm?url';
import dataUrl from '@neoanaloglabkk/lensfun-wasm/core-data?url';

const client = await createLensfun({
  moduleFactory: createLensfunCoreModule,
  wasmUrl,
  dataUrl
});

const lenses = client.searchLenses({
  lensModel: 'pEntax 50-200 ED'
});

console.log(lenses[0]);
```

## Quick Start (CDN)

```html
<script src="https://cdn.jsdelivr.net/npm/@neoanaloglabkk/lensfun-wasm@0.1.2/dist/assets/lensfun-core.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@neoanaloglabkk/lensfun-wasm@0.1.2/dist/umd/index.iife.js"></script>
<script>
(async () => {
  const client = await LensfunWasm.createLensfun();
  const lenses = client.searchLenses({ lensModel: 'pEntax 50-200 ED' });
  console.log(lenses[0]);
})();
</script>
```

## API Reference

## `createLensfun(options?) => Promise<LensfunClient>`

`options` (`LensfunInitOptions`):

- `moduleFactory?: (opts) => Promise<LensfunModule>`
  - Recommended in bundlers. Usually from `import createLensfunCoreModule from '@neoanaloglabkk/lensfun-wasm/core'`.
- `moduleJsUrl?: string`
  - Optional fallback URL for loading `lensfun-core.js` dynamically.
- `wasmUrl?: string`
  - Explicit URL for `lensfun-core.wasm`.
- `dataUrl?: string`
  - Explicit URL for `lensfun-core.data`.
- `locateFile?: (path, prefix) => string`
  - Full override for Emscripten file resolution.
- `dbPath?: string`
  - Database path in Emscripten FS. Default `/lensfun-db`.
- `autoInitDb?: boolean`
  - Default `true`. If false, db init is skipped.

## `LensfunClient`

### `searchLenses(input) => LensMatch[]`

`SearchLensesInput`:

- `lensModel` (required)
- `lensMaker?`
- `cameraMaker?`
- `cameraModel?`
- `searchFlags?` (default `LF_SEARCH_SORT_AND_UNIQUIFY`)

Returns `LensMatch[]`:

- `handle` (native lens handle for map generation)
- `maker`, `model`, `score`
- `minFocal`, `maxFocal`, `minAperture`, `maxAperture`, `cropFactor`

### `searchCameras(input) => CameraMatch[]`

`SearchCamerasInput`:

- `maker?`
- `model?`
- `searchFlags?`

Returns `CameraMatch[]` with `maker/model/variant/mount/cropFactor/score`.

### `getAvailableModifications(lensHandle, crop) => number`

Returns bit flags from Lensfun (`LF_MODIFY_*`).

### `buildCorrectionMaps(input) => CorrectionMaps`

`CorrectionInput`:

- `lensHandle` (required)
- `width`, `height` (required, positive integers)
- `focal`, `crop` (required)
- `step?` (default `1`)
- `reverse?` (default `false`)
- `includeTca?` (default `false`)
- `includeVignetting?` (default `false`)
- `aperture?` (required when `includeVignetting = true`)
- `distance?` (default `1000`)

`CorrectionMaps`:

- `gridWidth`, `gridHeight`, `step`
- `geometry: Float32Array` length = `gridW * gridH * 2`
  - Layout: `[x0, y0, x1, y1, ...]`
- `tca?: Float32Array` length = `gridW * gridH * 6`
  - Layout: `[rx, ry, gx, gy, bx, by, ...]`
- `vignetting?: Float32Array` length = `gridW * gridH * 3`
  - Layout: `[rGain, gGain, bGain, ...]`

### `dispose()`

Releases native database memory. Call this when finished.

## Exported Constants

Search:

- `LF_SEARCH_LOOSE = 1`
- `LF_SEARCH_SORT_AND_UNIQUIFY = 2`

Modification flags:

- `LF_MODIFY_TCA = 0x00000001`
- `LF_MODIFY_VIGNETTING = 0x00000002`
- `LF_MODIFY_DISTORTION = 0x00000008`
- `LF_MODIFY_GEOMETRY = 0x00000010`
- `LF_MODIFY_SCALE = 0x00000020`
- `LF_MODIFY_PERSPECTIVE = 0x00000040`

## Build From Source

```bash
# 1) install dependencies
npm install

# 2) make sure emcc/emcmake are in PATH
#    (example)
#    source /path/to/emsdk/emsdk_env.sh

# 3) build wasm + js + d.ts
npm run build
```

`npm run build` steps:

1. `npm run build:wasm`
2. `npm run build:js`
3. `npm run build:types`

Output:

- `dist/assets/lensfun-core.js`
- `dist/assets/lensfun-core.wasm`
- `dist/assets/lensfun-core.data`
- `dist/esm/index.js`
- `dist/umd/index.iife.js`
- `dist/types/index.d.ts`

## Local Validation

```bash
npm run check
```

Includes:

- JS bundle build
- Type declaration build
- Vitest unit tests

## Upstream Sync Policy

- Lensfun is tracked by pinned submodule commit.
- Upgrade manually (no auto tracking).

Sync helper:

```bash
scripts/sync-upstream.sh origin/master
```

After bumping upstream:

1. Rebuild wasm
2. Run tests
3. Update `UPSTREAM.md`

## Troubleshooting

### `emcc not found`

Install and activate emsdk, then re-run build in the same shell session.

### `module factory not found`

Provide `moduleFactory` or pre-load `dist/assets/lensfun-core.js` so `createLensfunCoreModule` exists.

### `lfw_init failed with code ...`

Database path or `.data` load is wrong.

- Ensure `dataUrl` points to `lensfun-core.data`
- Ensure `dbPath` matches preloaded path (`/lensfun-db` by default)

### `the core module exports no HEAPF32 view`

The core (`lensfun-core.js`) is older than the JS API: cores before 0.1.4 do not export `HEAPF32`. Load the core of the same release.

### `native map builder failed with code ...`

Input validation or Lensfun calibration mismatch.

- Check `lensHandle` comes from latest `searchLenses`
- Verify `width/height/step` are valid
- Provide `aperture` when requesting vignetting

## License

- Lensfun core library: LGPL-3.0-or-later
- Lensfun database: CC BY-SA 3.0
- tinyxml2: zlib license
- utf8proc: MIT license

See:

- [NOTICE.md](./NOTICE.md)
- [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)
- [UPSTREAM.md](./UPSTREAM.md)
