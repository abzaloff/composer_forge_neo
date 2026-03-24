# composer_forge_neo

Composer extension for Forge/Neo that helps build scene layouts before Img2Img/Inpaint.

<img width="1615" height="764" alt="Composer" src="https://github.com/user-attachments/assets/da985ac8-4f67-4399-abd8-a662ba5b6db5" />

## Installation

1. Copy this extension folder to your Forge extensions directory:
   `extensions/composer_forge_neo`
2. Restart Forge.
3. Open the `Composer` tab.
4. On first startup, extension `install.py` tries to install `rembg` automatically.
5. If `rembg` was not installed automatically, install it manually (see dependency section below).

## Features

- Add and transform images on canvas
- Remove image background (`Remove BG`) using `rembg`
- Add editable text
- Add geometric shapes: triangle, square, circle, pentagon, hexagon, octagon
- Shared color picker for brush and text/shapes
- Layer ordering (`up` / `down`)
- Flip selected objects (horizontal / vertical)
- Export scene to PNG
- Send scene directly to Img2Img, Inpaint, ControlNet T2I, or ControlNet I2I
- Adjustable canvas size

## Keyboard Shortcuts

- `Delete` - remove selected object(s)
- `B` - brush (press again to turn off)
- `E` - eraser (press again to turn off)
- `Ctrl+D` - duplicate selected object(s)
- `Ctrl+V` / `Cmd+V` - paste image from clipboard
- `Ctrl + Mouse Wheel` - scale selected object
- `Alt + Mouse Wheel` - change brush/eraser size
- `Middle Mouse (hold) + Drag` - pan viewport
- `Middle Mouse (hold) + Wheel` - zoom viewport
- `Shift + Drop` - drop image as background (first file)

## Dependency: rembg

This extension requires `rembg` for background removal.

- Automatic install: `install.py` tries to install `rembg` on Forge startup using `--no-deps`.
  This is intentional to avoid modifying Forge/Neo pinned dependency versions
  (for example `scikit-image==0.25.2` from Forge requirements).
- If automatic install fails, install manually in Forge venv:

```powershell
venv\Scripts\activate
pip install --no-deps rembg
```

Or without activating venv:

```powershell
venv\Scripts\python.exe -m pip install --no-deps rembg
```

## Troubleshooting: `scikit-image ... METADATA` error on startup

In rare cases, Forge can fail during `Installing requirements` with an error like:

`failed to open ... scikit_image-<version>.dist-info\\METADATA`

This usually means `scikit-image` metadata in the local `venv` is corrupted (partial/broken install).  
It is not specific to this extension UI code.

Fix (Windows, run from Forge root folder):

```powershell
venv\Scripts\python.exe -m pip uninstall -y scikit-image
venv\Scripts\python.exe -m pip install --no-cache-dir --force-reinstall scikit-image==0.25.2
venv\Scripts\python.exe -m pip check
```

If uninstall fails, remove these folders manually from `venv\Lib\site-packages` and run install again:

- `scikit_image-*.dist-info`
- `skimage`

If the issue still persists, recreate the `venv`.

## Notes

- `Remove BG` works for selected image objects.
- Shape icons are unified (SVG) for consistent toolbar style.

## Stable Status

Verified as stable on two Forge installations by manual testing.
