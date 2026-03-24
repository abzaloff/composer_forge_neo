# Changelog

## [stable] - 2026-03-24

### Added

- New shape tools: triangle (first in shape list) and octagon (last in shape list)
- Drawing hotkeys: `B` (brush toggle), `E` (eraser toggle)
- `Alt + Mouse Wheel` shortcut to change brush/eraser size
- Unified color picker: one control (near brush/eraser) for brush and text/shape color

### Changed

- In-canvas overlays moved to a centered second toolbar row; canvas area is now clean
- Top toolbar row aligned to center
- Stage visual height increased from `512px` to `640px`

### Fixed

- `Ctrl + Mouse Wheel` scaling for selected objects now keeps center pivot (including images)
- Flip behavior for groups now mirrors as a whole (left/right swap is correct)
- Flip behavior for single objects now mirrors with stable center handling
- Undo after flip now reverts only the flip action (not the preceding move)

## [stable] - 2026-03-22

### Added

- Scene composer tab with Fabric.js canvas
- Image upload and object placement
- Text tool (`Add Text`)
- Shape tools (square, circle, pentagon, hexagon)
- Color tool for text and shapes
- Layer controls (move selected object up/down)
- Flip controls (horizontal/vertical)
- `Delete` shortcut for selected object(s)
- `Ctrl+D` shortcut for object duplication
- Export to PNG
- Send to Img2Img / Inpaint
- Background removal (`Remove BG`) via `rembg`
- Install logging markers in `install.py` (`[composer_forge_neo] ...`)

### Changed

- Toolbar compactness improvements
- Canvas size controls layout (value labels moved to right side)
- Button labels simplified (`Apply`, `Clear`, `Export`)
- Unified shape icon style (SVG)
- Default shape style updated (no yellow stroke)

### Fixed

- Duplicated shapes (`Ctrl+D`) now keep color-edit compatibility
- Toolbar/icon consistency issues

### Dependency

- `rembg` is installed automatically by extension `install.py`
- Manual fallback remains available when auto-install is blocked
