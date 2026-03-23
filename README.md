# composer_forge_neo

Composer extension for Forge/Neo that helps build scene layouts before Img2Img/Inpaint.

<img width="1697" height="729" alt="777" src="https://github.com/user-attachments/assets/7838759c-12f5-457d-8832-cae8513c686d" />

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
- Add geometric shapes: square, circle, pentagon, hexagon
- Change fill color for text and shapes (`Color`)
- Layer ordering (`up` / `down`)
- Flip selected objects (horizontal / vertical)
- Export scene to PNG
- Send scene directly to Img2Img, Inpaint, ControlNet T2I, or ControlNet I2I
- Adjustable canvas size

## Keyboard Shortcuts

- `Delete` - remove selected object(s)
- `Ctrl+D` - duplicate selected object(s)
- `Ctrl+V` / `Cmd+V` - paste image from clipboard
- `Ctrl + Mouse Wheel` - scale selected object
- `Alt + Mouse Wheel` - change brush/eraser size
- `Middle Mouse (hold) + Drag` - pan viewport
- `Middle Mouse (hold) + Wheel` - zoom viewport
- `Shift + Drop` - drop image as background (first file)

## Dependency: rembg

This extension requires `rembg` for background removal.

- Automatic install: `install.py` tries to install `rembg` on Forge startup.
- If automatic install fails, install manually in Forge venv:

```powershell
venv\Scripts\activate
pip install rembg
```

Or without activating venv:

```powershell
venv\Scripts\python.exe -m pip install rembg
```

## Notes

- `Remove BG` works for selected image objects.
- Shape icons are unified (SVG) for consistent toolbar style.

## Stable Status

Verified as stable on two Forge installations by manual testing.
