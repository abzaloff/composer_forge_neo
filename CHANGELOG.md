# Changelog

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
