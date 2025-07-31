#!/usr/bin/env bash
set -euo pipefail

DEST_DIR=docs
PKG_NAME=labitbu      
PKG_DIR="$DEST_DIR/pkg"

LLVM_PREFIX=$(brew --prefix llvm)
export PATH="$LLVM_PREFIX/bin:$PATH"
export CC_wasm32_unknown_unknown="$LLVM_PREFIX/bin/clang"
export AR_wasm32_unknown_unknown="$LLVM_PREFIX/bin/llvm-ar"
export CFLAGS_wasm32_unknown_unknown="--target=wasm32-unknown-unknown"

rm -rf "$PKG_DIR"

echo "building with wasm-pack…"
wasm-pack build \
  --release \
  --target web \
  --out-dir  "$PKG_DIR" \
  --out-name "$PKG_NAME"

rm -f "$PKG_DIR/.gitignore"
rm -f "$PKG_DIR/README.md"

ls -lh "$PKG_DIR/${PKG_NAME}_bg.wasm" "$PKG_DIR/${PKG_NAME}.js"
