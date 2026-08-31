#!/usr/bin/env python3
"""Object storage for the things Postgres should not hold.

Input datasets, tool outputs, fixtures and goldens. All of them are files, all
of them are read far more often than written, and none of them belongs in a
jsonb column - `nodes.content` is a BlockNote document and was never going to
hold a 2 MB FASTQ.

S3-shaped on purpose. MinIO locally, Scaleway Object Storage in production, one
client, no code change between them. Scaleway is already the provider in
infra/terraform, so this keeps the EU-hosting line intact rather than reaching
for the nearest US bucket.

The important function is `materialise`. Everything the runner does takes a real
path on disk, because a container mounts directories, not URLs - so somewhere
between storage and staging, bytes have to land. That crossing happens here, in
trusted code, and never inside the executor: the executor runs untrusted tool
code and must not hold a storage credential, exactly as it must not hold a
database connection.

    blobs.py put datasets/reads.fastq /tmp/reads.fastq
    blobs.py ls datasets/
    blobs.py get datasets/reads.fastq /tmp/out.fastq
"""

import argparse
import os
import pathlib
import sys

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

ENDPOINT = os.environ.get("BLUEDOOR_S3_ENDPOINT", "http://127.0.0.1:9000")
ACCESS_KEY = os.environ.get("BLUEDOOR_S3_ACCESS_KEY", "bluedoor")
SECRET_KEY = os.environ.get("BLUEDOOR_S3_SECRET_KEY", "bluedoor_dev_secret")
BUCKET = os.environ.get("BLUEDOOR_S3_BUCKET", "bluedoor")
REGION = os.environ.get("BLUEDOOR_S3_REGION", "fr-par")


def client():
    return boto3.client(
        "s3", endpoint_url=ENDPOINT,
        aws_access_key_id=ACCESS_KEY, aws_secret_access_key=SECRET_KEY,
        region_name=REGION,
        # Path style: MinIO serves buckets as a path, not a subdomain, and so
        # does Scaleway for anything but its own virtual-hosted endpoints.
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def ensure_bucket(s3=None) -> None:
    s3 = s3 or client()
    try:
        s3.head_bucket(Bucket=BUCKET)
    except ClientError:
        s3.create_bucket(Bucket=BUCKET)


def put(key: str, path: pathlib.Path | str, content_type: str | None = None) -> dict:
    s3 = client()
    ensure_bucket(s3)
    path = pathlib.Path(path)
    extra = {"ContentType": content_type} if content_type else {}
    s3.upload_file(str(path), BUCKET, key, ExtraArgs=extra or None)
    return {"key": key, "bytes": path.stat().st_size, "bucket": BUCKET}


def get(key: str, dest: pathlib.Path | str) -> pathlib.Path:
    dest = pathlib.Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    client().download_file(BUCKET, key, str(dest))
    return dest


def ls(prefix: str = "") -> list[dict]:
    s3 = client()
    ensure_bucket(s3)
    pages = s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=prefix)
    return [
        {"key": o["Key"], "bytes": o["Size"], "modified": o["LastModified"].isoformat()}
        for page in pages for o in page.get("Contents", [])
    ]


def materialise(keys: dict[str, str], into: pathlib.Path) -> dict[str, str]:
    """Blob keys in, readable paths out. The seam the executor is built against.

    Maps port name -> blob key into port name -> local path, preserving the key's
    file extension so type detection by extension still behaves. Nothing
    downstream needs to know storage exists.
    """
    into = pathlib.Path(into)
    into.mkdir(parents=True, exist_ok=True)
    paths = {}
    for port, key in keys.items():
        suffix = "".join(pathlib.PurePath(key).suffixes[-2:])
        paths[port] = str(get(key, into / f"{port}{suffix}"))
    return paths


def store_outputs(prefix: str, outputs: dict[str, str]) -> dict[str, dict]:
    """The reverse crossing, after a run: local paths back into storage."""
    stored = {}
    for port, path in outputs.items():
        path = pathlib.Path(path)
        if path.exists():
            stored[port] = put(f"{prefix}/{path.name}", path)
    return stored


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("put"); p.add_argument("key"); p.add_argument("path")
    p = sub.add_parser("get"); p.add_argument("key"); p.add_argument("dest")
    p = sub.add_parser("ls"); p.add_argument("prefix", nargs="?", default="")
    args = ap.parse_args()

    if args.cmd == "put":
        r = put(args.key, args.path)
        print(f"  {r['key']}  {r['bytes']:,} bytes")
    elif args.cmd == "get":
        print(f"  -> {get(args.key, args.dest)}")
    else:
        total = 0
        for obj in ls(args.prefix):
            print(f"  {obj['bytes']:>12,}  {obj['key']}")
            total += obj["bytes"]
        print(f"  {'-' * 12}  {total:,} bytes total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
