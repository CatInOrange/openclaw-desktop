#!/usr/bin/env python3
"""Publish verified artifacts; never print endpoint or credential values."""
import hashlib, json, logging, os, re, sys, time, zipfile

stage = "configuration"
from pathlib import Path
from urllib.parse import urlsplit

logging.disable(logging.CRITICAL)
def main():
    global stage
    from qcloud_cos import CosConfig, CosS3Client
    endpoint = os.environ['ANDROID_UPDATE_MANIFEST_URL']
    parsed = urlsplit(endpoint)
    bucket, region = os.environ['COS_BUCKET'], os.environ['COS_REGION']
    assert parsed.scheme == 'https' and parsed.netloc == f'{bucket}.cos.{region}.myqcloud.com'
    assert not parsed.query and not parsed.fragment
    assert parsed.path == '/openclaw-desktop/android/latest.json'
    root = Path('dist/android')
    apk, = root.glob('*.apk')
    version = re.fullmatch(r'OpenClaw-Android-(\d+\.\d+\.\d+)\.apk', apk.name)[1]
    digest = hashlib.file_digest(apk.open('rb'), 'sha256').hexdigest()
    assert (root/'SHA256SUMS').read_text().strip() == f'{digest}  {apk.name}'
    client = CosS3Client(CosConfig(Region=region, SecretId=os.environ['COS_SECRET_ID'], SecretKey=os.environ['COS_SECRET_KEY'], Scheme='https'))
    prefix = parsed.path.lstrip('/').rsplit('/', 1)[0]
    archive = apk.with_suffix('.apk.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as output:
        output.write(apk, apk.name)
    archive_digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
    key = f'{prefix}/releases/android-v{version}/{archive.name}'
    # Versioned artifacts first; only expose a new manifest after remote size verification.
    stage = "upload"
    client.upload_file(Bucket=bucket, Key=key, LocalFilePath=str(archive), ACL='public-read', PartSize=10, MAXThread=4)
    client.put_object_acl(Bucket=bucket, Key=key, ACL='public-read')
    remote = client.head_object(Bucket=bucket, Key=key)
    assert int(remote['Content-Length']) == archive.stat().st_size
    manifest = {'schemaVersion': 1, 'version': version, 'apkUrl': f'{parsed.scheme}://{parsed.netloc}/{key}', 'size': archive.stat().st_size, 'sha256': archive_digest, 'format': 'zip', 'apkSize': apk.stat().st_size, 'apkSha256': digest}
    stage = "manifest-upload"
    client.put_object(Bucket=bucket, Key=parsed.path.lstrip('/'), Body=json.dumps(manifest).encode(), ACL='public-read', ContentType='application/json', CacheControl='no-store, max-age=0')
    # Verify the same anonymous route the app will use, without leaking URLs in errors.
    import urllib.request
    for attempt in range(3):
        try:
            stage = "anonymous-manifest-read"
            with urllib.request.urlopen(endpoint, timeout=30) as response:
                assert json.load(response) == manifest
            stage = "anonymous-apk-read"
            request = urllib.request.Request(manifest['apkUrl'], headers={'Range': 'bytes=0-31', 'User-Agent': 'OpenClaw-Android/0.2.2', 'Cache-Control': 'no-cache'})
            with urllib.request.urlopen(request, timeout=30) as response:
                assert response.read(4) == b'PK\x03\x04'
            break
        except Exception:
            if attempt == 2: raise
            time.sleep(3)
    print(f'COS publication verified: Android {version}, {apk.stat().st_size} bytes; anonymous manifest and APK reads passed.')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        detail = ""
        if hasattr(error, 'read'):
            try:
                import xml.etree.ElementTree as ET
                value = ET.fromstring(error.read(8192)).findtext('Code', '')
                if re.fullmatch(r'[A-Za-z0-9_]{1,80}', value): detail = value
            except Exception: pass
        code = getattr(error, 'code', None)
        safe_code = str(code) if isinstance(code, int) else "n/a"
        print(f'COS publication failed at {stage}: {type(error).__name__}, HTTP {safe_code}, code {detail}; configuration suppressed.', file=sys.stderr)
        sys.exit(1)
