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
