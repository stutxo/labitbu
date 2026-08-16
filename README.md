# labitbu.com

A fast, dependency-free browser for the full 10,000-piece Labitbu collection.
GitHub Pages serves the site directly from `docs/`.

## Build the collection data

The generator expects the indexer repository to be next to this repository:

```text
parent/
  indexooooor/
  labitbu/
```

Run:

```bash
./build.sh
```

To use a different indexer checkout:

```bash
./build.sh --source /path/to/indexooooor
```

The build reads `traits.json` and `labitbu_data.zip`, joins block heights from the
archived SQLite database, and writes:

- `docs/data/collection.json`: compact metadata, statistics, and rarity ranks.
- `docs/images/`: 3,028 deduplicated and RIFF-trimmed WebP files.

The website itself is plain HTML, CSS, and JavaScript. Preview it with:

```bash
python3 -m http.server 8000 --directory docs
```

## Rarity

Rarity is based only on visible collection data: body, accessory, and exact
artwork frequency. Each trait contributes `-ln(frequency / 10000)`. Scores are
ranked from highest to lowest, with collection number used as the tie-breaker.
Minting pool, fee rate, parity, sat, and address data are shown as provenance but
do not affect visual rarity.

## Sources

- Indexer and source data: <https://github.com/labitbu/indexooooor>
- satindex: `f08fd61d48f79eeb0c4bc9e58f2d7ecad0e20e5d6411b588590cb0480c8e7fbe`
- Typeface: National Park Variable, licensed under SIL OFL 1.1 in `docs/fonts/OFL.txt`.
