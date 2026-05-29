import base64
import binascii
import io
import sys
from pathlib import Path

import gradio as gr
from fastapi import Request
from fastapi.responses import JSONResponse
from modules import script_callbacks
from modules.ui_components import ToolButton


_REMBG_SESSION = None
_REMBG_READY = False
_send_to_composer_tab = ""
_send_to_composer_info = None
_LAMA_CLEANER_ROOT = None


COMPOSER_HTML = """
<div id="forge-composer-root" class="forge-composer-root">
    <div class="composer-toolbar">
        <label class="composer-btn composer-icon-btn" title="Add Image" aria-label="Add Image">
            <svg class="composer-toolbar-icon" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.5" ry="1.5"></rect>
                <circle cx="5.3" cy="6.3" r="1.1"></circle>
                <path d="M3.4 11.1l3.1-2.9 1.9 1.8 2.3-2.1 2 3.2"></path>
            </svg>
            <input id="composer-image-upload" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
        </label>

        <button id="composer-add-text-btn" class="composer-btn composer-icon-btn" type="button" title="Add Text" aria-label="Add Text">
            <span class="composer-text-icon">T</span>
        </button>
        <button id="composer-add-triangle-btn" class="composer-btn" type="button" title="Triangle">
            <svg class="composer-shape-icon" viewBox="0 0 16 16" aria-hidden="true">
                <polygon points="8,2.5 13,12.5 3,12.5"></polygon>
            </svg>
        </button>
        <button id="composer-add-rect-btn" class="composer-btn" type="button" title="Square">
            <svg class="composer-shape-icon" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3" y="3" width="10" height="10"></rect>
            </svg>
        </button>
        <button id="composer-add-circle-btn" class="composer-btn" type="button" title="Circle">
            <svg class="composer-shape-icon" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5"></circle>
            </svg>
        </button>
        <button id="composer-add-pentagon-btn" class="composer-btn" type="button" title="Pentagon">
            <svg class="composer-shape-icon" viewBox="0 0 16 16" aria-hidden="true">
                <polygon points="8,2.4 13,6 11.2,12 4.8,12 3,6"></polygon>
            </svg>
        </button>
        <button id="composer-add-hexagon-btn" class="composer-btn" type="button" title="Hexagon">
            <svg class="composer-shape-icon" viewBox="0 0 16 16" aria-hidden="true">
                <polygon points="4,3.5 12,3.5 14,8 12,12.5 4,12.5 2,8"></polygon>
            </svg>
        </button>
        <button id="composer-add-octagon-btn" class="composer-btn" type="button" title="Octagon">
            <svg class="composer-shape-icon" viewBox="0 0 16 16" aria-hidden="true">
                <polygon points="5,2.5 11,2.5 13.5,5 13.5,11 11,13.5 5,13.5 2.5,11 2.5,5"></polygon>
            </svg>
        </button>
        <button id="composer-clear-btn" class="composer-btn" type="button">Clear</button>
        <button id="composer-export-btn" class="composer-btn" type="button">Export</button>
        <button id="composer-export-layer-btn" class="composer-btn" type="button" title="Export selected layer as transparent PNG">Export Layer</button>

        <div class="composer-size-controls">
            <label class="composer-size-label" for="composer-width-slider">
                W:
            </label>
            <input id="composer-width-slider" class="composer-slider" type="range" min="64" max="3072" step="64" value="1024">
            <span id="composer-width-value" class="composer-size-value">1024</span>

            <label class="composer-size-label" for="composer-height-slider">
                H:
            </label>
            <input id="composer-height-slider" class="composer-slider" type="range" min="64" max="3072" step="64" value="1024">
            <span id="composer-height-value" class="composer-size-value">1024</span>
        </div>

        <button id="composer-send-img2img-btn" class="composer-btn composer-btn-primary" type="button">Send to Img2Img</button>
        <button id="composer-send-inpaint-btn" class="composer-btn composer-btn-primary" type="button">Send to Inpaint</button>
        <button id="composer-send-controlnet-t2i-btn" class="composer-btn composer-btn-primary" type="button">Send to ControlNetT2I</button>
        <button id="composer-send-controlnet-i2i-btn" class="composer-btn composer-btn-primary" type="button">Send to ControlNetI2I</button>
    </div>

    <div class="composer-secondary-toolbar" aria-label="Composer secondary tools">
        <div id="composer-draw-overlay" class="composer-draw-overlay">
            <button id="composer-draw-brush-btn" class="composer-draw-tool-btn" type="button" title="Brush">&#128396;</button>
            <button id="composer-draw-eraser-btn" class="composer-draw-tool-btn" type="button" title="Eraser">&#9003;</button>
            <button id="composer-clean-mask-btn" class="composer-draw-tool-btn composer-clean-mask-btn" type="button" title="Remove objects with LaMa Cleaner" disabled>
                <svg class="composer-clean-mask-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4.2 11.8 11.8 4.2"></path>
                    <path d="M5.2 4.2h5.6l1 1v5.6l-1 1H5.2l-1-1V5.2z"></path>
                    <path d="M6.3 7.2c.7-.8 2.4-.8 3.1 0 .6.7.2 1.9-1 2.8"></path>
                    <path d="M8.3 12.6h.1"></path>
                </svg>
            </button>
            <input id="composer-draw-color" class="composer-draw-color" type="color" value="#ff0000" title="Brush Color">

            <label class="composer-draw-label" for="composer-draw-width">
                Width <span id="composer-draw-width-value">25</span>
            </label>
            <input id="composer-draw-width" class="composer-draw-range" type="range" min="1" max="200" step="1" value="25">

            <label class="composer-draw-label" for="composer-draw-opacity">
                Opacity <span id="composer-draw-opacity-value">100</span>
            </label>
            <input id="composer-draw-opacity" class="composer-draw-range" type="range" min="1" max="100" step="1" value="100">

            <label class="composer-draw-label" for="composer-draw-softness">
                Softness <span id="composer-draw-softness-value">0</span>
            </label>
            <input id="composer-draw-softness" class="composer-draw-range" type="range" min="0" max="50" step="1" value="0">
        </div>

        <div id="composer-stage-actions-overlay" class="composer-stage-actions-overlay" aria-label="Composer actions">
            <div class="composer-text-style-controls" aria-label="Text style controls">
                <select id="composer-font-family" class="composer-font-select" title="Font family" aria-label="Font family">
                    <option value="Arial">Arial</option>
                    <option value="Segoe UI">Segoe UI</option>
                    <option value="Tahoma">Tahoma</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Trebuchet MS">Trebuchet MS</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Courier New">Courier New</option>
                    <option value="Impact">Impact</option>
                </select>
                <button id="composer-font-bold-btn" class="composer-btn composer-font-toggle-btn" type="button" title="Bold / Normal" aria-label="Toggle bold">
                    <strong>B</strong>
                </button>
                <button id="composer-font-italic-btn" class="composer-btn composer-font-toggle-btn" type="button" title="Italic / Normal" aria-label="Toggle italic">
                    <em>I</em>
                </button>
            </div>
            <button id="composer-remove-bg-btn" class="composer-btn" type="button">Remove BG</button>
            <button id="composer-layer-up-btn" class="composer-btn" type="button" title="Layer Up">&uarr;</button>
            <button id="composer-layer-down-btn" class="composer-btn" type="button" title="Layer Down">&darr;</button>
            <button id="composer-flip-x-btn" class="composer-btn" type="button" title="Flip Horizontal">&hArr;</button>
            <button id="composer-flip-y-btn" class="composer-btn" type="button" title="Flip Vertical">&vArr;</button>
            <button id="composer-warp-btn" class="composer-btn composer-icon-btn" type="button" title="Warp corners" aria-label="Warp corners">
                <svg class="composer-toolbar-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <polygon points="3,3.5 13,2.5 12,12.5 4,13.5"></polygon>
                    <circle cx="3" cy="3.5" r="1.1"></circle>
                    <circle cx="13" cy="2.5" r="1.1"></circle>
                    <circle cx="12" cy="12.5" r="1.1"></circle>
                    <circle cx="4" cy="13.5" r="1.1"></circle>
                </svg>
            </button>
            <button id="composer-cover-canvas-btn" class="composer-btn composer-icon-btn" type="button" title="Cover canvas" aria-label="Cover canvas">
                <svg class="composer-toolbar-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M6.4 6.4 3 3"></path>
                    <path d="M3 3h3.2"></path>
                    <path d="M3 3v3.2"></path>
                    <path d="M9.6 6.4 13 3"></path>
                    <path d="M13 3H9.8"></path>
                    <path d="M13 3v3.2"></path>
                    <path d="M6.4 9.6 3 13"></path>
                    <path d="M3 13h3.2"></path>
                    <path d="M3 13V9.8"></path>
                    <path d="M9.6 9.6 13 13"></path>
                    <path d="M13 13H9.8"></path>
                    <path d="M13 13V9.8"></path>
                </svg>
            </button>
            <button id="composer-undo-btn" class="composer-btn composer-history-btn" type="button" title="Undo" aria-label="Undo">
                <span class="composer-history-glyph" aria-hidden="true">&#8630;</span>
            </button>
            <button id="composer-redo-btn" class="composer-btn composer-history-btn" type="button" title="Redo" aria-label="Redo">
                <span class="composer-history-glyph" aria-hidden="true">&#8631;</span>
            </button>
        </div>

        <div id="composer-opacity-overlay" class="composer-opacity-overlay">
            <label class="composer-opacity-label" for="composer-object-opacity">
                Opacity <span id="composer-object-opacity-value">100</span>
            </label>
            <input id="composer-object-opacity" class="composer-opacity-range" type="range" min="0" max="100" step="1" value="100">
        </div>
    </div>

    <div class="composer-stage-wrap">
        <canvas id="forge-composer-canvas"></canvas>
        <div id="composer-layers-panel" class="composer-layers-panel" aria-label="Layers panel">
            <div id="composer-layers-list" class="composer-layers-list"></div>
        </div>
        <div id="composer-canvas-bg-overlay" class="composer-canvas-bg-overlay" aria-label="Canvas background color">
            <input id="composer-canvas-bg-color" class="composer-canvas-bg-color" type="color" value="#000000" title="Canvas background color">
        </div>
        <div id="composer-grid-controls-overlay" class="composer-grid-controls-overlay" aria-label="Grid controls">
            <span class="composer-grid-label">Grid</span>
            <div class="composer-grid-buttons" role="group" aria-label="Grid divisions">
                <button class="composer-grid-btn is-active" type="button" data-grid-value="1">1</button>
                <button class="composer-grid-btn" type="button" data-grid-value="2">2</button>
                <button class="composer-grid-btn" type="button" data-grid-value="3">3</button>
                <button class="composer-grid-btn" type="button" data-grid-value="4">4</button>
            </div>
        </div>
        <div id="composer-grid-overlay" class="composer-grid-overlay" aria-hidden="true"></div>
    </div>

    <div class="composer-footer">
        <span id="composer-status">Ready</span>
        <div class="composer-hotkeys" aria-label="Composer hotkeys">
            <ul class="composer-hotkeys-row">
                <li><kbd>Shift</kbd> + click/drag: multi-select</li>
                <li><kbd>Delete</kbd>: delete selection</li>
                <li><kbd>B</kbd>: brush (press again to turn off)</li>
                <li><kbd>E</kbd>: eraser (press again to turn off)</li>
                <li><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>D</kbd>: duplicate</li>
                <li><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>V</kbd>: paste image from clipboard</li>
            </ul>
            <ul class="composer-hotkeys-row">
                <li><kbd>Ctrl</kbd> + wheel: scale selected object</li>
                <li><kbd>Alt</kbd> + wheel: brush/eraser size</li>
                <li>Hold <kbd>MMB</kbd> + drag: pan viewport</li>
                <li><kbd>Z</kbd> + wheel / hold <kbd>MMB</kbd> + wheel: zoom viewport</li>
                <li><kbd>Shift</kbd> + drop: add as background</li>
            </ul>
        </div>
    </div>
</div>
"""


