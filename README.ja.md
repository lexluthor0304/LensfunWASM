# lensfun-wasm

言語: [English](./README.md) | [简体中文](./README.zh-CN.md) | **日本語**

[Lensfun](https://github.com/lensfun/lensfun) を WebAssembly にコンパイルし、フロントエンドで使いやすい JavaScript API を提供します。

## 概要

`lensfun-wasm` には以下が含まれます。

- 固定コミットで管理された `lensfun` 上流ソース（git submodule）
- 公式の完全なレンズ DB（`data/db`、`.data` に同梱）
- 安定した C ブリッジの wasm エクスポート
- 高レベル TypeScript API
- npm（ESM）と CDN（UMD）の両対応

## できること

- ブラウザ内で Lensfun DB を初期化
- レンズ/カメラ検索
- 以下の補正マップ生成
  - 幾何/歪み
  - TCA（倍率色収差）
  - 歪みと TCA の同時補正（チャンネル別の 1 つのマップ、Lensfun の補正順）
  - 周辺減光（vignetting。歪みのキャリブレーションがないレンズ向けに単独でも生成可）

出力マップは WebGL/WebGPU/canvas のリマップ処理に利用できます。

## ディレクトリ構成

- `third_party/lensfun`: 上流ソース submodule
- `native/`: wasm bridge、GLib 互換層、CMake ビルド
- `src/`: 公開 TS API
- `scripts/build-wasm.sh`: wasm ビルド入口
- `dist/assets/`: 生成物 `lensfun-core.js/.wasm/.data`

## 必要環境

### 実行時（パッケージ利用のみ）

- WebAssembly 対応のモダンブラウザ

### ソースビルド

- Node.js 22+
- npm 10+
- CMake 3.20+
- Emscripten（`emcc`、`emcmake` が PATH にあること。CI とリリースは 6.0.4 でビルド）

## インストール

```bash
npm install @neoanaloglabkk/lensfun-wasm
```

## クイックスタート（バンドラ）

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

## クイックスタート（CDN）

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

## API リファレンス

## `createLensfun(options?) => Promise<LensfunClient>`

`options`（`LensfunInitOptions`）:

- `moduleFactory?: (opts) => Promise<LensfunModule>`
  - バンドラ利用時の推奨。通常 `import createLensfunCoreModule from '@neoanaloglabkk/lensfun-wasm/core'`。
- `moduleJsUrl?: string`
  - `lensfun-core.js` の動的ロード URL。
- `wasmUrl?: string`
  - `lensfun-core.wasm` の明示 URL。
- `dataUrl?: string`
  - `lensfun-core.data` の明示 URL。
- `locateFile?: (path, prefix) => string`
  - Emscripten のファイル解決を完全上書き。
- `dbPath?: string`
  - Emscripten FS 上の DB パス。既定は `/lensfun-db`。
- `autoInitDb?: boolean`
  - 既定 `true`。`false` の場合は初期化をスキップ。

## `LensfunClient`

### `searchLenses(input) => LensMatch[]`

`SearchLensesInput`:

- `lensModel`（必須）
- `lensMaker?`
- `cameraMaker?`
- `cameraModel?`
- `searchFlags?`（既定 `LF_SEARCH_SORT_AND_UNIQUIFY`）

戻り値 `LensMatch[]`:

- `handle`（マップ生成で使用）
- `maker`、`model`、`score`
- `minFocal`、`maxFocal`、`minAperture`、`maxAperture`、`cropFactor`

### `searchCameras(input) => CameraMatch[]`

`SearchCamerasInput`:

- `maker?`
- `model?`
- `searchFlags?`

`CameraMatch[]` を返します（`maker/model/variant/mount/cropFactor/score`）。

### `getAvailableModifications(lensHandle, crop) => number`

Lensfun の `LF_MODIFY_*` ビットフラグを返します。

### `buildCorrectionMaps(input) => CorrectionMaps`

`CorrectionInput`:

- `lensHandle`（必須）
- `width`、`height`（必須、正整数）
- `focal`、`crop`（必須）
- `step?`（既定 `1`）
- `reverse?`（既定 `false`）
- `includeTca?`（既定 `false`）
- `includeVignetting?`（既定 `false`）
- `aperture?`（`includeVignetting = true` の場合必須）
- `distance?`（既定 `1000`）

`CorrectionMaps`:

- `gridWidth`、`gridHeight`、`step`
- `geometry: Float32Array` 長さ = `gridW * gridH * 2`
  - 配列レイアウト: `[x0, y0, x1, y1, ...]`
- `tca?: Float32Array` 長さ = `gridW * gridH * 6`
  - 配列レイアウト: `[rx, ry, gx, gy, bx, by, ...]`
- `vignetting?: Float32Array` 長さ = `gridW * gridH * 3`
  - 配列レイアウト: `[rGain, gGain, bGain, ...]`

`tca` は TCA 補正だけで作られるため、座標に歪み補正は含まれません。両方を補正するには `buildSubpixelGeometryMap` を使います。

`geometry` は常に最初に作られるため、歪みのキャリブレーションがないレンズでは失敗します（コード `-4`）。そのようなレンズの周辺減光ゲインは `buildVignettingMap` で作ります。

### `buildSubpixelGeometryMap(input) => SubpixelGeometryMap`

歪みと TCA を同時に補正したマップ。Lensfun が 1 ステップで適用する順序（`ApplySubpixelGeometryDistortion`：先に歪み補正、その歪んだ位置で TCA 補正）に従います。

`MapGridInput`: `lensHandle`、`width`、`height`、`focal`、`crop`、`step?`、`reverse?`（`buildCorrectionMaps` と同じ）

`SubpixelGeometryMap`:

- `gridWidth`、`gridHeight`、`step`
- `coords: Float32Array` 長さ = `gridW * gridH * 6`
  - 配列レイアウト: `[rx, ry, gx, gy, bx, by, ...]`
- `modifications`: 適用した補正（`LF_MODIFY_DISTORTION`、`LF_MODIFY_TCA`）。TCA のキャリブレーションがないレンズは 3 チャンネルとも歪み補正のみ、どちらもないレンズは例外（コード `-4`）。

### `buildVignettingMap(input) => VignettingMap`

周辺減光のゲインだけを作り、幾何マップは作りません。同じグリッドで `buildCorrectionMaps` が返す `vignetting` と同じ値です。歪みのキャリブレーションがないレンズにも使えます。

`VignettingMapInput`: `MapGridInput` の各フィールド、`aperture`（必須）、`distance?`（既定 `1000`）

`VignettingMap`:

- `gridWidth`、`gridHeight`、`step`
- `gains: Float32Array` 長さ = `gridW * gridH * 3`
  - 配列レイアウト: `[rGain, gGain, bGain, ...]`

そのクロップ係数で周辺減光のキャリブレーションがないレンズは例外（コード `-4`）。

### `dispose()`

ネイティブ DB メモリを解放します。利用終了時に呼んでください。

## 公開定数

検索フラグ:

- `LF_SEARCH_LOOSE = 1`
- `LF_SEARCH_SORT_AND_UNIQUIFY = 2`

補正フラグ:

- `LF_MODIFY_TCA = 0x00000001`
- `LF_MODIFY_VIGNETTING = 0x00000002`
- `LF_MODIFY_DISTORTION = 0x00000008`
- `LF_MODIFY_GEOMETRY = 0x00000010`
- `LF_MODIFY_SCALE = 0x00000020`
- `LF_MODIFY_PERSPECTIVE = 0x00000040`

## ソースからビルド

```bash
# 1) 依存インストール
npm install

# 2) emcc/emcmake を有効化
#    例: source /path/to/emsdk/emsdk_env.sh

# 3) wasm + js + 型定義を生成
npm run build
```

`npm run build` の実行内容:

1. `npm run build:wasm`
2. `npm run build:js`
3. `npm run build:types`

出力:

- `dist/assets/lensfun-core.js`
- `dist/assets/lensfun-core.wasm`
- `dist/assets/lensfun-core.data`
- `dist/esm/index.js`
- `dist/umd/index.iife.js`
- `dist/types/index.d.ts`

## ローカル検証

```bash
npm run check
```

内容:

- JS バンドル生成
- 型定義生成
- Vitest 単体テスト

## 上流同期ポリシー

- Lensfun は submodule の固定コミットで管理
- 自動追従せず手動更新

同期コマンド:

```bash
scripts/sync-upstream.sh origin/master
```

更新後に行うこと:

1. wasm 再ビルド
2. テスト実行
3. `UPSTREAM.md` 更新

## トラブルシューティング

### `emcc not found`

emsdk が未インストール、または未アクティベートです。同じシェルで有効化後に再実行してください。

### `module factory not found`

`moduleFactory` 未指定、かつ `dist/assets/lensfun-core.js` が事前ロードされていません。

### `lfw_init failed with code ...`

DB パス、または `.data` 読み込みが不正です。

- `dataUrl` が `lensfun-core.data` を指しているか確認
- `dbPath` がプリロードパス（既定 `/lensfun-db`）と一致しているか確認

### `the core module exports no HEAPF32 view`

コア（`lensfun-core.js`）が JS API より古い状態です。0.1.4 より前のコアは `HEAPF32` を公開していません。同じリリースのコアを読み込んでください。

### `native map builder failed with code ...`

入力値不正、または補正データ不一致の可能性があります。

- `lensHandle` は最新 `searchLenses` の結果を使う
- `width/height/step` を見直す
- vignetting 生成時は `aperture` を指定する

## ライセンス

- Lensfun コア: LGPL-3.0-or-later
- Lensfun DB: CC BY-SA 3.0
- tinyxml2: zlib
- utf8proc: MIT

詳細:

- [NOTICE.md](./NOTICE.md)
- [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)
- [UPSTREAM.md](./UPSTREAM.md)
