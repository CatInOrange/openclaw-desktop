#!/usr/bin/env python3
"""Derive Android launcher art from the desktop's single original icon."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parent.parent
source = root / 'assets/icon.png'
resources = root / 'android/app/src/main/res'
with Image.open(source) as icon:
    icon = icon.convert('RGBA')
    for density, size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
        folder = resources / ('mipmap-' + density)
        folder.mkdir(parents=True, exist_ok=True)
        icon.resize((size,size), Image.Resampling.LANCZOS).save(folder / 'ic_launcher.png')
print('Android launcher icons generated from assets/icon.png (5 densities).')

# Use the same licensed source clips and background renderer on both clients.
import shutil
video = root / 'assets/video'
raw = resources / 'raw'
raw.mkdir(parents=True, exist_ok=True)
shutil.copyfile(video / 'boot.mp4', raw / 'boot.mp4')
extension = root / 'android/app/src/main/assets/appearance'
for name in ['NOTICE.md', 'LICENSE.dsh-video-skin']:
    shutil.copyfile(video / name, extension / name)
shutil.copyfile(root / 'src/background.css', extension / 'background.css')
core = (root / 'src/background.cjs').read_text()
core = core[core.index('function applyBackground('):core.index('function watchBackground(')]
(extension / 'background-core.js').write_text("'use strict';\n" + core)
print('Shared boot/background clips, license and isolated background renderer copied.')

# Package bytes as extension-private script data. No content-context fetch or
# FileReader/Blob principal crossing is needed to load the bundled clip.
import base64, json
media = 'data:video/mp4;base64,' + base64.b64encode((video / 'background.mp4').read_bytes()).decode('ascii')
(extension / 'background-media.js').write_text("'use strict';\nconst OPENCLAW_BACKGROUND_MEDIA = " + json.dumps(media) + ";\n")
# Older local derivations must not accidentally ship a duplicate video.
(extension / 'background.mp4').unlink(missing_ok=True)
