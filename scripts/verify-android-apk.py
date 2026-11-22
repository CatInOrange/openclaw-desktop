#!/usr/bin/env python3
"""Non-GUI inspection of the distributable APK, identity and release signature."""
import argparse, hashlib, os, re, subprocess, zipfile
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('apk',type=Path)
parser.add_argument('--build-tools',type=Path,required=True)
parser.add_argument('--expected-version',default='0.1.5')
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
apk=args.apk.resolve()
def run(name,*options):
    tool=args.build_tools / (name + ('.bat' if os.name=='nt' and name=='apksigner' else '.exe' if os.name=='nt' else ''))
    return subprocess.check_output([str(tool),*options],text=True,stderr=subprocess.STDOUT)
signature=run('apksigner','verify','--verbose','--print-certs',str(apk))
expected=(root/'shared/android-signing-certificate.sha256').read_text().strip().lower()
cert=re.search(r'Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]+)',signature)
assert cert and cert.group(1).lower()==expected,'Unexpected APK signing identity'
badging=run('aapt','dump','badging',str(apk))
assert "package: name='dev.openclaw.mobile'" in badging,'Unexpected application ID'
assert f"versionName='{args.expected_version}'" in badging,'Unexpected Android version'
assert "sdkVersion:'28'" in badging,'Unexpected minimum Android API'
assert 'launchable-activity:' in badging,'No launcher activity'
assert 'application-debuggable' not in badging,'Distributable must not be debuggable'
for forbidden in ['android.permission.RECORD_AUDIO','android.permission.CAMERA','android.permission.MANAGE_EXTERNAL_STORAGE','android.permission.READ_EXTERNAL_STORAGE','android.permission.WRITE_EXTERNAL_STORAGE','android.permission.SYSTEM_ALERT_WINDOW']:
    assert forbidden not in badging,'Unneeded permission: '+forbidden
xml=run('aapt','dump','xmltree',str(apk),'AndroidManifest.xml')
assert re.search(r'android:allowBackup[^\n]*=\(type 0x12\)0x0\b',xml),'Backup must not export WebView credentials'
with zipfile.ZipFile(apk) as archive:
    names=archive.namelist()
    assert 'AndroidManifest.xml' in names and 'classes.dex' in names
    assert not any(name.endswith(('.jks','.keystore','.webm')) for name in names),'Private keys or unrelated media included'
    assert not any('node_modules/' in name for name in names),'Desktop dependencies included'
    # Release AAPT may shorten res paths; retain the raw resource identity and
    # verify its actual bytes, not a debug-build ZIP path assumption.
    assert 'raw/boot' in run('aapt', 'dump', 'resources', str(apk)), 'Missing boot resource ID'
    boot_entries = [name for name in names if name.startswith('res/') and name.endswith('.mp4')]
    assert len(boot_entries) == 1, 'Unexpected packaged boot media count'
    for packaged, source in [(boot_entries[0], 'assets/video/boot.mp4'), ('assets/appearance/background.mp4', 'assets/video/background.mp4')]:
        assert hashlib.sha256(archive.read(packaged)).digest() == hashlib.sha256((root/source).read_bytes()).digest(), 'Bundled media differs from licensed desktop source'
    for required in ['manifest.json', 'appearance.js', 'background-core.js', 'background.css', 'NOTICE.md', 'LICENSE.dsh-video-skin']:
        assert 'assets/appearance/' + required in names, 'Missing local appearance resource: ' + required
    assert 'lib/arm64-v8a/libxul.so'  in names,'Bundled Gecko engine missing'
size=apk.stat().st_size
assert size <= 250*1024*1024,f'APK {size} bytes exceeds the supported updater download limit'
sha=hashlib.file_digest(apk.open('rb'),'sha256').hexdigest()
print(f'APK verified: {apk.name} | {size} bytes | Android 9+ | release certificate pinned')
print(f'SHA256 {sha}')
