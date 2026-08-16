#!/usr/bin/env python3
"""Build compact website data and deduplicated artwork from indexer output."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import sqlite3
import tempfile
import zipfile
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
TOTAL_EXPECTED = 10_000
BODY_ORDER = ["normal", "sad", "angry", "sleepy", "unknown"]
ACCESSORY_ORDER = ["none", "horny", "pinkGlasses", "sleepMask"]
REQUIRED_FIELDS = {
    "id",
    "txid",
    "body",
    "accessory",
    "parity",
    "pool",
    "image_count",
    "fee_rate",
    "sat",
    "mint_address",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=ROOT.parent / "indexooooor",
        help="path to the indexooooor repository",
    )
    return parser.parse_args()


def trim_webp(data: bytes, name: str) -> bytes:
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError(f"{name} is not a WebP RIFF file")

    declared_size = 8 + int.from_bytes(data[4:8], "little")
    if declared_size < 12 or declared_size > len(data):
        raise ValueError(f"{name} has an invalid RIFF size")

    return data[:declared_size]


def read_block_heights(archive: zipfile.ZipFile) -> dict[int, int]:
    with tempfile.NamedTemporaryFile(suffix=".sqlite") as database_file:
        with archive.open("labitbu.sqlite") as source:
            shutil.copyfileobj(source, database_file)
        database_file.flush()

        connection = sqlite3.connect(database_file.name)
        try:
            rows = connection.execute(
                "SELECT id, block_height FROM tx_data ORDER BY id"
            ).fetchall()
        finally:
            connection.close()

    if len(rows) != TOTAL_EXPECTED:
        raise ValueError(f"expected {TOTAL_EXPECTED} database rows, found {len(rows)}")

    return {item_id: block_height for item_id, block_height in rows}


def ordered_values(preferred: list[str], values: set[str]) -> list[str]:
    return [value for value in preferred if value in values] + sorted(
        values.difference(preferred)
    )


def validate_traits(traits: list[dict]) -> None:
    if len(traits) != TOTAL_EXPECTED:
        raise ValueError(f"expected {TOTAL_EXPECTED} traits, found {len(traits)}")

    for expected_id, item in enumerate(traits, start=1):
        missing = REQUIRED_FIELDS.difference(item)
        if missing:
            raise ValueError(f"item {expected_id} is missing {sorted(missing)}")
        if item["id"] != expected_id:
            raise ValueError(
                f"expected item {expected_id}, found item {item['id']} instead"
            )


def build(source_dir: Path) -> None:
    traits_path = source_dir / "traits.json"
    archive_path = source_dir / "labitbu_data.zip"
    if not traits_path.is_file() or not archive_path.is_file():
        raise FileNotFoundError(
            f"{source_dir} must contain traits.json and labitbu_data.zip"
        )

    traits = json.loads(traits_path.read_text(encoding="utf-8"))
    validate_traits(traits)

    body_counts = Counter(item["body"] for item in traits)
    accessory_counts = Counter(item["accessory"] or "none" for item in traits)
    pool_counts = Counter(item["pool"] for item in traits)
    parity_counts = Counter(item["parity"] for item in traits)
    fee_counts = Counter(item["fee_rate"] for item in traits)
    address_counts = Counter(item["mint_address"] for item in traits)
    sat_counts = Counter(item["sat"] for item in traits)

    bodies = ordered_values(BODY_ORDER, set(body_counts))
    accessories = ordered_values(ACCESSORY_ORDER, set(accessory_counts))
    pools = sorted(pool_counts, key=lambda value: (-pool_counts[value], value))
    body_indexes = {value: index for index, value in enumerate(bodies)}
    accessory_indexes = {value: index for index, value in enumerate(accessories)}
    pool_indexes = {value: index for index, value in enumerate(pools)}

    DOCS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".collection-", dir=DOCS) as work_dir:
        work = Path(work_dir)
        generated_images = work / "images"
        generated_images.mkdir()

        image_indexes: dict[str, int] = {}
        image_paths: list[str] = []
        image_digests: list[str] = []

        with zipfile.ZipFile(archive_path) as archive:
            block_heights = read_block_heights(archive)

            for item in traits:
                accessory = item["accessory"] or "none"
                image_name = (
                    f"labitbu_images/{item['id']}-{item['body']}-{accessory}.webp"
                )
                try:
                    image = trim_webp(archive.read(image_name), image_name)
                except KeyError as error:
                    raise FileNotFoundError(f"missing {image_name} in archive") from error

                digest = hashlib.sha256(image).hexdigest()
                image_digests.append(digest)
                if digest in image_indexes:
                    continue

                image_index = len(image_paths)
                relative_path = f"{digest[:2]}/{digest[2:26]}.webp"
                destination = generated_images / relative_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(image)
                image_indexes[digest] = image_index
                image_paths.append(relative_path)

        image_frequencies = Counter(image_digests)
        for item, digest in zip(traits, image_digests, strict=True):
            actual_count = image_frequencies[digest]
            if item["image_count"] != actual_count:
                raise ValueError(
                    f"item {item['id']} reports {item['image_count']} image copies, "
                    f"but the archive contains {actual_count}"
                )

        scores = []
        for item in traits:
            accessory = item["accessory"] or "none"
            score = sum(
                math.log(TOTAL_EXPECTED / frequency)
                for frequency in (
                    body_counts[item["body"]],
                    accessory_counts[accessory],
                    item["image_count"],
                )
            )
            scores.append(score)

        ranked_indexes = sorted(
            range(len(traits)), key=lambda index: (-scores[index], traits[index]["id"])
        )
        ranks = [0] * len(traits)
        for rank, index in enumerate(ranked_indexes, start=1):
            ranks[index] = rank

        blocks = list(block_heights.values())
        copy_buckets = [
            {
                "label": "1 of 1",
                "count": sum(item["image_count"] == 1 for item in traits),
            },
            {
                "label": "2-5 copies",
                "count": sum(2 <= item["image_count"] <= 5 for item in traits),
            },
            {
                "label": "6-10 copies",
                "count": sum(6 <= item["image_count"] <= 10 for item in traits),
            },
            {
                "label": "11+ copies",
                "count": sum(item["image_count"] >= 11 for item in traits),
            },
        ]

        stats = {
            "total": TOTAL_EXPECTED,
            "uniqueImages": len(image_paths),
            "oneOfOnes": sum(count == 1 for count in image_frequencies.values()),
            "maxImageCopies": max(image_frequencies.values()),
            "uniqueMintAddresses": len(address_counts),
            "repeatMintAddresses": sum(count > 1 for count in address_counts.values()),
            "maxAddressMints": max(address_counts.values()),
            "uniqueSats": len(sat_counts),
            "duplicateSatEntries": TOTAL_EXPECTED - len(sat_counts),
            "startBlock": min(blocks),
            "endBlock": max(blocks),
            "mintBlocks": len(set(blocks)),
            "blockSpan": max(blocks) - min(blocks) + 1,
            "bodies": [
                {"value": value, "count": body_counts[value]} for value in bodies
            ],
            "accessories": [
                {"value": value, "count": accessory_counts[value]}
                for value in accessories
            ],
            "pools": [
                {"value": value, "count": pool_counts[value]} for value in pools
            ],
            "parity": [
                {"value": str(value), "count": parity_counts[value]}
                for value in sorted(parity_counts)
            ],
            "fees": [
                {"value": value, "count": fee_counts[value]}
                for value in sorted(fee_counts)
            ],
            "copyBuckets": copy_buckets,
        }

        items = []
        for index, item in enumerate(traits):
            accessory = item["accessory"] or "none"
            items.append(
                [
                    item["id"],
                    item["txid"],
                    image_indexes[image_digests[index]],
                    body_indexes[item["body"]],
                    accessory_indexes[accessory],
                    item["parity"],
                    pool_indexes[item["pool"]],
                    item["image_count"],
                    item["fee_rate"],
                    item["sat"],
                    item["mint_address"],
                    block_heights[item["id"]],
                    round(scores[index], 4),
                    ranks[index],
                ]
            )

        payload = {
            "version": 1,
            "schema": [
                "id",
                "txid",
                "imageIndex",
                "bodyIndex",
                "accessoryIndex",
                "parity",
                "poolIndex",
                "imageCopies",
                "feeRate",
                "sat",
                "mintAddress",
                "blockHeight",
                "rarityScore",
                "rarityRank",
            ],
            "labels": {
                "bodies": bodies,
                "accessories": accessories,
                "pools": pools,
            },
            "images": image_paths,
            "rarity": {
                "name": "Visual rarity v1",
                "formula": "sum(-ln(trait frequency / 10000))",
                "traits": ["body", "accessory", "exact artwork"],
                "tieBreak": "collection number ascending",
            },
            "stats": stats,
            "items": items,
        }

        generated_data = work / "collection.json"
        generated_data.write_text(
            json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )

        final_images = DOCS / "images"
        final_data_dir = DOCS / "data"
        final_data_dir.mkdir(exist_ok=True)
        if final_images.exists():
            shutil.rmtree(final_images)
        os.replace(generated_images, final_images)
        os.replace(generated_data, final_data_dir / "collection.json")

    data_size = (DOCS / "data" / "collection.json").stat().st_size
    image_size = sum(path.stat().st_size for path in (DOCS / "images").rglob("*.webp"))
    print(
        f"Built {TOTAL_EXPECTED:,} items, {len(image_paths):,} unique images, "
        f"{data_size / 1_000_000:.2f} MB data, {image_size / 1_000_000:.2f} MB images"
    )


if __name__ == "__main__":
    arguments = parse_args()
    build(arguments.source.resolve())
