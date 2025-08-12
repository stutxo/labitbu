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

echo "Running wasm-bindgen tests…"
# wasm-pack test --node

echo "Building release package with wasm-pack…"
rm -rf "$PKG_DIR"

wasm-pack build \
  --release \
  --target web \
  --out-dir  "$PKG_DIR" \
  --out-name "$PKG_NAME"

rm -f "$PKG_DIR/.gitignore" "$PKG_DIR/README.md"

cp -a -f index.html              "$DEST_DIR/"
cp -a -f labitbu-traits.json     "$DEST_DIR/"
cp -a -f lasnoozesnooze.json "$DEST_DIR/"
cp -a -f labitbu-traits-sleepy.json        "$DEST_DIR/"

ls -lh "$PKG_DIR/${PKG_NAME}_bg.wasm" "$PKG_DIR/${PKG_NAME}.js"