def on_ui_tabs():
    with gr.Blocks(analytics_enabled=False) as composer_block:
        gr.HTML(COMPOSER_HTML)
        gr.Textbox(elem_id="composer-exported-image", visible=False)
        gr.Button("ExportTrigger", elem_id="composer-export-trigger", visible=False)

    return [(composer_block, "Composer", "composer_tab")]


def _keep_send_to_composer_info(info):
    return info


def on_after_component(component, **kwargs):
    global _send_to_composer_tab, _send_to_composer_info

    element = kwargs.get("elem_id")
    if element in ["txt2img_gallery", "img2img_gallery"]:
        _send_to_composer_tab = element.split("_", 1)[0]
        with gr.Column():
            _send_to_composer_info = gr.HTML(
                value="",
                elem_id=f"{_send_to_composer_tab}_composer_send_info",
                visible=False,
            )
        return

    send_extras_name_old = "extras_tab"
    send_extras_name_new = f"{_send_to_composer_tab}_send_to_extras"
    if element not in (send_extras_name_old, send_extras_name_new) or not _send_to_composer_tab:
        return

    tab = _send_to_composer_tab
    if element == send_extras_name_old:
        send_button = gr.Button(value="▭", elem_id=f"{tab}_send_to_composer")
    else:
        send_button = ToolButton(
            "▭",
            elem_id=f"{tab}_send_to_composer",
            elem_classes=["composer-send-gallery-button"],
            tooltip="Send to Composer",
        )

    send_button.click(
        fn=_keep_send_to_composer_info,
        inputs=[_send_to_composer_info],
        outputs=[_send_to_composer_info],
        _js=f"{tab}_composer_send_selected_to_composer",
    )
    _send_to_composer_tab = ""


