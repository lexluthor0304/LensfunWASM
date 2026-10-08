# lensfun-wasm

语言： [English](./README.md) | **简体中文** | [日本語](./README.ja.md)

将 [Lensfun](https://github.com/lensfun/lensfun) 编译为 WebAssembly，并提供适合前端直接调用的 JavaScript API。

## 项目概览

`lensfun-wasm` 包含：

- 以固定 commit 方式接入的 `lensfun` 上游源码（git submodule）
- 完整官方镜头数据库（`data/db`，打包进 `.data`）
- 稳定的 C 层 wasm 导出接口
- 高层 TypeScript API
- 同时支持 npm（ESM）和 CDN（UMD）

## 能做什么

- 在浏览器内初始化 Lensfun 数据库
- 搜索镜头与机身
- 生成以下矫正映射（map）：
  - 几何/畸变
  - TCA（横向色差）
  - 畸变与 TCA 一并校正（按通道的一张映射，按 Lensfun 的校正顺序）
  - 暗角（vignetting）

输出数据可直接用于 WebGL/WebGPU/canvas 的重映射流程。

## 目录结构

- `third_party/lensfun`：上游源码子模块
- `native/`：wasm bridge、GLib 兼容层、CMake 构建
- `src/`：TS 对外 API
- `scripts/build-wasm.sh`：wasm 构建入口
- `dist/assets/`：生成的 `lensfun-core.js/.wasm/.data`

## 环境要求

### 运行时（仅使用包）

- 支持 WebAssembly 的现代浏览器

### 源码构建

- Node.js 22+
- npm 10+
- CMake 3.20+
- Emscripten（`emcc`、`emcmake` 可用；CI 与发布使用 6.0.4 构建）

## 安装

```bash
npm install @neoanaloglabkk/lensfun-wasm
```

## 快速开始（打包器）

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

## 快速开始（CDN）

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

## API 说明

## `createLensfun(options?) => Promise<LensfunClient>`

`options`（`LensfunInitOptions`）字段：

- `moduleFactory?: (opts) => Promise<LensfunModule>`
  - 打包器场景推荐。通常来自 `import createLensfunCoreModule from '@neoanaloglabkk/lensfun-wasm/core'`。
- `moduleJsUrl?: string`
  - 动态加载 `lensfun-core.js` 的备用方式。
- `wasmUrl?: string`
  - 显式指定 `lensfun-core.wasm` 地址。
- `dataUrl?: string`
  - 显式指定 `lensfun-core.data` 地址。
- `locateFile?: (path, prefix) => string`
  - 完整覆盖 Emscripten 资源定位逻辑。
- `dbPath?: string`
  - Emscripten 文件系统中的数据库路径，默认 `/lensfun-db`。
- `autoInitDb?: boolean`
  - 默认 `true`，设为 `false` 可跳过初始化。

## `LensfunClient`

### `searchLenses(input) => LensMatch[]`

`SearchLensesInput`：

- `lensModel`（必填）
- `lensMaker?`
- `cameraMaker?`
- `cameraModel?`
- `searchFlags?`（默认 `LF_SEARCH_SORT_AND_UNIQUIFY`）

返回 `LensMatch[]`：

- `handle`（后续生成 map 需要）
- `maker`、`model`、`score`
- `minFocal`、`maxFocal`、`minAperture`、`maxAperture`、`cropFactor`

### `searchCameras(input) => CameraMatch[]`

`SearchCamerasInput`：

- `maker?`
- `model?`
- `searchFlags?`

返回 `CameraMatch[]`，字段包含 `maker/model/variant/mount/cropFactor/score`。

### `getAvailableModifications(lensHandle, crop) => number`

返回 Lensfun 的 `LF_MODIFY_*` 位标志。

### `buildCorrectionMaps(input) => CorrectionMaps`

`CorrectionInput`：

- `lensHandle`（必填）
- `width`、`height`（必填，正整数）
- `focal`、`crop`（必填）
- `step?`（默认 `1`）
- `reverse?`（默认 `false`）
- `includeTca?`（默认 `false`）
- `includeVignetting?`（默认 `false`）
- `aperture?`（当 `includeVignetting = true` 时必填）
- `distance?`（默认 `1000`）

`CorrectionMaps`：

- `gridWidth`、`gridHeight`、`step`
- `geometry: Float32Array` 长度 = `gridW * gridH * 2`
  - 布局：`[x0, y0, x1, y1, ...]`
- `tca?: Float32Array` 长度 = `gridW * gridH * 6`
  - 布局：`[rx, ry, gx, gy, bx, by, ...]`
- `vignetting?: Float32Array` 长度 = `gridW * gridH * 3`
  - 布局：`[rGain, gGain, bGain, ...]`

`tca` 仅由 TCA 校正生成，其坐标不含畸变校正。需要同时校正时请使用 `buildSubpixelGeometryMap`。

### `buildSubpixelGeometryMap(input) => SubpixelGeometryMap`

一并校正畸变与 TCA 的映射，顺序与 Lensfun 一步完成时相同（`ApplySubpixelGeometryDistortion`：先做畸变校正，再在畸变后的位置做 TCA 校正）。

`MapGridInput`：`lensHandle`、`width`、`height`、`focal`、`crop`、`step?`、`reverse?`（与 `buildCorrectionMaps` 相同）

`SubpixelGeometryMap`：

- `gridWidth`、`gridHeight`、`step`
- `coords: Float32Array` 长度 = `gridW * gridH * 6`
  - 布局：`[rx, ry, gx, gy, bx, by, ...]`
- `modifications`：实际应用的校正（`LF_MODIFY_DISTORTION`、`LF_MODIFY_TCA`）。没有 TCA 标定的镜头三个通道都只做畸变校正；两者都没有的镜头会抛出错误（代码 `-4`）。

### `dispose()`

释放原生数据库内存。完成后建议调用。

## 导出常量

搜索相关：

- `LF_SEARCH_LOOSE = 1`
- `LF_SEARCH_SORT_AND_UNIQUIFY = 2`

矫正能力位标志：

- `LF_MODIFY_TCA = 0x00000001`
- `LF_MODIFY_VIGNETTING = 0x00000002`
- `LF_MODIFY_DISTORTION = 0x00000008`
- `LF_MODIFY_GEOMETRY = 0x00000010`
- `LF_MODIFY_SCALE = 0x00000020`
- `LF_MODIFY_PERSPECTIVE = 0x00000040`

## 从源码构建

```bash
# 1) 安装依赖
npm install

# 2) 确保 emcc/emcmake 可用
#    例如：source /path/to/emsdk/emsdk_env.sh

# 3) 构建 wasm + js + 类型声明
npm run build
```

`npm run build` 包含：

1. `npm run build:wasm`
2. `npm run build:js`
3. `npm run build:types`

输出产物：

- `dist/assets/lensfun-core.js`
- `dist/assets/lensfun-core.wasm`
- `dist/assets/lensfun-core.data`
- `dist/esm/index.js`
- `dist/umd/index.iife.js`
- `dist/types/index.d.ts`

## 本地检查

```bash
npm run check
```

包含：

- JS 打包
- 类型声明生成
- Vitest 单测

## 上游同步策略

- Lensfun 通过 submodule 固定 commit 管理。
- 手动升级，不自动追踪。

同步命令：

```bash
scripts/sync-upstream.sh origin/master
```

升级后请执行：

1. 重新构建 wasm
2. 跑测试
3. 更新 `UPSTREAM.md`

## 常见问题

### `emcc not found`

未安装或未激活 emsdk。请在当前 shell 中激活后再构建。

### `module factory not found`

没有提供 `moduleFactory`，也没有预加载 `dist/assets/lensfun-core.js`。

### `lfw_init failed with code ...`

数据库文件路径或 `.data` 加载不正确。

- 检查 `dataUrl` 是否指向 `lensfun-core.data`
- 检查 `dbPath` 是否与预加载路径一致（默认 `/lensfun-db`）

### `the core module exports no HEAPF32 view`

核心（`lensfun-core.js`）比 JS API 旧：0.1.4 之前的核心没有导出 `HEAPF32`。请加载同一版本的核心。

### `native map builder failed with code ...`

通常是输入参数问题或镜头标定数据不匹配。

- `lensHandle` 必须来自当前实例的 `searchLenses`
- `width/height/step` 需合法
- 请求暗角 map 时必须提供 `aperture`

## 许可证

- Lensfun 核心库：LGPL-3.0-or-later
- Lensfun 数据库：CC BY-SA 3.0
- tinyxml2：zlib
- utf8proc：MIT

详见：

- [NOTICE.md](./NOTICE.md)
- [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)
- [UPSTREAM.md](./UPSTREAM.md)
