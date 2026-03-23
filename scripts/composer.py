import base64
import binascii

import gradio as gr
from fastapi import Request
from fastapi.responses import JSONResponse
from modules import script_callbacks


_REMBG_SESSION = None
_REMBG_READY = False


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
        <button id="composer-clear-btn" class="composer-btn" type="button">Clear</button>
        <button id="composer-export-btn" class="composer-btn" type="button">Export</button>

        <div class="composer-size-controls">
            <label class="composer-size-label" for="composer-width-slider">
                W:
            </label>
            <input id="composer-width-slider" class="composer-slider" type="range" min="64" max="2048" step="64" value="1024">
            <span id="composer-width-value" class="composer-size-value">1024</span>

            <label class="composer-size-label" for="composer-height-slider">
                H:
            </label>
            <input id="composer-height-slider" class="composer-slider" type="range" min="64" max="2048" step="64" value="1024">
            <span id="composer-height-value" class="composer-size-value">1024</span>
        </div>

        <button id="composer-send-img2img-btn" class="composer-btn composer-btn-primary" type="button">Send to Img2Img</button>
        <button id="composer-send-inpaint-btn" class="composer-btn composer-btn-primary" type="button">Send to Inpaint</button>
        <button id="composer-send-controlnet-t2i-btn" class="composer-btn composer-btn-primary" type="button">Send to ControlNetT2I</button>
        <button id="composer-send-controlnet-i2i-btn" class="composer-btn composer-btn-primary" type="button">Send to ControlNetI2I</button>
    </div>

    <div class="composer-stage-wrap">
        <canvas id="forge-composer-canvas"></canvas>
        <div id="composer-stage-actions-overlay" class="composer-stage-actions-overlay" aria-label="Composer actions">
            <button id="composer-remove-bg-btn" class="composer-btn" type="button">Remove BG</button>
            <button id="composer-layer-up-btn" class="composer-btn" type="button" title="Layer Up">&uarr;</button>
            <button id="composer-layer-down-btn" class="composer-btn" type="button" title="Layer Down">&darr;</button>
            <button id="composer-flip-x-btn" class="composer-btn" type="button" title="Flip Horizontal">&hArr;</button>
            <button id="composer-flip-y-btn" class="composer-btn" type="button" title="Flip Vertical">&vArr;</button>
            <button id="composer-undo-btn" class="composer-btn composer-history-btn" type="button" title="Undo" aria-label="Undo">
                <span class="composer-history-glyph" aria-hidden="true">&#8630;</span>
            </button>
            <button id="composer-redo-btn" class="composer-btn composer-history-btn" type="button" title="Redo" aria-label="Redo">
                <span class="composer-history-glyph" aria-hidden="true">&#8631;</span>
            </button>
            <label class="composer-btn composer-color-only" for="composer-text-color" title="Color" aria-label="Color">
                <input id="composer-text-color" class="composer-color-picker" type="color" value="#ffffff">
            </label>
        </div>
        <div id="composer-draw-overlay" class="composer-draw-overlay">
            <button id="composer-draw-brush-btn" class="composer-draw-tool-btn" type="button" title="Brush">&#128396;</button>
            <button id="composer-draw-eraser-btn" class="composer-draw-tool-btn" type="button" title="Eraser">&#9003;</button>
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

        <div id="composer-opacity-overlay" class="composer-opacity-overlay">
            <label class="composer-opacity-label" for="composer-object-opacity">
                Opacity <span id="composer-object-opacity-value">100</span>
            </label>
            <input id="composer-object-opacity" class="composer-opacity-range" type="range" min="0" max="100" step="1" value="100">
        </div>
    </div>

    <div class="composer-footer">
        <span id="composer-status">Ready</span>
        <div class="composer-hotkeys" aria-label="Composer hotkeys">
            <ul class="composer-hotkeys-row">
                <li><kbd>Shift</kbd> + click/drag: multi-select</li>
                <li><kbd>Delete</kbd>: delete selection</li>
                <li><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>D</kbd>: duplicate</li>
                <li><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>V</kbd>: paste image from clipboard</li>
            </ul>
            <ul class="composer-hotkeys-row">
                <li><kbd>Ctrl</kbd> + wheel: scale selected object</li>
                <li><kbd>Alt</kbd> + wheel: brush/eraser size</li>
                <li>Hold <kbd>MMB</kbd> + drag: pan viewport</li>
                <li>Hold <kbd>MMB</kbd> + wheel: zoom viewport</li>
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


def on_app_started(_, app):
    route_path = "/forge-composer/remove-bg"
    if any(getattr(route, "path", None) == route_path for route in app.router.routes):
        return

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


script_callbacks.on_ui_tabs(on_ui_tabs)
script_callbacks.on_app_started(on_app_started)
