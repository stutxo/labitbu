# labitbu

## Setup

If you want to run this locally you can serve the contents of the docs folder from a local webserver.

```
python3 -m http.server --directory docs 8080
```

## Deploy

This site is hosted on github pages via the github.com/stutxo/lubitbu repo. The build script moves the comipled app to the /docs folder, which is used by github pages to serve the website.

## Dependencies 

### Rust
```
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### wasm-pack
```
cargo install wasm-pack
```

### Build
```
./build.sh
```