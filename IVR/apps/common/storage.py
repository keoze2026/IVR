"""
Object storage helpers.

Everything in S3 is private. Prompt audio is handed to the carrier as a
short-lived signed URL rather than a public object, because a public prompt
bucket leaks campaign scripts and, for personalised prompts, customer data.
"""

from __future__ import annotations

import functools
import io

from django.conf import settings


@functools.lru_cache(maxsize=1)
def s3_client():
    import boto3

    return boto3.client(
        "s3",
        region_name=settings.AWS_S3_REGION_NAME,
        endpoint_url=settings.AWS_S3_ENDPOINT_URL or None,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY or None,
    )


def put_bytes(bucket: str, key: str, data: bytes, content_type: str) -> str:
    s3_client().put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
        ServerSideEncryption="AES256",
    )
    return key


def get_bytes(bucket: str, key: str) -> bytes:
    obj = s3_client().get_object(Bucket=bucket, Key=key)
    return obj["Body"].read()


def stream_lines(bucket: str, key: str, encoding: str = "utf-8-sig"):
    """Yield decoded lines without holding the whole object in memory.

    A 500k-row CSV is ~30 MB; four concurrent ingests on a worker with a 512 MB
    limit is the difference between working and OOM-looping.
    """
    body = s3_client().get_object(Bucket=bucket, Key=key)["Body"]
    buffer = io.TextIOWrapper(body, encoding=encoding, newline="")
    yield from buffer


def signed_url(bucket: str, key: str, ttl: int | None = None) -> str:
    return s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=ttl or settings.SIGNED_URL_TTL_SECONDS,
    )


def signed_upload_url(bucket: str, key: str, content_type: str, ttl: int = 900) -> dict:
    return s3_client().generate_presigned_post(
        Bucket=bucket,
        Key=key,
        Fields={"Content-Type": content_type},
        Conditions=[
            {"Content-Type": content_type},
            ["content-length-range", 1, 512 * 1024 * 1024],
        ],
        ExpiresIn=ttl,
    )


def delete_object(bucket: str, key: str) -> None:
    s3_client().delete_object(Bucket=bucket, Key=key)