def _parse_data_url(payload: str) -> bytes:
    if not payload or not isinstance(payload, str):
        raise ValueError("Empty image payload")
    if "," not in payload:
        raise ValueError("Invalid image payload format")

    _, b64_data = payload.split(",", 1)
    try:
        return base64.b64decode(b64_data)
    except (binascii.Error, ValueError) as err:
        raise ValueError("Invalid base64 image data") from err


def _run_rembg(image_bytes: bytes) -> bytes:
    global _REMBG_SESSION, _REMBG_READY

    try:
        from rembg import new_session, remove
        _REMBG_READY = True
    except Exception as err:
        raise RuntimeError(
            "rembg is unavailable in current Forge environment. "
            f"Import error: {err}"
        ) from err

    if _REMBG_SESSION is None:
        _REMBG_SESSION = new_session()

    return remove(image_bytes, session=_REMBG_SESSION)


def _get_default_lama_cleaner_roots() -> list[Path]:
    roots = []
    try:
        from modules import paths

        for value in [
            getattr(paths, "extensions_dir", None),
            getattr(paths, "extensions_builtin_dir", None),
        ]:
            if value:
                roots.append(Path(value))
    except Exception:
        pass

    extension_root = Path(__file__).resolve().parents[1]
    roots.extend([
        extension_root.parent,
        extension_root.parent / "forge-neo-lama-cleaner",
    ])

    unique = []
    seen = set()
    for root in roots:
        try:
            resolved = root.resolve()
        except Exception:
            resolved = root
        key = str(resolved).lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(root)
    return unique


