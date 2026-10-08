#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/wasm-build"
DIST_ASSETS_DIR="${ROOT_DIR}/dist/assets"

if ! command -v emcc >/dev/null 2>&1; then
  cat >&2 <<'MSG'
[build-wasm] emcc not found.
Install and activate Emscripten first, for example:
  git clone https://github.com/emscripten-core/emsdk.git
  cd emsdk
  ./emsdk install 6.0.4   # the release CI builds with (.github/workflows)
  ./emsdk activate 6.0.4
  source ./emsdk_env.sh
MSG
  exit 1
fi

rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}" "${DIST_ASSETS_DIR}"

emcmake cmake -S "${ROOT_DIR}/native" -B "${BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release
cmake --build "${BUILD_DIR}" --target lensfun-core -j

cp "${BUILD_DIR}/lensfun-core.js" "${DIST_ASSETS_DIR}/lensfun-core.js"
cp "${BUILD_DIR}/lensfun-core.wasm" "${DIST_ASSETS_DIR}/lensfun-core.wasm"
cp "${BUILD_DIR}/lensfun-core.data" "${DIST_ASSETS_DIR}/lensfun-core.data"

echo "[build-wasm] built assets in ${DIST_ASSETS_DIR}"