def _find_lama_cleaner_root(search_roots=None) -> Path | None:
    roots = [Path(root) for root in (search_roots or _get_default_lama_cleaner_roots())]
    candidates = []
    for root in roots:
        candidates.extend([
            root,
            root / "forge-neo-lama-cleaner",
            root / "lama-cleaner-masked-content",
        ])

    for candidate in candidates:
        package_dir = candidate / "lama_cleaner_masked_content"
        if (
            package_dir.is_dir()
            and (package_dir / "inpaint.py").is_file()
            and (package_dir / "options.py").is_file()
        ):
            return candidate
    return None


def _get_lama_cleaner_status(search_roots=None) -> dict:
    root = _find_lama_cleaner_root(search_roots)
    if not root:
        return {
            "available": False,
            "error": "LaMa Cleaner extension not found",
        }

    try:
        _import_lama_cleaner(root)
    except Exception as err:
        return {
            "available": False,
            "path": str(root),
            "error": f"LaMa Cleaner import failed: {err}",
        }

    return {
        "available": True,
        "path": str(root),
    }


def _import_lama_cleaner(root: Path | None = None):
    global _LAMA_CLEANER_ROOT

    root = Path(root) if root else _find_lama_cleaner_root()
    if not root:
        raise RuntimeError("LaMa Cleaner extension not found")

    root_str = str(root)
    if root_str not in sys.path:
        sys.path.insert(0, root_str)

    from lama_cleaner_masked_content.inpaint import lamaInpaint
    from lama_cleaner_masked_content.options import getLamaUpscaler, getResolution

    _LAMA_CLEANER_ROOT = root
    return lamaInpaint, getLamaUpscaler, getResolution


def _get_lama_cleaner_upscaler(getLamaUpscaler) -> str:
    upscaler = getLamaUpscaler()
    try:
        from modules import shared

        available = {item.name for item in getattr(shared, "sd_upscalers", [])}
        if upscaler in available:
            return upscaler
    except Exception:
        pass

    return "None"


def _run_lama_cleaner(
    image_bytes: bytes,
    mask_bytes: bytes,
    *,
    blur: int = 2,
    padding: int | None = 90,
    search_roots=None,
) -> bytes:
    try:
        from PIL import Image
    except Exception as err:
        raise RuntimeError(f"Pillow is unavailable: {err}") from err

    lamaInpaint, getLamaUpscaler, getResolution = _import_lama_cleaner(
        _find_lama_cleaner_root(search_roots)
    )

    image = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    mask = Image.open(io.BytesIO(mask_bytes)).convert("L")
    if mask.size != image.size:
        mask = mask.resize(image.size)

    if not mask.getbbox():
        raise ValueError("Mask is empty")

    result = lamaInpaint(
        image,
        mask,
        0,
        _get_lama_cleaner_upscaler(getLamaUpscaler),
        padding,
        getResolution(),
        max(0, int(blur)),
    )
    output = io.BytesIO()
    result.convert("RGBA").save(output, format="PNG")
    return output.getvalue()


def _route_exists(app, route_path: str) -> bool:
    return any(getattr(route, "path", None) == route_path for route in app.router.routes)


def on_app_started(_, app):
    route_path = "/forge-composer/remove-bg"
    if not _route_exists(app, route_path):
        @app.post(route_path)
        async def composer_remove_bg(request: Request):
            try:
                data = await request.json()
                image_data_url = data.get("image")
                input_bytes = _parse_data_url(image_data_url)
                output_bytes = _run_rembg(input_bytes)
                output_b64 = base64.b64encode(output_bytes).decode("ascii")
                return JSONResponse({"ok": True, "image": f"data:image/png;base64,{output_b64}"})
            except Exception as err:
                return JSONResponse({"ok": False, "error": str(err)}, status_code=400)

    status_route_path = "/forge-composer/clean-mask/status"
    if not _route_exists(app, status_route_path):
        @app.get(status_route_path)
        async def composer_clean_mask_status():
            return JSONResponse({"ok": True, **_get_lama_cleaner_status()})

    clean_route_path = "/forge-composer/clean-mask"
    if not _route_exists(app, clean_route_path):
        @app.post(clean_route_path)
        async def composer_clean_mask(request: Request):
            try:
                data = await request.json()
                image_bytes = _parse_data_url(data.get("image"))
                mask_bytes = _parse_data_url(data.get("mask"))
                blur = int(data.get("blur", 2))
                padding_value = data.get("padding", 90)
                padding = None if padding_value in (None, "", -1) else int(padding_value)
                output_bytes = _run_lama_cleaner(image_bytes, mask_bytes, blur=blur, padding=padding)
                output_b64 = base64.b64encode(output_bytes).decode("ascii")
                return JSONResponse({"ok": True, "image": f"data:image/png;base64,{output_b64}"})
            except Exception as err:
                return JSONResponse({"ok": False, "error": str(err)}, status_code=400)


script_callbacks.on_ui_tabs(on_ui_tabs)
script_callbacks.on_app_started(on_app_started)
script_callbacks.on_after_component(on_after_component)
