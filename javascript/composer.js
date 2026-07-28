(function () {
    let composerInitialized = false;
    let canvas = null;
    let backgroundObject = null;
    let fabricLoadPromise = null;
    const STAGE_MIN_HEIGHT = 512;
    const STAGE_MAX_HEIGHT = 1024;
    const STAGE_DEFAULT_HEIGHT = 640;
    const STAGE_STEP = 64;
    const LAYERS_PANEL_RESERVE = 64;
    const LAYERS_PANEL_GAP = 8;
    const MIN_SCENE_SIZE = 64;
    const MAX_SCENE_SIZE = 3072;
    const SCENE_STEP = 64;
    const MOSAIC_TILE_SIZE = 32;
    const MOSAIC_TYPE = "mosaicOutpaint";
    const MOSAIC_OVERLAP_PREVIEW_TYPE = "mosaicOverlapPreview";
    let sceneWidth = 1024;
    let sceneHeight = 1024;
    let stageHeight = STAGE_DEFAULT_HEIGHT;
    let displayScale = 1;
    let gridDivisions = 1;
    let mosaicTileWidth = MOSAIC_TILE_SIZE;
    let mosaicTileHeight = MOSAIC_TILE_SIZE;
    let mosaicMaskOverlap = 0.1;
    let mosaicSourceObject = null;
    let mosaicControlsVisible = false;
    let lastSelectedImageObject = null;
    let mosaicOverlapPreviewObjects = [];
    let mosaicOverlapPreviewSuspended = false;
    let currentTextColor = "#ffffff";
    let currentTextFontFamily = "Arial";
    let currentTextFontWeight = "400";
    let currentTextFontStyle = "normal";
    let currentCanvasBackgroundColor = "#000000";
    let removeBgInFlight = false;
    let cleanMaskAvailable = false;
    let cleanMaskInFlight = false;
    let drawingTool = null;
    let drawColor = "#ff0000";
    let drawWidth = 25;
    let drawOpacity = 100;
    let drawSoftness = 0;
    let drawCursorEl = null;
    let eraserScopeSnapshot = [];
    let lastEraserTargets = [];
    let eraserFallbackActive = false;
    let eraserFallbackDrawing = false;
    let eraserFallbackTarget = null;
    let middlePanActive = false;
    let middlePanLastX = 0;
    let middlePanLastY = 0;
    let viewportZoom = 1;
    let zViewportZoomActive = false;
    const HISTORY_LIMIT = 80;
    const HISTORY_CAPTURE_DELAY_MS = 140;
    let historyUndoStack = [];
    let historyRedoStack = [];
    let historyCaptureTimer = null;
    let historyRestoring = false;
    let lockedLayerObject = null;
    let pointerDragTargetLockActive = false;
    let pointerDragTargetLockPrevSkipFind = false;
    let shiftMoveAxisLock = null;
    let shiftCropRasterizing = false;
    let pendingExternalImages = [];
    let warpEditObject = null;
    let warpDragCorner = null;
    let cleanMaskPreviewObject = null;
    let cleanMaskTargetObject = null;
    let cleanMaskPreviewRevision = 0;
    const WARP_CORNER_KEYS = ["tl", "tr", "br", "bl"];
    const CLEAN_MASK_TYPE = "cleanMask";
    const CLEAN_MASK_CLOSED_FILL = "rgba(255, 48, 48, 0.46)";

    function setStatus(text) {
        const el = document.getElementById("composer-status");
        if (el) {
            el.textContent = text;
            el.style.display = "inline-block";
            el.style.padding = "6px 10px";
            el.style.marginTop = "8px";
            el.style.background = "rgba(255,140,0,0.08)";
            el.style.border = "1px solid rgba(255,140,0,0.35)";
            el.style.borderRadius = "8px";
            el.style.color = "#f0f0f0";
        }
        console.log("[Composer]", text);
    }

    function refreshBackgroundReference() {
        if (!canvas) {
            backgroundObject = null;
            return;
        }
        backgroundObject = canvas.getObjects().find((obj) => obj?.composerType === "background") || null;
    }

    function mountStageActionsOverlay() {
        const overlay = document.getElementById("composer-stage-actions-overlay");
        const secondRow = document.querySelector(".composer-secondary-toolbar");
        if (!overlay || !secondRow) return;
        if (overlay.parentElement !== secondRow) {
            secondRow.appendChild(overlay);
        }
    }

    function clampGridDivisions(value) {
        const numeric = Number(value) || 1;
        return Math.max(1, Math.min(4, Math.round(numeric)));
    }

    function syncGridControl() {
        const buttons = document.querySelectorAll(".composer-grid-btn");
        if (!buttons || buttons.length === 0) return;
        buttons.forEach((btn) => {
            const value = clampGridDivisions(btn.dataset.gridValue);
            const isActive = value === gridDivisions;
            btn.classList.toggle("is-active", isActive);
            btn.setAttribute("aria-pressed", isActive ? "true" : "false");
        });
    }

    function syncGridOverlay() {
        const overlay = document.getElementById("composer-grid-overlay");
        const stageWrap = document.querySelector(".composer-stage-wrap");
        const canvasWrap = canvas?.wrapperEl;
        if (!overlay || !stageWrap || !canvasWrap || !canvas) return;

        const displayWidth = Math.max(1, Math.round(canvas.getWidth()));
        const displayHeight = Math.max(1, Math.round(canvas.getHeight()));
        overlay.style.left = `${Math.round(canvasWrap.offsetLeft)}px`;
        overlay.style.top = `${Math.round(canvasWrap.offsetTop)}px`;
        overlay.style.width = `${displayWidth}px`;
        overlay.style.height = `${displayHeight}px`;

        while (overlay.firstChild) {
            overlay.removeChild(overlay.firstChild);
        }

        if (gridDivisions <= 1) {
            overlay.style.display = "none";
            return;
        }

        overlay.style.display = "block";

        const createLine = (axis, positionPx) => {
            const line = document.createElement("div");
            line.className = axis === "x" ? "composer-grid-line-v" : "composer-grid-line-h";
            if (axis === "x") {
                line.style.left = `${Math.round(positionPx)}px`;
            } else {
                line.style.top = `${Math.round(positionPx)}px`;
            }
            overlay.appendChild(line);
        };

        for (let i = 1; i < gridDivisions; i += 1) {
            const x = (displayWidth * i) / gridDivisions;
            const y = (displayHeight * i) / gridDivisions;
            createLine("x", x);
            createLine("y", y);
        }
    }

    function setGridDivisions(value, silent = false) {
        const next = clampGridDivisions(value);
        if (next === gridDivisions) {
            syncGridControl();
            syncGridOverlay();
            return;
        }
        gridDivisions = next;
        syncGridControl();
        syncGridOverlay();
        if (!silent) {
            if (gridDivisions === 1) {
                setStatus("Grid disabled");
            } else {
                setStatus(`Grid ${gridDivisions}x${gridDivisions} enabled`);
            }
        }
    }

    function bindGridControls() {
        const overlay = document.getElementById("composer-grid-controls-overlay");
        const buttons = document.querySelectorAll(".composer-grid-btn");
        if (!overlay || !buttons || buttons.length === 0 || overlay.dataset.bound === "1") return;
        syncGridControl();
        buttons.forEach((btn) => {
            btn.addEventListener("click", () => {
                setGridDivisions(btn.dataset.gridValue, false);
            });
        });
        overlay.dataset.bound = "1";
    }

    function clampRangeInputValue(input, fallback) {
        const min = Number(input?.min);
        const max = Number(input?.max);
        const raw = Number(input?.value);
        const safeMin = Number.isFinite(min) ? min : 0;
        const safeMax = Number.isFinite(max) ? max : Number.MAX_SAFE_INTEGER;
        const value = Number.isFinite(raw) ? raw : fallback;
        return Math.max(safeMin, Math.min(safeMax, value));
    }

    function syncMosaicControls() {
        const tileW = document.getElementById("composer-mosaic-tile-w");
        const tileH = document.getElementById("composer-mosaic-tile-h");
        const overlap = document.getElementById("composer-mosaic-mask-overlap");
        const tileWValue = document.getElementById("composer-mosaic-tile-w-value");
        const tileHValue = document.getElementById("composer-mosaic-tile-h-value");
        const overlapValue = document.getElementById("composer-mosaic-mask-overlap-value");

        if (tileW) tileW.value = String(mosaicTileWidth);
        if (tileH) tileH.value = String(mosaicTileHeight);
        if (overlap) overlap.value = String(Math.round(mosaicMaskOverlap * 100));
        if (tileWValue) tileWValue.textContent = String(mosaicTileWidth);
        if (tileHValue) tileHValue.textContent = String(mosaicTileHeight);
        if (overlapValue) overlapValue.textContent = `${Math.round(mosaicMaskOverlap * 100)}%`;
    }

    function setMosaicControlsVisible(visible) {
        mosaicControlsVisible = Boolean(visible);
        const panel = document.getElementById("composer-mosaic-panel");
        panel?.classList.toggle("is-visible", mosaicControlsVisible);
        if (!mosaicControlsVisible) {
            clearMosaicOverlapPreview();
            canvas?.requestRenderAll?.();
        }
    }

    function refreshMosaicLayerIfPresent() {
        const mosaic = getExistingMosaicLayer();
        if (!mosaic) return;
        const source = getLiveMosaicSourceObject();
        if (!source) return;
        upsertMosaicOutpaintLayer(source, true);
    }

    function bindMosaicControls() {
        const panel = document.getElementById("composer-mosaic-panel");
        const tileW = document.getElementById("composer-mosaic-tile-w");
        const tileH = document.getElementById("composer-mosaic-tile-h");
        const overlap = document.getElementById("composer-mosaic-mask-overlap");
        if (!panel || !tileW || !tileH || !overlap || panel.dataset.bound === "1") return;

        syncMosaicControls();

        tileW.addEventListener("input", () => {
            mosaicTileWidth = Math.round(clampRangeInputValue(tileW, MOSAIC_TILE_SIZE));
            syncMosaicControls();
            refreshMosaicLayerIfPresent();
        });
        tileH.addEventListener("input", () => {
            mosaicTileHeight = Math.round(clampRangeInputValue(tileH, MOSAIC_TILE_SIZE));
            syncMosaicControls();
            refreshMosaicLayerIfPresent();
        });
        overlap.addEventListener("input", () => {
            mosaicMaskOverlap = clampRangeInputValue(overlap, 10) / 100;
            syncMosaicControls();
            syncMosaicOverlapPreview();
        });

        panel.dataset.bound = "1";
    }

    function cloneWarpCorners(corners) {
        const copy = {};
        WARP_CORNER_KEYS.forEach((key) => {
            const point = corners?.[key] || { x: 0, y: 0 };
            copy[key] = {
                x: Number(point.x) || 0,
                y: Number(point.y) || 0
            };
        });
        return copy;
    }

    function defaultWarpCorners(width, height) {
        const hw = (Number(width) || 0) / 2;
        const hh = (Number(height) || 0) / 2;
        return {
            tl: { x: -hw, y: -hh },
            tr: { x: hw, y: -hh },
            br: { x: hw, y: hh },
            bl: { x: -hw, y: hh }
        };
    }

    function normalizeWarpCorners(corners, width, height) {
        const fallback = defaultWarpCorners(width, height);
        const normalized = {};
        WARP_CORNER_KEYS.forEach((key) => {
            const point = corners?.[key] || fallback[key];
            normalized[key] = {
                x: Number.isFinite(Number(point.x)) ? Number(point.x) : fallback[key].x,
                y: Number.isFinite(Number(point.y)) ? Number(point.y) : fallback[key].y
            };
        });
        return normalized;
    }

    function getWarpSignedArea(corners) {
        const pts = WARP_CORNER_KEYS.map((key) => corners[key]);
        let area = 0;
        for (let i = 0; i < pts.length; i += 1) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            area += a.x * b.y - b.x * a.y;
        }
        return area / 2;
    }

    function crossPoints(a, b, c) {
        return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    }

    function isValidWarpCorners(corners, expectedOrientation) {
        const pts = WARP_CORNER_KEYS.map((key) => corners[key]);
        const area = getWarpSignedArea(corners);
        const orientation = Math.sign(area);
        const requiredOrientation = expectedOrientation || orientation;
        if (!orientation || orientation !== requiredOrientation) return false;
        if (Math.abs(area) < 16) return false;

        for (let i = 0; i < pts.length; i += 1) {
            const prev = pts[(i + pts.length - 1) % pts.length];
            const cur = pts[i];
            const next = pts[(i + 1) % pts.length];
            const cross = crossPoints(prev, cur, next);
            if (Math.sign(cross) !== requiredOrientation || Math.abs(cross) < 4) {
                return false;
            }
        }

        return true;
    }

    function interpolateWarpPoint(corners, u, v) {
        const topX = corners.tl.x + (corners.tr.x - corners.tl.x) * u;
        const topY = corners.tl.y + (corners.tr.y - corners.tl.y) * u;
        const bottomX = corners.bl.x + (corners.br.x - corners.bl.x) * u;
        const bottomY = corners.bl.y + (corners.br.y - corners.bl.y) * u;
        return {
            x: topX + (bottomX - topX) * v,
            y: topY + (bottomY - topY) * v
        };
    }

    function applyTriangleImageTransform(ctx, dst0, dst1, dst2, src0, src1, src2, imgW, imgH) {
        const sx0 = src0.u * imgW;
        const sy0 = src0.v * imgH;
        const sx1 = src1.u * imgW;
        const sy1 = src1.v * imgH;
        const sx2 = src2.u * imgW;
        const sy2 = src2.v * imgH;
        const den = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
        if (Math.abs(den) < 0.00001) return false;

        const a = (dst0.x * (sy1 - sy2) + dst1.x * (sy2 - sy0) + dst2.x * (sy0 - sy1)) / den;
        const b = (dst0.y * (sy1 - sy2) + dst1.y * (sy2 - sy0) + dst2.y * (sy0 - sy1)) / den;
        const c = (dst0.x * (sx2 - sx1) + dst1.x * (sx0 - sx2) + dst2.x * (sx1 - sx0)) / den;
        const d = (dst0.y * (sx2 - sx1) + dst1.y * (sx0 - sx2) + dst2.y * (sx1 - sx0)) / den;
        const e = (
            dst0.x * (sx1 * sy2 - sx2 * sy1)
            + dst1.x * (sx2 * sy0 - sx0 * sy2)
            + dst2.x * (sx0 * sy1 - sx1 * sy0)
        ) / den;
        const f = (
            dst0.y * (sx1 * sy2 - sx2 * sy1)
            + dst1.y * (sx2 * sy0 - sx0 * sy2)
            + dst2.y * (sx0 * sy1 - sx1 * sy0)
        ) / den;

        ctx.transform(a, b, c, d, e, f);
        return true;
    }

    function expandPointFromCentroid(point, centroid, amount) {
        const dx = point.x - centroid.x;
        const dy = point.y - centroid.y;
        const len = Math.max(0.0001, Math.hypot(dx, dy));
        return {
            x: point.x + (dx / len) * amount,
            y: point.y + (dy / len) * amount
        };
    }

    function drawWarpedTriangle(ctx, element, dst0, dst1, dst2, src0, src1, src2, imgW, imgH) {
        const centroid = {
            x: (dst0.x + dst1.x + dst2.x) / 3,
            y: (dst0.y + dst1.y + dst2.y) / 3
        };
        const overlap = 1.1;
        const clip0 = expandPointFromCentroid(dst0, centroid, overlap);
        const clip1 = expandPointFromCentroid(dst1, centroid, overlap);
        const clip2 = expandPointFromCentroid(dst2, centroid, overlap);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(clip0.x, clip0.y);
        ctx.lineTo(clip1.x, clip1.y);
        ctx.lineTo(clip2.x, clip2.y);
        ctx.closePath();
        ctx.clip();

        if (applyTriangleImageTransform(ctx, dst0, dst1, dst2, src0, src1, src2, imgW, imgH)) {
            ctx.drawImage(element, 0, 0, imgW, imgH);
        }

        ctx.restore();
    }

    function solveLinearSystem(matrix, values) {
        const n = values.length;
        const a = matrix.map((row, idx) => row.concat(values[idx]));
        for (let col = 0; col < n; col += 1) {
            let pivot = col;
            for (let row = col + 1; row < n; row += 1) {
                if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
            }
            if (Math.abs(a[pivot][col]) < 0.0000001) return null;
            if (pivot !== col) {
                const tmp = a[col];
                a[col] = a[pivot];
                a[pivot] = tmp;
            }
            const div = a[col][col];
            for (let k = col; k <= n; k += 1) a[col][k] /= div;
            for (let row = 0; row < n; row += 1) {
                if (row === col) continue;
                const factor = a[row][col];
                if (!factor) continue;
                for (let k = col; k <= n; k += 1) {
                    a[row][k] -= factor * a[col][k];
                }
            }
        }
        return a.map((row) => row[n]);
    }

    function computeDestToUvHomography(corners) {
        const pairs = [
            [corners.tl, 0, 0],
            [corners.tr, 1, 0],
            [corners.br, 1, 1],
            [corners.bl, 0, 1]
        ];
        const matrix = [];
        const values = [];
        pairs.forEach(([p, u, v]) => {
            matrix.push([p.x, p.y, 1, 0, 0, 0, -u * p.x, -u * p.y]);
            values.push(u);
            matrix.push([0, 0, 0, p.x, p.y, 1, -v * p.x, -v * p.y]);
            values.push(v);
        });
        const h = solveLinearSystem(matrix, values);
        if (!h) return null;
        return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
    }

    function getWarpWebglProgram(gl) {
        if (gl.__composerWarpProgram) return gl.__composerWarpProgram;

        const vertexSource = `
            attribute vec2 a_position;
            uniform vec2 u_min;
            uniform vec2 u_size;
            varying vec2 v_local;
            void main() {
                vec2 clip = a_position * 2.0 - 1.0;
                gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
                v_local = u_min + a_position * u_size;
            }
        `;
        const fragmentSource = `
            precision mediump float;
            varying vec2 v_local;
            uniform sampler2D u_image;
            uniform mat3 u_h;
            void main() {
                vec3 q = u_h * vec3(v_local, 1.0);
                vec2 uv = q.xy / q.z;
                if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                    discard;
                }
                gl_FragColor = texture2D(u_image, uv);
            }
        `;

        const compile = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.warn("[Composer] warp shader failed", gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        };

        const vs = compile(gl.VERTEX_SHADER, vertexSource);
        const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
        if (!vs || !fs) return null;

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.warn("[Composer] warp program failed", gl.getProgramInfoLog(program));
            return null;
        }

        gl.__composerWarpProgram = {
            program,
            aPosition: gl.getAttribLocation(program, "a_position"),
            uMin: gl.getUniformLocation(program, "u_min"),
            uSize: gl.getUniformLocation(program, "u_size"),
            uImage: gl.getUniformLocation(program, "u_image"),
            uH: gl.getUniformLocation(program, "u_h"),
            positionBuffer: gl.createBuffer(),
            texture: gl.createTexture()
        };
        return gl.__composerWarpProgram;
    }

    function buildWarpCacheKey(element, width, height, corners) {
        const sourceW = element?.naturalWidth || element?.videoWidth || element?.width || width;
        const sourceH = element?.naturalHeight || element?.videoHeight || element?.height || height;
        const cornerKey = WARP_CORNER_KEYS.map((key) => (
            `${Math.round(corners[key].x * 10) / 10},${Math.round(corners[key].y * 10) / 10}`
        )).join("|");
        return `${sourceW}x${sourceH}:${Math.round(width)}x${Math.round(height)}:${cornerKey}`;
    }

    function buildWebglWarpBitmap(owner, element, width, height, corners) {
        if (!owner || !element) return null;
        const h = computeDestToUvHomography(corners);
        if (!h) return null;

        const xs = WARP_CORNER_KEYS.map((key) => corners[key].x);
        const ys = WARP_CORNER_KEYS.map((key) => corners[key].y);
        const minX = Math.floor(Math.min(...xs));
        const maxX = Math.ceil(Math.max(...xs));
        const minY = Math.floor(Math.min(...ys));
        const maxY = Math.ceil(Math.max(...ys));
        const outW = Math.max(1, maxX - minX);
        const outH = Math.max(1, maxY - minY);
        if (outW > 4096 || outH > 4096) return null;

        const cacheKey = buildWarpCacheKey(element, width, height, corners);
        if (owner.__composerWarpCacheKey === cacheKey && owner.__composerWarpCacheCanvas) {
            return {
                canvas: owner.__composerWarpCacheCanvas,
                left: owner.__composerWarpCacheLeft,
                top: owner.__composerWarpCacheTop
            };
        }

        const off = owner.__composerWarpGlCanvas || document.createElement("canvas");
        off.width = outW;
        off.height = outH;
        owner.__composerWarpGlCanvas = off;
        const gl = owner.__composerWarpGl || off.getContext("webgl", {
            alpha: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true
        });
        if (!gl) return null;
        owner.__composerWarpGl = gl;

        const setup = getWarpWebglProgram(gl);
        if (!setup) return null;

        gl.viewport(0, 0, outW, outH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(setup.program);

        gl.bindBuffer(gl.ARRAY_BUFFER, setup.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 0, 1, 0, 0, 1,
            0, 1, 1, 0, 1, 1
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(setup.aPosition);
        gl.vertexAttribPointer(setup.aPosition, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, setup.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, element);
        } catch (err) {
            console.warn("[Composer] warp texture upload failed", err);
            return null;
        }

        gl.uniform1i(setup.uImage, 0);
        gl.uniform2f(setup.uMin, minX, minY);
        gl.uniform2f(setup.uSize, outW, outH);
        gl.uniformMatrix3fv(setup.uH, false, new Float32Array([
            h[0], h[3], h[6],
            h[1], h[4], h[7],
            h[2], h[5], h[8]
        ]));
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        owner.__composerWarpCacheKey = cacheKey;
        owner.__composerWarpCacheCanvas = off;
        owner.__composerWarpCacheLeft = minX;
        owner.__composerWarpCacheTop = minY;
        return { canvas: off, left: minX, top: minY };
    }

    function renderWarpedImage(ctx, element, width, height, corners, owner) {
        const webglWarp = buildWebglWarpBitmap(owner, element, width, height, corners);
        if (webglWarp?.canvas) {
            ctx.drawImage(webglWarp.canvas, webglWarp.left, webglWarp.top);
            return;
        }

        const imgW = element?.naturalWidth || element?.videoWidth || element?.width || width;
        const imgH = element?.naturalHeight || element?.videoHeight || element?.height || height;
        if (!element || !imgW || !imgH || !width || !height) return;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(corners.tl.x, corners.tl.y);
        ctx.lineTo(corners.tr.x, corners.tr.y);
        ctx.lineTo(corners.br.x, corners.br.y);
        ctx.lineTo(corners.bl.x, corners.bl.y);
        ctx.closePath();
        ctx.clip();

        const sTl = { u: 0, v: 0 };
        const sTr = { u: 1, v: 0 };
        const sBr = { u: 1, v: 1 };
        const sBl = { u: 0, v: 1 };
        drawWarpedTriangle(ctx, element, corners.tl, corners.tr, corners.br, sTl, sTr, sBr, imgW, imgH);
        drawWarpedTriangle(ctx, element, corners.tl, corners.br, corners.bl, sTl, sBr, sBl, imgW, imgH);
        ctx.restore();
    }

    function installWarpImageClass() {
        const fabricRef = window.fabric;
        if (!fabricRef || fabricRef.WarpImage) return;

        fabricRef.WarpImage = fabricRef.util.createClass(fabricRef.Image, {
            type: "warpImage",

            initialize: function (element, options = {}) {
                options.objectCaching = false;
                this.callSuper("initialize", element, options);
                this.objectCaching = false;
                this.warpCorners = normalizeWarpCorners(options.warpCorners, this.width, this.height);
            },

            toObject: function (propertiesToInclude) {
                return fabricRef.util.object.extend(
                    this.callSuper("toObject", (propertiesToInclude || []).concat(["warpCorners"])),
                    { warpCorners: cloneWarpCorners(this.warpCorners) }
                );
            },

            _render: function (ctx) {
                const element = this._element;
                const corners = normalizeWarpCorners(this.warpCorners, this.width, this.height);
                this.warpCorners = corners;
                renderWarpedImage(ctx, element, this.width, this.height, corners, this);
            }
        });

        fabricRef.WarpImage.fromObject = function (object, callback) {
            fabricRef.util.loadImage(object.src, (img, isError) => {
                if (isError || !img) {
                    callback(null, true);
                    return;
                }
                callback(new fabricRef.WarpImage(img, object), false);
            }, null, object.crossOrigin);
        };
    }

    function canShiftCropObject(target) {
        return !!target
            && target.type !== "activeSelection"
            && target.composerType !== MOSAIC_TYPE
            && !isInternalComposerObject(target);
    }

    function getSideCropInset(target, transform, controlKey, x, y) {
        const fabricRef = window.fabric;
        if (!target || !fabricRef?.util || !fabricRef?.Point) return 0;

        const inverse = fabricRef.util.invertTransform(target.calcTransformMatrix());
        const start = fabricRef.util.transformPoint(
            new fabricRef.Point(
                Number.isFinite(transform?.ex) ? transform.ex : x,
                Number.isFinite(transform?.ey) ? transform.ey : y
            ),
            inverse
        );
        const pointer = fabricRef.util.transformPoint(new fabricRef.Point(x, y), inverse);

        if (controlKey === "ml") return pointer.x - start.x;
        if (controlKey === "mr") return start.x - pointer.x;
        if (controlKey === "mt") return pointer.y - start.y;
        if (controlKey === "mb") return start.y - pointer.y;
        return 0;
    }

    function rasterizeObjectForCrop(obj, transform) {
        if (!canvas || !obj || typeof obj.toCanvasElement !== "function") return null;

        if (isTextObject(obj) && obj.isEditing && typeof obj.exitEditing === "function") {
            obj.exitEditing();
        }

        let rendered = null;
        try {
            rendered = obj.toCanvasElement({
                multiplier: 1,
                withoutTransform: true
            });
        } catch (err) {
            console.warn("[Composer] crop rasterize failed", err);
            return null;
        }
        if (!rendered || !rendered.width || !rendered.height) return null;

        const replacement = new window.fabric.Image(rendered, {
            left: obj.left,
            top: obj.top,
            originX: obj.originX,
            originY: obj.originY,
            scaleX: obj.scaleX,
            scaleY: obj.scaleY,
            angle: obj.angle,
            flipX: obj.flipX,
            flipY: obj.flipY,
            skewX: obj.skewX,
            skewY: obj.skewY,
            opacity: obj.opacity,
            selectable: obj.selectable,
            evented: obj.evented,
            hasControls: obj.hasControls,
            hasBorders: obj.hasBorders,
            lockMovementX: obj.lockMovementX,
            lockMovementY: obj.lockMovementY,
            lockRotation: obj.lockRotation,
            lockScalingX: obj.lockScalingX,
            lockScalingY: obj.lockScalingY,
            name: obj.name || getLayerDisplayName(obj),
            composerType: "rasterized",
            cornerStyle: "circle",
            transparentCorners: false,
            padding: 4,
            objectCaching: false
        });

        shiftCropRasterizing = true;
        try {
            insertObjectReplacement(obj, replacement);
        } finally {
            shiftCropRasterizing = false;
        }

        if (obj === lastSelectedImageObject) {
            lastSelectedImageObject = replacement;
        }
        transform.target = replacement;
        transform.scaleX = replacement.scaleX;
        transform.scaleY = replacement.scaleY;
        transform.skewX = replacement.skewX;
        transform.skewY = replacement.skewY;
        transform.width = replacement.width * replacement.scaleX;
        transform.original = window.fabric.util.saveObjectTransform(replacement);
        return replacement;
    }

    function cropObjectFromSideControl(transform, controlKey, x, y) {
        let target = transform?.target;
        const fabricRef = window.fabric;
        if (!canShiftCropObject(target) || !fabricRef?.util || !fabricRef?.Point) return false;

        if (target.type !== "image") {
            if (getSideCropInset(target, transform, controlKey, x, y) <= 0.001) {
                return false;
            }
            target = rasterizeObjectForCrop(target, transform);
            if (!target) return false;
        }

        if (!transform.__composerCropSession) {
            const matrix = target.calcTransformMatrix();
            const inverse = fabricRef.util.invertTransform(matrix);
            const startX = Number.isFinite(transform.ex) ? transform.ex : x;
            const startY = Number.isFinite(transform.ey) ? transform.ey : y;
            transform.__composerCropSession = {
                matrix,
                inverse,
                center: target.getCenterPoint(),
                startPointer: fabricRef.util.transformPoint(
                    new fabricRef.Point(startX, startY),
                    inverse
                ),
                width: Math.max(1, Number(target.width) || 1),
                height: Math.max(1, Number(target.height) || 1),
                cropX: Math.max(0, Number(target.cropX) || 0),
                cropY: Math.max(0, Number(target.cropY) || 0)
            };
        }

        const session = transform.__composerCropSession;
        const pointer = fabricRef.util.transformPoint(
            new fabricRef.Point(x, y),
            session.inverse
        );
        let inset = 0;
        let centerDx = 0;
        let centerDy = 0;
        let nextWidth = session.width;
        let nextHeight = session.height;
        let nextCropX = session.cropX;
        let nextCropY = session.cropY;

        if (controlKey === "ml") {
            inset = Math.max(0, Math.min(session.width - 1, pointer.x - session.startPointer.x));
            nextWidth = session.width - inset;
            nextCropX = session.cropX + inset;
            centerDx = inset / 2;
        } else if (controlKey === "mr") {
            inset = Math.max(0, Math.min(session.width - 1, session.startPointer.x - pointer.x));
            nextWidth = session.width - inset;
            centerDx = -inset / 2;
        } else if (controlKey === "mt") {
            inset = Math.max(0, Math.min(session.height - 1, pointer.y - session.startPointer.y));
            nextHeight = session.height - inset;
            nextCropY = session.cropY + inset;
            centerDy = inset / 2;
        } else if (controlKey === "mb") {
            inset = Math.max(0, Math.min(session.height - 1, session.startPointer.y - pointer.y));
            nextHeight = session.height - inset;
            centerDy = -inset / 2;
        } else {
            return false;
        }

        const nextCenter = new fabricRef.Point(
            session.center.x + session.matrix[0] * centerDx + session.matrix[2] * centerDy,
            session.center.y + session.matrix[1] * centerDx + session.matrix[3] * centerDy
        );
        const changed = Math.abs((Number(target.width) || 0) - nextWidth) > 0.001
            || Math.abs((Number(target.height) || 0) - nextHeight) > 0.001
            || Math.abs((Number(target.cropX) || 0) - nextCropX) > 0.001
            || Math.abs((Number(target.cropY) || 0) - nextCropY) > 0.001;

        target.set({
            width: nextWidth,
            height: nextHeight,
            cropX: nextCropX,
            cropY: nextCropY,
            dirty: true
        });
        target.setPositionByOrigin(nextCenter, "center", "center");
        target.setCoords();
        return changed;
    }

    function installShiftCropControls() {
        const fabricRef = window.fabric;
        const objectProto = fabricRef?.Object?.prototype;
        if (!objectProto || objectProto.__composerShiftCropControlsInstalled) return;

        const controls = { ...(objectProto.controls || {}) };
        ["ml", "mr", "mt", "mb"].forEach((controlKey) => {
            const baseControl = controls[controlKey];
            if (!baseControl || !fabricRef.Control) return;

            const baseActionHandler = baseControl.actionHandler;
            const baseGetActionName = baseControl.getActionName;
            controls[controlKey] = new fabricRef.Control({
                ...baseControl,
                actionHandler(eventData, transform, x, y) {
                    if (transform?.action === "crop") {
                        return cropObjectFromSideControl(transform, controlKey, x, y);
                    }
                    return typeof baseActionHandler === "function"
                        ? baseActionHandler.call(this, eventData, transform, x, y)
                        : false;
                },
                getActionName(eventData, control, target) {
                    if (eventData?.shiftKey && canShiftCropObject(target)) {
                        return "crop";
                    }
                    return typeof baseGetActionName === "function"
                        ? baseGetActionName.call(this, eventData, control, target)
                        : baseControl.actionName;
                }
            });
        });

        objectProto.controls = controls;
        objectProto.__composerShiftCropControlsInstalled = true;
    }

    function setWarpControls(obj) {
        if (!obj || !window.fabric) return;
        if (!obj.__composerWarpPrevInteraction) {
            obj.__composerWarpPrevInteraction = {
                hasControls: obj.hasControls,
                hasBorders: obj.hasBorders,
                lockMovementX: obj.lockMovementX,
                lockMovementY: obj.lockMovementY,
                hoverCursor: obj.hoverCursor,
                moveCursor: obj.moveCursor
            };
        }
        obj.hasControls = false;
        obj.hasBorders = false;
        obj.lockMovementX = false;
        obj.lockMovementY = false;
        obj.hoverCursor = "move";
        obj.moveCursor = "move";
        obj.__composerWarpOrientation = Math.sign(getWarpSignedArea(
            normalizeWarpCorners(obj.warpCorners, obj.width, obj.height)
        )) || 1;
        obj.__composerWarpEditing = true;
        obj.setCoords();
    }

    function clearWarpControls(obj) {
        if (!obj || !obj.__composerWarpEditing || !window.fabric) return;
        const prev = obj.__composerWarpPrevInteraction || {};
        obj.hasControls = prev.hasControls ?? true;
        obj.hasBorders = prev.hasBorders ?? true;
        obj.lockMovementX = prev.lockMovementX ?? false;
        obj.lockMovementY = prev.lockMovementY ?? false;
        obj.hoverCursor = prev.hoverCursor ?? null;
        obj.moveCursor = prev.moveCursor ?? null;
        obj.__composerWarpPrevInteraction = null;
        obj.__composerWarpEditing = false;
        obj.setCoords();
    }

    function clearWarpOverlay() {
        if (!canvas?.contextTop) return;
        canvas.clearContext(canvas.contextTop);
    }

    function getWarpCornerViewportPoints(obj) {
        if (!canvas || !obj || !window.fabric?.util) return null;
        const corners = normalizeWarpCorners(obj.warpCorners, obj.width, obj.height);
        const vpt = canvas.viewportTransform || window.fabric.iMatrix;
        const matrix = window.fabric.util.multiplyTransformMatrices(vpt, obj.calcTransformMatrix());
        const points = {};
        WARP_CORNER_KEYS.forEach((key) => {
            points[key] = window.fabric.util.transformPoint(
                new window.fabric.Point(corners[key].x, corners[key].y),
                matrix
            );
        });
        return points;
    }

    function drawWarpOverlay() {
        if (!canvas?.contextTop || !warpEditObject || canvas.getActiveObject() !== warpEditObject) return;
        const points = getWarpCornerViewportPoints(warpEditObject);
        if (!points) return;

        const ctx = canvas.contextTop;
        canvas.clearContext(ctx);

        ctx.save();
        ctx.strokeStyle = "#2f7ddf";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(points.tl.x, points.tl.y);
        ctx.lineTo(points.tr.x, points.tr.y);
        ctx.lineTo(points.br.x, points.br.y);
        ctx.lineTo(points.bl.x, points.bl.y);
        ctx.closePath();
        ctx.stroke();

        WARP_CORNER_KEYS.forEach((key) => {
            const p = points[key];
            const size = 13;
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "#2f7ddf";
            ctx.lineWidth = 2;
            ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
            ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
        });
        ctx.restore();
    }

    function getWarpCornerAtEvent(eventData) {
        if (!canvas || !warpEditObject || canvas.getActiveObject() !== warpEditObject) return null;
        const points = getWarpCornerViewportPoints(warpEditObject);
        if (!points) return null;
        const pointer = canvas.getPointer(eventData, true);
        const threshold = 18;
        let nearest = null;
        let nearestDist = Infinity;
        WARP_CORNER_KEYS.forEach((key) => {
            const p = points[key];
            const dist = Math.hypot(pointer.x - p.x, pointer.y - p.y);
            if (dist < nearestDist) {
                nearest = key;
                nearestDist = dist;
            }
        });
        return nearestDist <= threshold ? nearest : null;
    }

    function setWarpCornerFromEvent(cornerKey, eventData) {
        if (!canvas || !warpEditObject || !cornerKey || !window.fabric?.util) return false;
        const pointer = canvas.getPointer(eventData, false);
        const inv = window.fabric.util.invertTransform(warpEditObject.calcTransformMatrix());
        const local = window.fabric.util.transformPoint(new window.fabric.Point(pointer.x, pointer.y), inv);
        const current = normalizeWarpCorners(warpEditObject.warpCorners, warpEditObject.width, warpEditObject.height);
        const nextCorners = cloneWarpCorners(current);
        nextCorners[cornerKey] = { x: local.x, y: local.y };
        if (!isValidWarpCorners(nextCorners, warpEditObject.__composerWarpOrientation || 1)) {
            return false;
        }
        warpEditObject.warpCorners = nextCorners;
        warpEditObject.dirty = true;
        warpEditObject.setCoords();
        canvas.requestRenderAll();
        return true;
    }

    function bindWarpEditHandlers() {
        if (!canvas || canvas.__composerWarpHandlersBound) return;

        canvas.on("after:render", drawWarpOverlay);
        canvas.on("mouse:down:before", (opt) => {
            if (!warpEditObject || !opt?.e) return;
            const corner = getWarpCornerAtEvent(opt.e);
            if (!corner) return;
            warpDragCorner = corner;
            if (canvas.selection !== false) {
                canvas.__composerPrevSelection = canvas.selection;
                canvas.selection = false;
            }
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });
        canvas.on("mouse:down", (opt) => {
            if (!warpEditObject || warpDragCorner || !opt?.e) return;
            const corner = getWarpCornerAtEvent(opt.e);
            if (!corner) return;
            warpDragCorner = corner;
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });
        canvas.on("mouse:move", (opt) => {
            if (!warpDragCorner || !opt?.e) return;
            setWarpCornerFromEvent(warpDragCorner, opt.e);
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });
        canvas.on("mouse:up", () => {
            if (!warpDragCorner) return;
            warpDragCorner = null;
            if (typeof canvas.__composerPrevSelection === "boolean") {
                canvas.selection = canvas.__composerPrevSelection;
                canvas.__composerPrevSelection = undefined;
            }
            flushHistoryCaptureNow();
            drawWarpOverlay();
        });

        const upper = canvas.upperCanvasEl;
        if (upper) {
            upper.addEventListener("mousedown", (e) => {
                if (!warpEditObject || e.button !== 0) return;
                const corner = getWarpCornerAtEvent(e);
                if (!corner) return;
                warpDragCorner = corner;
                canvas.setActiveObject(warpEditObject);
                if (canvas.selection !== false) {
                    canvas.__composerPrevSelection = canvas.selection;
                    canvas.selection = false;
                }
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);
        }

        window.addEventListener("mousemove", (e) => {
            if (!warpDragCorner) return;
            setWarpCornerFromEvent(warpDragCorner, e);
            e.preventDefault();
            e.stopPropagation();
        }, true);

        window.addEventListener("mouseup", () => {
            if (!warpDragCorner) return;
            warpDragCorner = null;
            if (typeof canvas.__composerPrevSelection === "boolean") {
                canvas.selection = canvas.__composerPrevSelection;
                canvas.__composerPrevSelection = undefined;
            }
            flushHistoryCaptureNow();
            drawWarpOverlay();
        }, true);

        canvas.__composerWarpHandlersBound = true;
    }

    function syncWarpButtonState() {
        const btn = document.getElementById("composer-warp-btn");
        if (!btn) return;
        const active = canvas?.getActiveObject();
        const isActive = !!(active && active === warpEditObject && active.__composerWarpEditing);
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    }

    function disableWarpEdit(silent = false) {
        if (warpEditObject) {
            clearWarpControls(warpEditObject);
            warpEditObject = null;
        }
        warpDragCorner = null;
        clearWarpOverlay();
        syncWarpButtonState();
        if (canvas) canvas.requestRenderAll();
        if (!silent) setStatus("Warp mode off");
    }

    function insertObjectReplacement(original, replacement) {
        if (!canvas || !original || !replacement) return null;
        const objects = canvas.getObjects();
        const index = objects.indexOf(original);

        canvas.remove(original);
        if (typeof canvas.insertAt === "function" && index >= 0) {
            canvas.insertAt(replacement, index);
        } else {
            canvas.add(replacement);
            if (index >= 0) canvas.moveTo(replacement, index);
        }

        if (original === backgroundObject) {
            backgroundObject = replacement;
        }

        replacement.setCoords();
        canvas.setActiveObject(replacement);
        return replacement;
    }

    function rasterizeObjectForWarp(obj) {
        if (!canvas || !window.fabric?.WarpImage || !obj) return null;
        if (obj.type === "activeSelection") return null;
        if (obj.type === "image" || obj.type === "warpImage") return null;
        if (typeof obj.toCanvasElement !== "function") return null;

        if (isTextObject(obj) && obj.isEditing && typeof obj.exitEditing === "function") {
            obj.exitEditing();
        }

        let rendered = null;
        try {
            rendered = obj.toCanvasElement({
                multiplier: 1,
                withoutTransform: true
            });
        } catch (err) {
            console.warn("[Composer] warp rasterize failed", err);
            return null;
        }
        if (!rendered || !rendered.width || !rendered.height) return null;

        const replacement = new window.fabric.WarpImage(rendered, {
            left: obj.left,
            top: obj.top,
            originX: obj.originX,
            originY: obj.originY,
            scaleX: obj.scaleX,
            scaleY: obj.scaleY,
            angle: obj.angle,
            flipX: obj.flipX,
            flipY: obj.flipY,
            skewX: obj.skewX,
            skewY: obj.skewY,
            opacity: obj.opacity,
            selectable: obj.selectable,
            evented: obj.evented,
            hasControls: obj.hasControls,
            hasBorders: obj.hasBorders,
            lockMovementX: obj.lockMovementX,
            lockMovementY: obj.lockMovementY,
            lockRotation: obj.lockRotation,
            lockScalingX: obj.lockScalingX,
            lockScalingY: obj.lockScalingY,
            name: obj.name || getLayerDisplayName(obj),
            composerType: "object",
            cornerStyle: "circle",
            transparentCorners: false,
            padding: 4,
            objectCaching: false
        });
        replacement.warpCorners = defaultWarpCorners(replacement.width, replacement.height);
        return insertObjectReplacement(obj, replacement);
    }

    function getVisibleImageElementForWarp(obj) {
        const element = obj?._element;
        if (!element) return null;

        const sourceWidth = Number(element.naturalWidth || element.videoWidth || element.width) || 0;
        const sourceHeight = Number(element.naturalHeight || element.videoHeight || element.height) || 0;
        const visibleWidth = Number(obj.width) || sourceWidth;
        const visibleHeight = Number(obj.height) || sourceHeight;
        const cropX = Math.max(0, Number(obj.cropX) || 0);
        const cropY = Math.max(0, Number(obj.cropY) || 0);
        const EPS = 0.001;
        const isCropped = cropX > EPS
            || cropY > EPS
            || visibleWidth < sourceWidth - EPS
            || visibleHeight < sourceHeight - EPS;

        if (!isCropped || !sourceWidth || !sourceHeight || !visibleWidth || !visibleHeight) {
            return element;
        }

        const rendered = document.createElement("canvas");
        rendered.width = Math.max(1, Math.ceil(visibleWidth));
        rendered.height = Math.max(1, Math.ceil(visibleHeight));
        const ctx = rendered.getContext("2d");
        if (!ctx) return element;

        try {
            ctx.drawImage(
                element,
                cropX,
                cropY,
                visibleWidth,
                visibleHeight,
                0,
                0,
                rendered.width,
                rendered.height
            );
            return rendered;
        } catch (err) {
            console.warn("[Composer] cropped warp source build failed", err);
            return element;
        }
    }

    function convertObjectToWarpImage(obj) {
        if (!canvas || !window.fabric?.WarpImage || !obj) return null;
        if (obj.type === "warpImage") return obj;
        if (obj.type !== "image") return rasterizeObjectForWarp(obj);

        const element = getVisibleImageElementForWarp(obj);
        if (!element) return null;

        const props = obj.toObject(["name", "composerType"]);
        props.cropX = 0;
        props.cropY = 0;
        props.warpCorners = obj.warpCorners
            ? cloneWarpCorners(obj.warpCorners)
            : defaultWarpCorners(obj.width, obj.height);
        const replacement = new window.fabric.WarpImage(element, props);
        return insertObjectReplacement(obj, replacement);
    }

    function toggleWarpModeForActiveObject() {
        if (!canvas || !window.fabric?.WarpImage) {
            setStatus("Warp is not ready");
            return;
        }

        const active = canvas.getActiveObject();
        if (!active || active.type === "activeSelection") {
            setStatus("Select one object to warp");
            return;
        }

        if (active === warpEditObject && active.__composerWarpEditing) {
            disableWarpEdit(false);
            flushHistoryCaptureNow();
            return;
        }

        disableDrawingMode(true);
        disableWarpEdit(true);

        const target = convertObjectToWarpImage(active);
        if (!target) {
            setStatus("Warp works for images, text, and shape layers");
            return;
        }

        target.warpCorners = normalizeWarpCorners(target.warpCorners, target.width, target.height);
        setWarpControls(target);
        warpEditObject = target;
        canvas.setActiveObject(target);
        canvas.requestRenderAll();
        syncWarpButtonState();
        scheduleHistoryCapture();
        setStatus("Warp mode: drag the 4 corner points");
    }

    function getHistorySnapshot() {
        if (!canvas) return null;
        const canvasJson = canvas.toJSON(["name", "composerType", "warpCorners"]);
        if (Array.isArray(canvasJson.objects)) {
            canvasJson.objects = canvasJson.objects.filter((obj) => obj?.composerType !== MOSAIC_OVERLAP_PREVIEW_TYPE);
        }
        const key = JSON.stringify({
            sceneWidth,
            sceneHeight,
            canvas: canvasJson
        });
        return {
            sceneWidth,
            sceneHeight,
            canvasJson,
            key
        };
    }

    function updateHistoryButtons() {
        const undoBtn = document.getElementById("composer-undo-btn");
        const redoBtn = document.getElementById("composer-redo-btn");
        if (undoBtn) {
            const canUndo = !historyRestoring && historyUndoStack.length > 1;
            undoBtn.disabled = !canUndo;
            undoBtn.classList.toggle("is-disabled", !canUndo);
        }
        if (redoBtn) {
            const canRedo = !historyRestoring && historyRedoStack.length > 0;
            redoBtn.disabled = !canRedo;
            redoBtn.classList.toggle("is-disabled", !canRedo);
        }
    }

    function resetHistoryToCurrentScene() {
        const snapshot = getHistorySnapshot();
        historyUndoStack = snapshot ? [snapshot] : [];
        historyRedoStack = [];
        if (historyCaptureTimer) {
            clearTimeout(historyCaptureTimer);
            historyCaptureTimer = null;
        }
        updateHistoryButtons();
    }

    function scheduleHistoryCapture() {
        if (!canvas || historyRestoring) return;

        if (historyCaptureTimer) {
            clearTimeout(historyCaptureTimer);
        }

        historyCaptureTimer = window.setTimeout(() => {
            historyCaptureTimer = null;
            if (!canvas || historyRestoring) return;

            const snapshot = getHistorySnapshot();
            if (!snapshot) return;

            const last = historyUndoStack[historyUndoStack.length - 1];
            if (last?.key === snapshot.key) {
                updateHistoryButtons();
                return;
            }

            historyUndoStack.push(snapshot);
            if (historyUndoStack.length > HISTORY_LIMIT) {
                historyUndoStack.shift();
            }
            historyRedoStack = [];
            updateHistoryButtons();
        }, HISTORY_CAPTURE_DELAY_MS);
    }

    function flushHistoryCaptureNow() {
        if (!canvas || historyRestoring) return;

        if (historyCaptureTimer) {
            clearTimeout(historyCaptureTimer);
            historyCaptureTimer = null;
        }

        const snapshot = getHistorySnapshot();
        if (!snapshot) return;

        const last = historyUndoStack[historyUndoStack.length - 1];
        if (last?.key === snapshot.key) {
            updateHistoryButtons();
            return;
        }

        historyUndoStack.push(snapshot);
        if (historyUndoStack.length > HISTORY_LIMIT) {
            historyUndoStack.shift();
        }
        historyRedoStack = [];
        updateHistoryButtons();
    }

    function restoreHistorySnapshot(snapshot, successText) {
        if (!canvas || !snapshot || historyRestoring) return false;

        historyRestoring = true;
        if (historyCaptureTimer) {
            clearTimeout(historyCaptureTimer);
            historyCaptureTimer = null;
        }
        updateHistoryButtons();

        const prevViewportTransform = Array.isArray(canvas.viewportTransform)
            ? canvas.viewportTransform.slice()
            : null;
        const nextSceneWidth = clampToStepSize(snapshot.sceneWidth ?? sceneWidth);
        const nextSceneHeight = clampToStepSize(snapshot.sceneHeight ?? sceneHeight);
        const sizeChanged = nextSceneWidth !== sceneWidth || nextSceneHeight !== sceneHeight;

        canvas.discardActiveObject();
        if (sizeChanged) {
            sceneWidth = nextSceneWidth;
            sceneHeight = nextSceneHeight;
            syncCanvasSizeControls();
            fitCanvasSize();
        }

        canvas.loadFromJSON(snapshot.canvasJson, () => {
            if (prevViewportTransform && !sizeChanged && typeof canvas.setViewportTransform === "function") {
                canvas.setViewportTransform(prevViewportTransform);
            }
            refreshBackgroundReference();
            syncCanvasBackgroundControl();
            canvas.renderAll();
            syncTextColorControlFromSelection();
            syncTextStyleControlsFromSelection();
            syncObjectOpacityControlFromSelection();
            syncLayersPanel();
            historyRestoring = false;
            updateHistoryButtons();
            if (successText) setStatus(successText);
        });

        return true;
    }

    function undoHistory() {
        if (historyRestoring || historyUndoStack.length <= 1) {
            updateHistoryButtons();
            return false;
        }

        const current = historyUndoStack.pop();
        if (current) {
            historyRedoStack.push(current);
        }

        const target = historyUndoStack[historyUndoStack.length - 1];
        return restoreHistorySnapshot(target, "Undo applied");
    }

    function redoHistory() {
        if (historyRestoring || historyRedoStack.length === 0) {
            updateHistoryButtons();
            return false;
        }

        const target = historyRedoStack.pop();
        if (!target) {
            updateHistoryButtons();
            return false;
        }

        historyUndoStack.push(target);
        return restoreHistorySnapshot(target, "Redo applied");
    }

    function bindHistoryButtons() {
        const undoBtn = document.getElementById("composer-undo-btn");
        const redoBtn = document.getElementById("composer-redo-btn");
        if (!undoBtn || !redoBtn) return;
        if (undoBtn.dataset.bound === "1") return;

        const stop = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        undoBtn.addEventListener("mousedown", stop);
        redoBtn.addEventListener("mousedown", stop);

        undoBtn.addEventListener("click", () => {
            undoHistory();
        });
        redoBtn.addEventListener("click", () => {
            redoHistory();
        });

        undoBtn.dataset.bound = "1";
        redoBtn.dataset.bound = "1";
        updateHistoryButtons();
    }

    function bindStageActionsOverlay() {
        const overlay = document.getElementById("composer-stage-actions-overlay");
        if (!overlay || overlay.dataset.bound === "1") return;

        overlay.addEventListener("mousedown", (e) => {
            e.stopPropagation();
        });
        overlay.addEventListener("click", (e) => {
            e.stopPropagation();
        });

        overlay.dataset.bound = "1";
    }

    function clearLayerSelectionLock() {
        if (!canvas) {
            lockedLayerObject = null;
            return;
        }

        canvas.getObjects().forEach((obj) => {
            if (!obj) return;
            if (typeof obj.__composerSavedSelectable !== "undefined") {
                obj.selectable = obj.__composerSavedSelectable;
                delete obj.__composerSavedSelectable;
            }
            if (typeof obj.__composerSavedEvented !== "undefined") {
                obj.evented = obj.__composerSavedEvented;
                delete obj.__composerSavedEvented;
            }
        });

        lockedLayerObject = null;
    }

    function applyLayerSelectionLock(target) {
        if (!canvas || !target) return;

        lockedLayerObject = target;
        canvas.getObjects().forEach((obj) => {
            if (!obj) return;

            if (typeof obj.__composerSavedSelectable === "undefined") {
                obj.__composerSavedSelectable = obj.selectable;
            }
            if (typeof obj.__composerSavedEvented === "undefined") {
                obj.__composerSavedEvented = obj.evented;
            }

            const isTarget = obj === target;
            obj.selectable = isTarget;
            obj.evented = isTarget;
        });

        target.selectable = true;
        target.evented = true;
    }

    function ensureLockedLayerIsActive() {
        if (!canvas || !lockedLayerObject) return;
        const objects = canvas.getObjects();
        if (!objects.includes(lockedLayerObject)) {
            clearLayerSelectionLock();
            return;
        }

        const active = canvas.getActiveObject();
        if (active === lockedLayerObject) return;

        // While lock is enabled, never allow implicit retargeting to upper layers.
        canvas.setActiveObject(lockedLayerObject);
        canvas.requestRenderAll();
    }

    function syncLayerLockFromCanvasSelection() {
        if (!canvas) return;
        if (drawingTool === "brush" || drawingTool === "eraser") return;

        const active = canvas.getActiveObject();
        if (!active) {
            clearLayerSelectionLock();
            return;
        }

        if (active.type === "activeSelection") {
            clearLayerSelectionLock();
            return;
        }

        if (lockedLayerObject !== active) {
            applyLayerSelectionLock(active);
        } else {
            ensureLockedLayerIsActive();
        }
        if (isImageObject(active) && active?.composerType !== MOSAIC_TYPE) {
            lastSelectedImageObject = active;
        }
        syncLayersPanel();
    }

    function beginPointerDragTargetLock() {
        if (!canvas || pointerDragTargetLockActive) return;
        pointerDragTargetLockPrevSkipFind = !!canvas.skipTargetFind;
        canvas.skipTargetFind = true;
        pointerDragTargetLockActive = true;
    }

    function endPointerDragTargetLock() {
        if (!canvas || !pointerDragTargetLockActive) return;
        canvas.skipTargetFind = pointerDragTargetLockPrevSkipFind;
        pointerDragTargetLockActive = false;
    }

    function clearShiftMoveAxisLock() {
        shiftMoveAxisLock = null;
    }

    function constrainObjectMoveToShiftAxis(e) {
        const target = e?.target;
        if (!target) {
            clearShiftMoveAxisLock();
            return;
        }

        if (!e?.e?.shiftKey) {
            clearShiftMoveAxisLock();
            return;
        }

        if (!shiftMoveAxisLock || shiftMoveAxisLock.target !== target) {
            const before = target.__composerBeforeTransform;
            shiftMoveAxisLock = {
                target,
                startLeft: Number.isFinite(before?.left) ? before.left : target.left,
                startTop: Number.isFinite(before?.top) ? before.top : target.top,
                axis: null
            };
        }

        const dx = (Number(target.left) || 0) - shiftMoveAxisLock.startLeft;
        const dy = (Number(target.top) || 0) - shiftMoveAxisLock.startTop;

        if (!shiftMoveAxisLock.axis) {
            const threshold = 2;
            if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
            shiftMoveAxisLock.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        }

        if (shiftMoveAxisLock.axis === "x") {
            target.set("top", shiftMoveAxisLock.startTop);
        } else {
            target.set("left", shiftMoveAxisLock.startLeft);
        }

        target.setCoords();
    }

    function getLayerDisplayName(obj) {
        if (!obj) return "Layer";
        if (obj.composerType === "background") return "BG";
        if (isTextObject(obj)) return "Text";
        if (obj.type === "path") return "Brush";
        if (isShapeObject(obj)) return obj.name || "Shape";
        if (obj.type === "image") return obj.name || "Image";
        return obj.name || obj.type || "Layer";
    }

    function getShapeLayerKind(obj) {
        if (!isShapeObject(obj)) return null;

        const byName = String(obj.name || "").toLowerCase();
        if (byName.includes("triangle")) return "triangle";
        if (byName.includes("square") || byName.includes("rect")) return "rect";
        if (byName.includes("circle")) return "circle";
        if (byName.includes("pentagon")) return "pentagon";
        if (byName.includes("hexagon")) return "hexagon";
        if (byName.includes("octagon")) return "octagon";

        if (obj.type === "rect") return "rect";
        if (obj.type === "circle") return "circle";
        if (obj.type === "polygon" && Array.isArray(obj.points)) {
            const sides = obj.points.length;
            if (sides === 3) return "triangle";
            if (sides === 5) return "pentagon";
            if (sides === 6) return "hexagon";
            if (sides === 8) return "octagon";
        }

        return "shape";
    }

    function getShapeThumbSvg(shapeKind) {
        const stroke = "%23f2f2f2";
        if (shapeKind === "triangle") {
            return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><polygon points='8,2.5 13,12.5 3,12.5' fill='none' stroke='${stroke}' stroke-width='1.4' stroke-linejoin='round'/></svg>`;
        }
        if (shapeKind === "rect") {
            return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect x='3' y='3' width='10' height='10' fill='none' stroke='${stroke}' stroke-width='1.4' stroke-linejoin='round'/></svg>`;
        }
        if (shapeKind === "circle") {
            return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='5' fill='none' stroke='${stroke}' stroke-width='1.4'/></svg>`;
        }
        if (shapeKind === "pentagon") {
            return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><polygon points='8,2.4 13,6 11.2,12 4.8,12 3,6' fill='none' stroke='${stroke}' stroke-width='1.4' stroke-linejoin='round'/></svg>`;
        }
        if (shapeKind === "hexagon") {
            return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><polygon points='4,3.5 12,3.5 14,8 12,12.5 4,12.5 2,8' fill='none' stroke='${stroke}' stroke-width='1.4' stroke-linejoin='round'/></svg>`;
        }
        if (shapeKind === "octagon") {
            return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><polygon points='5,2.5 11,2.5 13.5,5 13.5,11 11,13.5 5,13.5 2.5,11 2.5,5' fill='none' stroke='${stroke}' stroke-width='1.4' stroke-linejoin='round'/></svg>`;
        }
        return null;
    }

    function getLayerThumbLabel(obj) {
        if (!obj) return "L";
        if (obj.composerType === "background") return "BG";
        if (isTextObject(obj)) return "T";
        if (obj.type === "path") return "BR";
        if (isShapeObject(obj)) return "";
        if (isImageObject(obj)) return "IMG";
        return "L";
    }

    function getImageThumbUrl(obj) {
        if (!isImageObject(obj)) return null;
        const src = obj?._element?.currentSrc || obj?._element?.src || "";
        if (typeof src !== "string" || !src) return null;
        return src;
    }

    function getSelectedObjectsSet() {
        const selected = new Set();
        const active = canvas?.getActiveObject();
        if (!active) return selected;

        if (active.type === "activeSelection" && typeof active.getObjects === "function") {
            active.getObjects().forEach((obj) => selected.add(obj));
            return selected;
        }

        selected.add(active);
        return selected;
    }

    function isInternalComposerObject(obj) {
        return obj?.composerType === CLEAN_MASK_TYPE
            || obj?.composerType === MOSAIC_OVERLAP_PREVIEW_TYPE;
    }

    function syncLayersPanel() {
        const list = document.getElementById("composer-layers-list");
        if (!list || !canvas) return;

        const objects = canvas.getObjects().filter((obj) => !isInternalComposerObject(obj));
        const allObjects = canvas.getObjects();
        if (lockedLayerObject && !allObjects.includes(lockedLayerObject)) {
            clearLayerSelectionLock();
        }
        const selected = getSelectedObjectsSet();
        list.innerHTML = "";

        if (objects.length === 0) {
            const empty = document.createElement("div");
            empty.className = "composer-layer-empty";
            empty.textContent = "No layers";
            list.appendChild(empty);
            return;
        }

        for (let idx = objects.length - 1; idx >= 0; idx -= 1) {
            const obj = objects[idx];
            const layerIndex = allObjects.indexOf(obj);
            const visualOrder = objects.length - idx;
            const card = document.createElement("button");
            card.type = "button";
            card.className = "composer-layer-card";
            card.dataset.layerIndex = String(layerIndex);
            card.draggable = true;
            card.title = `${visualOrder}. ${getLayerDisplayName(obj)}`;
            if (selected.has(obj)) {
                card.classList.add("is-active");
            }

            const thumb = document.createElement("span");
            thumb.className = "composer-layer-thumb";
            const imgUrl = getImageThumbUrl(obj);
            if (imgUrl) {
                thumb.classList.add("has-image");
                thumb.style.backgroundImage = `url("${imgUrl}")`;
                thumb.textContent = ".";
            } else {
                const shapeKind = getShapeLayerKind(obj);
                const shapeSvg = shapeKind ? getShapeThumbSvg(shapeKind) : null;
                if (shapeSvg) {
                    thumb.classList.add("has-image");
                    thumb.style.backgroundImage = `url("${shapeSvg}")`;
                    thumb.textContent = ".";
                }
                thumb.textContent = getLayerThumbLabel(obj);
            }

            const deleteBtn = document.createElement("span");
            deleteBtn.className = "composer-layer-delete";
            deleteBtn.dataset.layerDelete = "1";
            deleteBtn.title = "Delete layer";
            deleteBtn.setAttribute("role", "button");
            deleteBtn.setAttribute("aria-label", "Delete layer");
            deleteBtn.textContent = "\u00d7";

            card.appendChild(thumb);
            card.appendChild(deleteBtn);
            list.appendChild(card);
        }
    }

    function reorderLayersFromPanel(sourceLayerIndex, targetLayerIndex, placeAfter = false) {
        if (!canvas) return false;

        const sourceIdx = Number(sourceLayerIndex);
        const targetIdx = Number(targetLayerIndex);
        if (!Number.isFinite(sourceIdx) || !Number.isFinite(targetIdx)) return false;
        if (sourceIdx === targetIdx) return false;

        const objects = canvas.getObjects();
        const sourceObj = objects[sourceIdx];
        const targetObj = objects[targetIdx];
        if (!sourceObj || !targetObj) return false;

        const topToBottom = objects.slice().reverse();
        let sourcePos = topToBottom.indexOf(sourceObj);
        let targetPos = topToBottom.indexOf(targetObj);
        if (sourcePos < 0 || targetPos < 0) return false;

        topToBottom.splice(sourcePos, 1);
        if (sourcePos < targetPos) targetPos -= 1;
        const insertPos = Math.max(0, Math.min(topToBottom.length, targetPos + (placeAfter ? 1 : 0)));
        topToBottom.splice(insertPos, 0, sourceObj);

        const bottomToTop = topToBottom.slice().reverse();
        bottomToTop.forEach((obj, index) => {
            canvas.moveTo(obj, index);
            obj.setCoords();
        });

        applyLayerSelectionLock(sourceObj);
        canvas.setActiveObject(sourceObj);
        canvas.requestRenderAll();
        syncTextColorControlFromSelection();
        syncTextStyleControlsFromSelection();
        syncObjectOpacityControlFromSelection();
        syncLayersPanel();
        scheduleHistoryCapture();
        setStatus("Layer reordered");
        return true;
    }

    function bindLayersPanel() {
        const list = document.getElementById("composer-layers-list");
        if (!list || list.dataset.bound === "1") return;
        let draggedLayerIndex = null;

        list.addEventListener("mousedown", (e) => {
            e.stopPropagation();
        });

        list.addEventListener("dragstart", (e) => {
            const card = e.target?.closest?.(".composer-layer-card");
            if (!card) return;
            draggedLayerIndex = card.dataset.layerIndex || null;
            card.classList.add("is-dragging");
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", draggedLayerIndex || "");
            }
        });

        list.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "move";
            }
        });

        list.addEventListener("drop", (e) => {
            const card = e.target?.closest?.(".composer-layer-card");
            e.preventDefault();

            const source = draggedLayerIndex
                || (e.dataTransfer ? e.dataTransfer.getData("text/plain") : "");
            if (!source) return;

            if (card) {
                const target = card.dataset.layerIndex || "";
                const rect = card.getBoundingClientRect();
                const placeAfter = e.clientY > (rect.top + rect.height / 2);
                reorderLayersFromPanel(source, target, placeAfter);
                return;
            }

            // Drop below all cards -> move to the very bottom.
            const cards = [...list.querySelectorAll(".composer-layer-card")];
            const lastCard = cards[cards.length - 1] || null;
            if (!lastCard) return;
            const target = lastCard.dataset.layerIndex || "";
            reorderLayersFromPanel(source, target, true);
        });

        list.addEventListener("dragend", () => {
            draggedLayerIndex = null;
            list.querySelectorAll(".composer-layer-card.is-dragging").forEach((el) => {
                el.classList.remove("is-dragging");
            });
        });

        list.addEventListener("click", (e) => {
            const deleteBtn = e.target?.closest?.(".composer-layer-delete");
            if (deleteBtn && canvas) {
                e.preventDefault();
                e.stopPropagation();
                const card = deleteBtn.closest(".composer-layer-card");
                const idx = Number(card?.dataset.layerIndex);
                if (!Number.isFinite(idx)) return;
                const objects = canvas.getObjects();
                const target = objects[idx];
                if (!target) return;
                disableDrawingMode(true);
                applyLayerSelectionLock(target);
                canvas.setActiveObject(target);
                removeActiveObject();
                scheduleHistoryCapture();
                return;
            }

            const card = e.target?.closest?.(".composer-layer-card");
            if (!card || !canvas) return;

            const idx = Number(card.dataset.layerIndex);
            if (!Number.isFinite(idx)) return;

            const objects = canvas.getObjects();
            const target = objects[idx];
            if (!target) return;

            disableDrawingMode(true);
            applyLayerSelectionLock(target);
            canvas.setActiveObject(target);
            canvas.requestRenderAll();
            syncTextColorControlFromSelection();
            syncTextStyleControlsFromSelection();
            syncObjectOpacityControlFromSelection();
            syncLayersPanel();
        });

        list.dataset.bound = "1";
        syncLayersPanel();
    }

    function bindLayersPanelTracking() {
        if (!canvas || canvas.__composerLayersPanelBound) return;

        const sync = () => {
            syncLayersPanel();
        };

        canvas.on("object:added", sync);
        canvas.on("object:removed", sync);
        canvas.on("object:modified", sync);
        canvas.on("text:changed", sync);
        canvas.on("selection:created", sync);
        canvas.on("selection:updated", sync);
        canvas.on("selection:cleared", sync);
        canvas.on("path:created", sync);

        canvas.__composerLayersPanelBound = true;
        syncLayersPanel();
    }

    function bindHistoryTracking() {
        if (!canvas || canvas.__composerHistoryBound) return;

        const onHistoryChange = (e) => {
            if (shiftCropRasterizing) return;
            if (isInternalComposerObject(e?.target)) return;
            scheduleHistoryCapture();
        };
        const EPS = 0.0001;
        const changed = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > EPS;

        const rememberBeforeTransform = (target) => {
            if (!target) return;
            target.__composerBeforeTransform = {
                left: target.left,
                top: target.top,
                scaleX: target.scaleX,
                scaleY: target.scaleY,
                width: target.width,
                height: target.height,
                cropX: target.cropX,
                cropY: target.cropY,
                angle: target.angle,
                skewX: target.skewX,
                skewY: target.skewY
            };
        };

        const shouldTrackModified = (target) => {
            if (isInternalComposerObject(target)) return false;
            if (!target) return true;
            const before = target.__composerBeforeTransform;
            target.__composerBeforeTransform = null;
            if (!before) return true;

            const moved = changed(before.left, target.left) || changed(before.top, target.top);
            const scaledOrSkewed = changed(before.scaleX, target.scaleX)
                || changed(before.scaleY, target.scaleY)
                || changed(before.skewX, target.skewX)
                || changed(before.skewY, target.skewY);
            const cropped = changed(before.width, target.width)
                || changed(before.height, target.height)
                || changed(before.cropX, target.cropX)
                || changed(before.cropY, target.cropY);
            const rotated = changed(before.angle, target.angle);

            // Ignore pure translate moves in undo stack.
            return scaledOrSkewed || cropped || rotated || !moved;
        };

        canvas.on("object:added", onHistoryChange);
        canvas.on("object:removed", onHistoryChange);
        canvas.on("before:transform", (e) => {
            clearShiftMoveAxisLock();
            rememberBeforeTransform(e?.transform?.target);
        });
        canvas.on("object:moving", constrainObjectMoveToShiftAxis);
        canvas.on("object:modified", (e) => {
            if (!shouldTrackModified(e?.target)) return;
            onHistoryChange();
        });
        canvas.on("path:created", onHistoryChange);
        canvas.on("erasing:end", () => {
            flushHistoryCaptureNow();
        });
        canvas.on("mouse:up", () => {
            endPointerDragTargetLock();
            clearShiftMoveAxisLock();
            if (drawingTool === "eraser" && canvas.isDrawingMode && !eraserFallbackActive) {
                flushHistoryCaptureNow();
            }
        });
        canvas.on("text:changed", onHistoryChange);
        canvas.__composerHistoryBound = true;
    }

    function applyCompactLayout() {
        const wrap = document.querySelector(".composer-stage-wrap");
        if (wrap) {
            applyStageHeight(false);
            wrap.style.overflow = "hidden";
        }

        const root = document.getElementById("forge-composer-root");
        if (root) {
            root.style.padding = "10px";
        }

        const toolbar = document.querySelector(".composer-toolbar");
        if (toolbar) {
            toolbar.style.marginBottom = "10px";
            toolbar.style.gap = "8px";
            toolbar.style.flexWrap = "wrap";
        }

        const footer = document.querySelector(".composer-footer");
        if (footer) {
            footer.style.marginTop = "8px";
            footer.style.position = "sticky";
            footer.style.bottom = "0";
            footer.style.zIndex = "2";
            footer.style.background = "rgba(10,10,10,0.9)";
            footer.style.paddingTop = "4px";
        }
    }

    function fitCanvasSize() {
        const canvasEl = document.getElementById("forge-composer-canvas");
        const stageWrap = document.querySelector(".composer-stage-wrap");
        if (!canvasEl || !stageWrap || !canvas) return;

        const layersReserveWidth = getLayersPanelReserveWidth();
        const rawWidth = stageWrap.clientWidth - 8 - layersReserveWidth;
        const rawHeight = stageWrap.clientHeight - 8;

        // Gradio tabs can initialize while hidden and report tiny sizes.
        // Retry shortly after mount to avoid a permanently shrunken first render.
        if (rawWidth < 300 || rawHeight < 300) {
            window.setTimeout(() => {
                if (!canvas) return;
                fitCanvasSize();
            }, 120);
            return;
        }

        const availableWidth = Math.max(200, rawWidth);
        const availableHeight = Math.max(200, rawHeight);
        displayScale = Math.min(1, availableWidth / sceneWidth, availableHeight / sceneHeight);
        viewportZoom = 1;

        const displayWidth = Math.max(1, Math.round(sceneWidth * displayScale));
        const displayHeight = Math.max(1, Math.round(sceneHeight * displayScale));

        canvas.setViewportTransform([displayScale * viewportZoom, 0, 0, displayScale * viewportZoom, 0, 0]);
        canvas.setWidth(displayWidth);
        canvas.setHeight(displayHeight);
        canvasEl.style.width = `${displayWidth}px`;
        canvasEl.style.height = `${displayHeight}px`;

        const container = canvas.wrapperEl;
        if (container) {
            container.style.width = `${displayWidth}px`;
            container.style.height = `${displayHeight}px`;
            container.style.margin = "0";
            container.style.marginRight = `${layersReserveWidth}px`;
        }

        mountStageActionsOverlay();
        positionLayersPanelNearCanvas();
        updateDrawCursorSize();
        syncGridOverlay();
        canvas.renderAll();
    }

    function resetSceneViewport() {
        if (!canvas || typeof canvas.setViewportTransform !== "function") return;
        viewportZoom = 1;
        canvas.setViewportTransform([displayScale, 0, 0, displayScale, 0, 0]);
        updateDrawCursorSize();
        syncGridOverlay();
    }

    function getLayersPanelReserveWidth() {
        const panel = document.getElementById("composer-layers-panel");
        if (!panel || !isElementVisible(panel)) return 0;
        return LAYERS_PANEL_RESERVE;
    }

    function positionLayersPanelNearCanvas() {
        const panel = document.getElementById("composer-layers-panel");
        const stageWrap = document.querySelector(".composer-stage-wrap");
        const canvasWrap = canvas?.wrapperEl;
        if (!panel || !stageWrap || !canvasWrap) return;

        const panelWidth = panel.offsetWidth || 78;
        const leftByCanvas = Math.round(canvasWrap.offsetLeft + canvasWrap.offsetWidth + LAYERS_PANEL_GAP);
        const maxLeft = Math.max(6, stageWrap.clientWidth - panelWidth - 6);
        const left = Math.max(6, Math.min(maxLeft, leftByCanvas));
        const top = Math.max(6, Math.round(canvasWrap.offsetTop));
        const maxBottomForOverlays = stageWrap.clientHeight - 78;
        const preferredHeight = Math.max(120, Math.round(canvasWrap.offsetHeight));
        const availableHeight = Math.max(120, maxBottomForOverlays - top);
        const height = Math.max(120, Math.min(preferredHeight, availableHeight));

        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.height = `${height}px`;
    }

    function getViewportMinScale() {
        return Math.max(0.0001, displayScale);
    }

    function getViewportMaxScale() {
        return Math.max(getViewportMinScale(), displayScale * 6);
    }

    function getViewportZoomFromTransform() {
        if (!canvas?.viewportTransform) return getViewportMinScale();
        return Math.max(0.0001, canvas.viewportTransform[0] || getViewportMinScale());
    }

    function applyViewportZoomAtPoint(nextAbsScale, clientX, clientY) {
        if (!canvas || !window.fabric) return;

        const minScale = getViewportMinScale();
        const maxScale = getViewportMaxScale();
        const absScale = Math.max(minScale, Math.min(maxScale, nextAbsScale));
        viewportZoom = absScale / Math.max(0.0001, displayScale);

        const rect = canvas.upperCanvasEl?.getBoundingClientRect();
        const px = rect ? clientX - rect.left : canvas.getWidth() / 2;
        const py = rect ? clientY - rect.top : canvas.getHeight() / 2;

        canvas.zoomToPoint(new window.fabric.Point(px, py), absScale);
        updateDrawCursorSize();
        canvas.requestRenderAll();
    }

    function bindMiddleMouseCameraControls() {
        if (!canvas || canvas.__composerMiddleBound) return;
        const upper = canvas.upperCanvasEl;
        if (!upper) return;

        const refreshDrawingAfterMiddlePan = () => {
            if (!canvas) return;
            resetFabricDrawingState();
            if (drawingTool && canvas.isDrawingMode && !eraserFallbackActive) {
                applyDrawingBrush();
            }
        };

        upper.addEventListener("mousedown", (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            resetFabricDrawingState();
            middlePanActive = true;
            middlePanLastX = e.clientX;
            middlePanLastY = e.clientY;
            upper.style.cursor = "grabbing";
        }, { capture: true });

        upper.addEventListener("auxclick", (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
        }, { capture: true });

        window.addEventListener("mousemove", (e) => {
            if (!middlePanActive || !canvas?.viewportTransform) return;
            const vpt = canvas.viewportTransform;
            const dx = e.clientX - middlePanLastX;
            const dy = e.clientY - middlePanLastY;
            middlePanLastX = e.clientX;
            middlePanLastY = e.clientY;

            vpt[4] += dx;
            vpt[5] += dy;
            updateDrawCursorSize();
            canvas.requestRenderAll();
        });

        const stopPan = () => {
            if (!middlePanActive) return;
            middlePanActive = false;
            if (upper) upper.style.cursor = "";
            refreshDrawingAfterMiddlePan();
        };

        window.addEventListener("mouseup", (e) => {
            if (e.button !== 1) return;
            stopPan();
        });
        upper.addEventListener("mouseleave", () => {
            if (!middlePanActive) return;
            // Keep panning if button remains pressed outside canvas.
        });
        window.addEventListener("blur", stopPan);

        upper.addEventListener("wheel", (e) => {
            if (!middlePanActive) return;
            e.preventDefault();
            e.stopPropagation();

            const currentScale = getViewportZoomFromTransform();
            const factor = e.deltaY < 0 ? 1.08 : 0.92;
            applyViewportZoomAtPoint(currentScale * factor, e.clientX, e.clientY);
        }, { passive: false });

        canvas.__composerMiddleBound = true;
    }

    function getSceneViewportSize() {
        if (!canvas) return { width: sceneWidth, height: sceneHeight };
        const zoom = canvas.getZoom() || 1;
        return {
            width: canvas.getWidth() / zoom,
            height: canvas.getHeight() / zoom
        };
    }

    function getSceneCenter() {
        return { x: sceneWidth / 2, y: sceneHeight / 2 };
    }

    function getSceneFocusCenter() {
        if (!canvas || !window.fabric) {
            return getSceneCenter();
        }

        const fabricUtil = window.fabric?.util;
        const vpt = canvas.viewportTransform;
        if (Array.isArray(vpt) && fabricUtil?.invertTransform && fabricUtil?.transformPoint) {
            const centerOnScreen = new window.fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
            const inv = fabricUtil.invertTransform(vpt);
            const centerInScene = fabricUtil.transformPoint(centerOnScreen, inv);
            return {
                x: centerInScene.x,
                y: centerInScene.y
            };
        }

        const viewport = getSceneViewportSize();
        return { x: viewport.width / 2, y: viewport.height / 2 };
    }

    function clampToStepSize(value) {
        const numeric = Number(value) || MIN_SCENE_SIZE;
        const clamped = Math.max(MIN_SCENE_SIZE, Math.min(MAX_SCENE_SIZE, numeric));
        return Math.round(clamped / SCENE_STEP) * SCENE_STEP;
    }

    function clampStageHeight(value) {
        const numeric = Number(value) || STAGE_DEFAULT_HEIGHT;
        const clamped = Math.max(STAGE_MIN_HEIGHT, Math.min(STAGE_MAX_HEIGHT, numeric));
        return Math.round(clamped / STAGE_STEP) * STAGE_STEP;
    }

    function ensureStageHeightOverlay() {
        const stageWrap = document.querySelector(".composer-stage-wrap");
        if (!stageWrap) return null;

        let overlay = document.getElementById("composer-stage-height-overlay");
        let slider = document.getElementById("composer-stage-height-slider");
        let value = document.getElementById("composer-stage-height-value");

        if (!overlay || !slider || !value) {
            overlay = document.createElement("div");
            overlay.id = "composer-stage-height-overlay";
            overlay.className = "composer-stage-height-overlay";

            const label = document.createElement("label");
            label.className = "composer-size-label";
            label.htmlFor = "composer-stage-height-slider";
            label.textContent = "H:";

            slider = document.createElement("input");
            slider.id = "composer-stage-height-slider";
            slider.className = "composer-slider";
            slider.type = "range";
            slider.min = String(STAGE_MIN_HEIGHT);
            slider.max = String(STAGE_MAX_HEIGHT);
            slider.step = String(STAGE_STEP);

            value = document.createElement("span");
            value.id = "composer-stage-height-value";
            value.className = "composer-size-value";

            overlay.appendChild(label);
            overlay.appendChild(slider);
            overlay.appendChild(value);
            stageWrap.appendChild(overlay);
        }

        return { overlay, slider, value };
    }

    function syncStageHeightOverlay() {
        const controls = ensureStageHeightOverlay();
        if (!controls) return;
        controls.slider.value = String(stageHeight);
        controls.value.textContent = String(stageHeight);
    }

    function applyStageHeight(syncOverlay = true) {
        const stageWrap = document.querySelector(".composer-stage-wrap");
        if (!stageWrap) return;
        stageHeight = clampStageHeight(stageHeight);
        stageWrap.style.minHeight = `${stageHeight}px`;
        stageWrap.style.maxHeight = `${stageHeight}px`;
        stageWrap.style.height = `${stageHeight}px`;
        if (syncOverlay) {
            syncStageHeightOverlay();
        }
    }

    function bindStageHeightOverlay() {
        const controls = ensureStageHeightOverlay();
        if (!controls || controls.slider.dataset.bound === "1") return;

        const stop = (e) => {
            e.stopPropagation();
        };
        controls.overlay.addEventListener("mousedown", stop);
        controls.overlay.addEventListener("click", stop);
        controls.overlay.addEventListener("wheel", stop, { passive: true });

        syncStageHeightOverlay();

        controls.slider.addEventListener("input", () => {
            const next = clampStageHeight(controls.slider.value);
            controls.slider.value = String(next);
            controls.value.textContent = String(next);
            if (next === stageHeight) return;
            stageHeight = next;
            applyStageHeight();
            fitCanvasSize();
        });

        controls.slider.dataset.bound = "1";
    }

    function updateSizeLabels() {
        const wVal = document.getElementById("composer-width-value");
        const hVal = document.getElementById("composer-height-value");

        if (wVal) wVal.textContent = String(sceneWidth);
        if (hVal) hVal.textContent = String(sceneHeight);
    }

    function syncCanvasSizeControls() {
        const widthSlider = document.getElementById("composer-width-slider");
        const heightSlider = document.getElementById("composer-height-slider");

        if (widthSlider) widthSlider.value = String(sceneWidth);
        if (heightSlider) heightSlider.value = String(sceneHeight);
        updateSizeLabels();
    }

    function applySceneSize(nextWidth, nextHeight, captureHistory = true) {
        const width = clampToStepSize(nextWidth);
        const height = clampToStepSize(nextHeight);

        if (width === sceneWidth && height === sceneHeight) {
            syncCanvasSizeControls();
            return false;
        }

        sceneWidth = width;
        sceneHeight = height;
        syncCanvasSizeControls();
        fitCanvasSize();
        syncMosaicOverlapPreview();
        if (captureHistory) scheduleHistoryCapture();
        return true;
    }

    function bindCanvasSizeControls() {
        const widthSlider = document.getElementById("composer-width-slider");
        const heightSlider = document.getElementById("composer-height-slider");

        if (!widthSlider || !heightSlider) {
            setStatus("Size controls not found");
            return;
        }

        syncCanvasSizeControls();

        widthSlider.addEventListener("input", () => {
            const next = clampToStepSize(widthSlider.value);
            widthSlider.value = String(next);
            applySceneSize(next, sceneHeight);
        });

        heightSlider.addEventListener("input", () => {
            const next = clampToStepSize(heightSlider.value);
            heightSlider.value = String(next);
            applySceneSize(sceneWidth, next);
        });
    }

    function getComposerBaseUrl() {
        const scriptEl = [...document.querySelectorAll("script[src]")]
            .find((el) => /\/javascript\/composer\.js(\?|$)/i.test(el.src));

        if (!scriptEl) return null;

        const url = scriptEl.src.split("?")[0];
        const idx = url.lastIndexOf("/javascript/composer.js");
        if (idx < 0) return null;

        return url.slice(0, idx);
    }

    function loadScript(src) {
        return new Promise((resolve) => {
            const existing = [...document.querySelectorAll('script[data-composer-fabric="1"]')]
                .find((el) => (el.getAttribute("src") || "") === src);

            if (existing) {
                if (existing.dataset.loaded === "1" && window.fabric) {
                    resolve(true);
                    return;
                }

                existing.addEventListener("load", () => resolve(!!window.fabric), { once: true });
                existing.addEventListener("error", () => resolve(false), { once: true });
                return;
            }

            const script = document.createElement("script");
            script.src = src;
            script.dataset.composerFabric = "1";

            script.onload = () => {
                script.dataset.loaded = "1";
                resolve(!!window.fabric);
            };

            script.onerror = () => {
                script.dataset.failed = "1";
                resolve(false);
            };

            document.head.appendChild(script);
        });
    }

    function ensureFabricLoaded() {
        if (window.fabric) return Promise.resolve(true);
        if (fabricLoadPromise) return fabricLoadPromise;

        const dynamicBase = getComposerBaseUrl();
        const candidateUrls = [
            dynamicBase ? `${dynamicBase}/lib/fabric.min.js` : null,
            "/file=extensions/composer_forge_neo/lib/fabric.min.js",
            "file=extensions/composer_forge_neo/lib/fabric.min.js",
            "./file=extensions/composer_forge_neo/lib/fabric.min.js"
        ].filter(Boolean);

        fabricLoadPromise = (async () => {
            for (const src of candidateUrls) {
                const ok = await loadScript(src);
                if (ok && window.fabric) {
                    setStatus(`Fabric loaded (${src})`);
                    return true;
                }
            }

            setStatus("Failed to load fabric.min.js (all paths)");
            return false;
        })();

        fabricLoadPromise.finally(() => {
            if (!window.fabric) {
                fabricLoadPromise = null;
            }
        });

        return fabricLoadPromise;
    }

    function loadFabric(callback) {
        ensureFabricLoaded().then((ok) => {
            if (ok) callback();
        });
    }

    function fitBackgroundToCanvas(img) {
        if (!canvas || !img) return;

        const cw = sceneWidth;
        const ch = sceneHeight;
        const iw = img.width || img._element?.naturalWidth || 1;
        const ih = img.height || img._element?.naturalHeight || 1;

        const scale = Math.min(cw / iw, ch / ih);

        img.set({
            left: 0,
            top: 0,
            originX: "left",
            originY: "top",
            selectable: true,
            evented: true,
            hasControls: true,
            hasBorders: true,
            lockMovementX: false,
            lockMovementY: false,
            lockRotation: false,
            lockScalingX: false,
            lockScalingY: false,
            scaleX: scale,
            scaleY: scale
        });

        if (typeof canvas.sendObjectToBack === "function") {
            canvas.sendObjectToBack(img);
        }
    }

    function removeBackground() {
        if (!canvas || !backgroundObject) return;
        canvas.remove(backgroundObject);
        backgroundObject = null;
    }

    function scaleBackgroundByWheel(deltaY) {
        if (!canvas || !backgroundObject) return;

        const currentScaleX = backgroundObject.scaleX || 1;
        const currentScaleY = backgroundObject.scaleY || 1;
        const baseScale = Math.max(0.02, Math.min(currentScaleX, currentScaleY));
        const factor = deltaY < 0 ? 1.06 : 0.94;
        const nextScale = Math.max(0.02, Math.min(20, baseScale * factor));

        backgroundObject.set({
            scaleX: nextScale,
            scaleY: nextScale
        });

        backgroundObject.setCoords();
        canvas.setActiveObject(backgroundObject);
        canvas.requestRenderAll();
        setStatus(`Background scale: ${Math.round(nextScale * 100)}%`);
    }

    function scaleObjectByWheel(obj, deltaY) {
        if (!canvas || !obj) return;

        const currentScaleX = obj.scaleX || 1;
        const currentScaleY = obj.scaleY || 1;
        const baseScale = Math.max(0.02, Math.min(currentScaleX, currentScaleY));
        const factor = deltaY < 0 ? 1.06 : 0.94;
        const nextScale = Math.max(0.02, Math.min(20, baseScale * factor));
        const centerPoint = typeof obj.getCenterPoint === "function"
            ? obj.getCenterPoint()
            : null;

        obj.set({
            scaleX: nextScale,
            scaleY: nextScale
        });
        if (centerPoint && typeof obj.setPositionByOrigin === "function") {
            obj.setPositionByOrigin(centerPoint, "center", "center");
        }

        obj.setCoords();
        canvas.setActiveObject(obj);
        canvas.requestRenderAll();
        setStatus(`Object scale: ${Math.round(nextScale * 100)}%`);
    }

    function refitBackgroundToCanvas() {
        if (!canvas || !backgroundObject) {
            setStatus("No background to fit");
            return;
        }

        fitBackgroundToCanvas(backgroundObject);
        canvas.setActiveObject(backgroundObject);
        canvas.renderAll();
        setStatus("Background fitted to canvas");
    }

    function coverActiveImageToCanvas() {
        if (!canvas || !window.fabric) {
            setStatus("Canvas not ready");
            return;
        }

        const active = canvas.getActiveObject();
        if (!isImageObject(active)) {
            setStatus("Select an image first");
            return;
        }

        const iw = active.width || active._element?.naturalWidth || 0;
        const ih = active.height || active._element?.naturalHeight || 0;
        if (!iw || !ih) {
            setStatus("Image has invalid size");
            return;
        }

        flushHistoryCaptureNow();

        const angle = ((Number(active.angle) || 0) * Math.PI) / 180;
        const cos = Math.abs(Math.cos(angle));
        const sin = Math.abs(Math.sin(angle));
        const scaleX = (sceneWidth * cos + sceneHeight * sin) / iw;
        const scaleY = (sceneWidth * sin + sceneHeight * cos) / ih;
        const scale = Math.max(scaleX, scaleY);
        const signX = (Number(active.scaleX) || 1) < 0 ? -1 : 1;
        const signY = (Number(active.scaleY) || 1) < 0 ? -1 : 1;
        const focus = getSceneFocusCenter();
        const center = new window.fabric.Point(focus.x, focus.y);

        active.set({
            scaleX: signX * scale,
            scaleY: signY * scale
        });
        active.setPositionByOrigin(center, "center", "center");
        active.setCoords();
        canvas.setActiveObject(active);
        canvas.requestRenderAll();
        scheduleHistoryCapture();
        setStatus("Image covered canvas");
    }

    function getImageIntrinsicSize(obj) {
        if (!obj) return { width: 0, height: 0 };
        const el = obj._element || obj._originalElement || null;
        return {
            width: Math.round(el?.naturalWidth || el?.videoWidth || obj.width || 0),
            height: Math.round(el?.naturalHeight || el?.videoHeight || obj.height || 0)
        };
    }

    function fitCanvasToActiveImage() {
        if (!canvas || !window.fabric) {
            setStatus("Canvas not ready");
            return;
        }

        const active = canvas.getActiveObject();
        if (!isImageObject(active)) {
            setStatus("Select an image first");
            return;
        }

        const size = getImageIntrinsicSize(active);
        if (!size.width || !size.height) {
            setStatus("Image has invalid size");
            return;
        }

        flushHistoryCaptureNow();

        const nextWidth = clampToStepSize(size.width);
        const nextHeight = clampToStepSize(size.height);
        applySceneSize(nextWidth, nextHeight, false);

        const baseWidth = active.width || size.width;
        const baseHeight = active.height || size.height;
        const signX = (Number(active.scaleX) || 1) < 0 ? -1 : 1;
        const signY = (Number(active.scaleY) || 1) < 0 ? -1 : 1;
        const center = new window.fabric.Point(nextWidth / 2, nextHeight / 2);

        active.set({
            originX: "center",
            originY: "center",
            scaleX: signX * (nextWidth / Math.max(1, baseWidth)),
            scaleY: signY * (nextHeight / Math.max(1, baseHeight))
        });
        active.setPositionByOrigin(center, "center", "center");
        active.setCoords();
        canvas.setActiveObject(active);
        canvas.requestRenderAll();
        scheduleHistoryCapture();
        setStatus(`Canvas fitted to image: ${nextWidth} x ${nextHeight}`);
    }

    function getObjectLocalPoint(obj, sceneX, sceneY) {
        if (!obj || !window.fabric?.util) return null;
        const matrix = typeof obj.calcTransformMatrix === "function" ? obj.calcTransformMatrix() : null;
        if (!matrix) return null;
        const inverted = window.fabric.util.invertTransform(matrix);
        return window.fabric.util.transformPoint(new window.fabric.Point(sceneX, sceneY), inverted);
    }

    function removeMosaicOutpaintLayers() {
        if (!canvas) return 0;
        const layers = canvas.getObjects().filter((obj) => obj?.composerType === MOSAIC_TYPE);
        layers.forEach((obj) => canvas.remove(obj));
        clearMosaicOverlapPreview();
        if (layers.length > 0) mosaicSourceObject = null;
        return layers.length;
    }

    function clearMosaicOverlapPreview() {
        if (!canvas || mosaicOverlapPreviewObjects.length === 0) {
            mosaicOverlapPreviewObjects = [];
            return;
        }
        mosaicOverlapPreviewObjects.forEach((obj) => {
            if (canvas.getObjects().includes(obj)) canvas.remove(obj);
        });
        mosaicOverlapPreviewObjects = [];
    }

    function getExistingMosaicLayer() {
        if (!canvas) return null;
        return canvas.getObjects().find((obj) => obj?.composerType === MOSAIC_TYPE) || null;
    }

    function getLiveMosaicSourceObject() {
        if (canvas && mosaicSourceObject && canvas.getObjects().includes(mosaicSourceObject)) {
            return mosaicSourceObject;
        }
        return getMosaicInpaintSourceObject();
    }

    function syncMosaicOverlapPreview() {
        if (mosaicOverlapPreviewSuspended) return;
        clearMosaicOverlapPreview();
        if (!mosaicControlsVisible) return;
        if (!canvas || !window.fabric?.Line || !window.fabric?.util?.transformPoint) return;

        const sourceObj = getLiveMosaicSourceObject();
        const mosaic = getExistingMosaicLayer();
        if (!sourceObj || !mosaic) return;

        const bounds = getObjectSceneBounds(sourceObj);
        const matrix = typeof sourceObj.calcTransformMatrix === "function" ? sourceObj.calcTransformMatrix() : null;
        const objectW = sourceObj.width || sourceObj._element?.width || 0;
        const objectH = sourceObj.height || sourceObj._element?.height || 0;
        if (!bounds || !Array.isArray(matrix) || !objectW || !objectH) return;

        const sidePad = 1;
        const hasLeftOutpaint = bounds.minX > sidePad;
        const hasRightOutpaint = bounds.maxX < sceneWidth - sidePad;
        const hasTopOutpaint = bounds.minY > sidePad;
        const hasBottomOutpaint = bounds.maxY < sceneHeight - sidePad;
        const overlapX = Math.max(1, objectW * mosaicMaskOverlap);
        const overlapY = Math.max(1, objectH * mosaicMaskOverlap);
        const makePoint = (x, y) => window.fabric.util.transformPoint(new window.fabric.Point(x, y), matrix);
        const lineDefs = [];

        if (hasLeftOutpaint) {
            lineDefs.push([makePoint(-objectW / 2 + overlapX, -objectH / 2), makePoint(-objectW / 2 + overlapX, objectH / 2)]);
        }
        if (hasRightOutpaint) {
            lineDefs.push([makePoint(objectW / 2 - overlapX, -objectH / 2), makePoint(objectW / 2 - overlapX, objectH / 2)]);
        }
        if (hasTopOutpaint) {
            lineDefs.push([makePoint(-objectW / 2, -objectH / 2 + overlapY), makePoint(objectW / 2, -objectH / 2 + overlapY)]);
        }
        if (hasBottomOutpaint) {
            lineDefs.push([makePoint(-objectW / 2, objectH / 2 - overlapY), makePoint(objectW / 2, objectH / 2 - overlapY)]);
        }

        mosaicOverlapPreviewObjects = lineDefs.map(([p0, p1]) => new window.fabric.Line(
            [p0.x, p0.y, p1.x, p1.y],
            {
                stroke: "#35ff35",
                strokeWidth: 2,
                opacity: 0.9,
                selectable: false,
                evented: false,
                excludeFromExport: true,
                composerType: MOSAIC_OVERLAP_PREVIEW_TYPE,
                name: "Mosaic mask overlap preview"
            }
        ));
        mosaicOverlapPreviewObjects.forEach((line) => {
            canvas.add(line);
            if (typeof line.bringToFront === "function") line.bringToFront();
        });
        canvas.requestRenderAll();
    }

    function renderObjectSourceCanvas(obj) {
        if (!obj) return null;

        if (typeof obj.toCanvasElement === "function") {
            try {
                const rendered = obj.toCanvasElement({
                    multiplier: 1,
                    withoutTransform: true
                });
                if (rendered?.width && rendered?.height) return rendered;
            } catch (err) {
                console.warn("[Composer] mosaic object render failed", err);
            }
        }

        const sourceEl = obj._element || obj._originalElement || null;
        const size = getImageIntrinsicSize(obj);
        if (!sourceEl || !size.width || !size.height) return null;

        const fallback = document.createElement("canvas");
        fallback.width = size.width;
        fallback.height = size.height;
        const fallbackCtx = fallback.getContext("2d");
        if (!fallbackCtx) return null;
        fallbackCtx.drawImage(sourceEl, 0, 0, size.width, size.height);
        return fallback;
    }

    function buildMosaicOutpaintCanvas(sourceObj, tileWidth = mosaicTileWidth, tileHeight = mosaicTileHeight) {
        const sourceCanvas = renderObjectSourceCanvas(sourceObj);
        if (!sourceCanvas) return null;

        const size = {
            width: sourceCanvas.width,
            height: sourceCanvas.height
        };
        const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
        if (!sourceCtx) return null;

        const sourcePixels = sourceCtx.getImageData(0, 0, size.width, size.height).data;
        const out = document.createElement("canvas");
        out.width = sceneWidth;
        out.height = sceneHeight;
        const outCtx = out.getContext("2d");
        if (!outCtx) return null;

        const objectWidth = sourceObj.width || size.width;
        const objectHeight = sourceObj.height || size.height;
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        const wrapDistance = (distance, extent) => {
            const max = Math.max(1, extent);
            return ((distance % max) + max) % max;
        };
        const sampleEdgeStripCoordinate = (value, extent, stripSize) => {
            const strip = Math.max(1, Math.min(extent, stripSize));
            if (value < 0) return wrapDistance(-value, strip);
            if (value >= extent) return Math.max(0, extent - 1 - wrapDistance(value - extent, strip));
            return value;
        };
        const objectToPixelX = (value) => clamp(Math.round((value / Math.max(1, objectWidth - 1)) * (size.width - 1)), 0, size.width - 1);
        const objectToPixelY = (value) => clamp(Math.round((value / Math.max(1, objectHeight - 1)) * (size.height - 1)), 0, size.height - 1);
        const getPixelIndex = (px, py) => (py * size.width + px) * 4;
        const findOpaqueSampleIndex = (px, py) => {
            const startIdx = getPixelIndex(px, py);
            if ((sourcePixels[startIdx + 3] || 0) > 8) return startIdx;

            const maxRadius = Math.min(128, Math.max(size.width, size.height));
            for (let radius = 4; radius <= maxRadius; radius += 4) {
                for (let dy = -radius; dy <= radius; dy += 4) {
                    for (let dx = -radius; dx <= radius; dx += 4) {
                        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                        const sx = clamp(px + dx, 0, size.width - 1);
                        const sy = clamp(py + dy, 0, size.height - 1);
                        const idx = getPixelIndex(sx, sy);
                        if ((sourcePixels[idx + 3] || 0) > 8) return idx;
                    }
                }
            }

            return startIdx;
        };
        const bg = normalizeHexColor(currentCanvasBackgroundColor) || "#000000";
        const bgR = parseInt(bg.slice(1, 3), 16);
        const bgG = parseInt(bg.slice(3, 5), 16);
        const bgB = parseInt(bg.slice(5, 7), 16);
        const tileWBase = Math.max(1, Math.round(Number(tileWidth) || MOSAIC_TILE_SIZE));
        const tileHBase = Math.max(1, Math.round(Number(tileHeight) || MOSAIC_TILE_SIZE));
        const stripX = Math.max(tileWBase * 3, objectWidth * 0.12);
        const stripY = Math.max(tileHBase * 3, objectHeight * 0.12);
        const mosaicSampleSteps = 4;
        const sampleSceneColor = (sceneX, sceneY) => {
            const local = getObjectLocalPoint(sourceObj, sceneX, sceneY);
            if (!local) return null;

            const rawObjectX = local.x + objectWidth / 2;
            const rawObjectY = local.y + objectHeight / 2;
            const objectX = sampleEdgeStripCoordinate(rawObjectX, objectWidth, stripX);
            const objectY = sampleEdgeStripCoordinate(rawObjectY, objectHeight, stripY);
            const sampleX = objectToPixelX(objectX);
            const sampleY = objectToPixelY(objectY);
            const idx = findOpaqueSampleIndex(sampleX, sampleY);
            const alpha = sourcePixels[idx + 3] / 255;

            return {
                r: sourcePixels[idx] * alpha + bgR * (1 - alpha),
                g: sourcePixels[idx + 1] * alpha + bgG * (1 - alpha),
                b: sourcePixels[idx + 2] * alpha + bgB * (1 - alpha)
            };
        };

        for (let y = 0; y < sceneHeight; y += tileHBase) {
            const tileH = Math.min(tileHBase, sceneHeight - y);
            for (let x = 0; x < sceneWidth; x += tileWBase) {
                const tileW = Math.min(tileWBase, sceneWidth - x);
                let r = 0;
                let g = 0;
                let b = 0;
                let count = 0;

                for (let sy = 0; sy < mosaicSampleSteps; sy += 1) {
                    const sceneY = y + ((sy + 0.5) / mosaicSampleSteps) * tileH;
                    for (let sx = 0; sx < mosaicSampleSteps; sx += 1) {
                        const sceneX = x + ((sx + 0.5) / mosaicSampleSteps) * tileW;
                        const color = sampleSceneColor(sceneX, sceneY);
                        if (!color) continue;
                        r += color.r;
                        g += color.g;
                        b += color.b;
                        count += 1;
                    }
                }

                if (count === 0) continue;

                outCtx.fillStyle = `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`;
                outCtx.fillRect(x, y, tileW, tileH);
            }
        }

        return out;
    }

    function upsertMosaicOutpaintLayer(sourceObj, silent = false) {
        if (!canvas || !window.fabric || !sourceObj) {
            if (!silent) setStatus("Select an image first");
            return false;
        }

        const objects = canvas.getObjects();
        const existing = getExistingMosaicLayer();
        const existingIndex = existing ? objects.indexOf(existing) : -1;
        if (existing) {
            canvas.remove(existing);
        }
        clearMosaicOverlapPreview();

        const activeIndex = Math.max(0, canvas.getObjects().indexOf(sourceObj));
        const targetIndex = existingIndex >= 0 ? existingIndex : activeIndex;
        const mosaicCanvas = buildMosaicOutpaintCanvas(sourceObj, mosaicTileWidth, mosaicTileHeight);
        if (!mosaicCanvas) {
            if (!silent) setStatus("Mosaic source is not ready");
            return false;
        }

        const mosaic = new window.fabric.Image(mosaicCanvas, {
            left: 0,
            top: 0,
            originX: "left",
            originY: "top",
            selectable: true,
            evented: false,
            hasControls: true,
            hasBorders: true,
            name: "Mosaic outpaint",
            composerType: MOSAIC_TYPE
        });

        canvas.add(mosaic);
        if (typeof canvas.moveTo === "function") {
            canvas.moveTo(mosaic, targetIndex);
        }
        mosaicSourceObject = sourceObj;
        sourceObj.setCoords();
        mosaic.setCoords();
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        syncLayersPanel();
        syncMosaicOverlapPreview();
        scheduleHistoryCapture();
        if (!silent) setStatus("Mosaic outpaint layer created");
        return true;
    }

    function getSelectedMosaicSourceObject() {
        if (!canvas) return null;
        const objects = canvas.getObjects();
        const active = canvas.getActiveObject();
        if (isImageObject(active) && active?.composerType !== MOSAIC_TYPE && objects.includes(active)) {
            return active;
        }
        if (isImageObject(lockedLayerObject) && lockedLayerObject?.composerType !== MOSAIC_TYPE && objects.includes(lockedLayerObject)) {
            return lockedLayerObject;
        }
        if (isImageObject(lastSelectedImageObject) && lastSelectedImageObject?.composerType !== MOSAIC_TYPE && objects.includes(lastSelectedImageObject)) {
            return lastSelectedImageObject;
        }
        return null;
    }

    function createMosaicOutpaintFromActiveImage() {
        if (!canvas || !window.fabric) {
            setStatus("Canvas not ready");
            return;
        }

        const source = getSelectedMosaicSourceObject();
        if (!source) {
            setStatus("Select an image first");
            return;
        }

        try {
            flushHistoryCaptureNow();
            if (upsertMosaicOutpaintLayer(source, false)) {
                setMosaicControlsVisible(true);
            }
        } catch (err) {
            console.error(err);
            setStatus(`Mosaic failed: ${err?.message || "Unknown error"}`);
        }
    }

    function addImageObject(img, asBackground, name) {
        const realW = img.width || img._element?.naturalWidth || 0;
        const realH = img.height || img._element?.naturalHeight || 0;

        if (!realW || !realH) {
            setStatus(`Image has invalid size: ${name}`);
            return;
        }

        if (asBackground) {
            removeBackground();

            img.set({
                name: name,
                composerType: "background"
            });

            backgroundObject = img;
            canvas.add(img);
            fitBackgroundToCanvas(img);
            canvas.renderAll();
            setStatus(`Background loaded: ${name}`);
            return;
        }

        img.set({
            name: name,
            composerType: "object",
            cornerStyle: "circle",
            transparentCorners: false,
            padding: 4
        });

        const maxSize = 768;
        const scale = Math.min(1, maxSize / realW, maxSize / realH);
        const focus = getSceneFocusCenter();

        img.scale(scale);
        img.set({
            left: Math.round(focus.x),
            top: Math.round(focus.y),
            originX: "center",
            originY: "center"
        });

        canvas.add(img);
        canvas.setActiveObject(img);
        lastSelectedImageObject = img;
        canvas.renderAll();
        setStatus(`Object added: ${name}`);
    }

    function addImageToCanvas(dataUrl, asBackground = false, name = "Image") {
        if (!canvas || !window.fabric) {
            setStatus("Canvas or Fabric not ready");
            return;
        }

        setStatus(`Loading image: ${name}`);

        try {
            const rawImg = new Image();
            rawImg.onload = () => {
                try {
                    const fabricImg = new window.fabric.Image(rawImg);
                    addImageObject(fabricImg, asBackground, name);
                } catch (err) {
                    console.error(err);
                    setStatus(`Fabric image build failed: ${name}`);
                }
            };
            rawImg.onerror = () => {
                setStatus(`Image decode failed: ${name}`);
            };
            rawImg.src = dataUrl;
        } catch (err) {
            console.error(err);
            setStatus(`Fabric load exception: ${name}`);
        }
    }

    function addTextToCanvas(textValue) {
        if (!canvas || !window.fabric) {
            setStatus("Canvas or Fabric not ready");
            return;
        }

        const safeText = (textValue || "").trim();
        if (!safeText) {
            setStatus("Text is empty");
            return;
        }

        const focus = getSceneFocusCenter();
        const text = new window.fabric.IText(safeText, {
            left: Math.max(16, Math.round(focus.x)),
            top: Math.max(16, Math.round(focus.y)),
            originX: "center",
            originY: "center",
            fill: currentTextColor,
            fontSize: 48,
            fontFamily: currentTextFontFamily,
            fontWeight: currentTextFontWeight,
            fontStyle: currentTextFontStyle,
            stroke: "rgba(0,0,0,0.35)",
            strokeWidth: 1,
            paintFirst: "stroke",
            cornerStyle: "circle",
            transparentCorners: false,
            padding: 4,
            composerType: "text"
        });

        canvas.add(text);
        canvas.setActiveObject(text);
        canvas.renderAll();
        setStatus("Text added");
    }

    function getShapeBaseProps() {
        const focus = getSceneFocusCenter();
        return {
            left: Math.max(24, Math.round(focus.x)),
            top: Math.max(24, Math.round(focus.y)),
            originX: "center",
            originY: "center",
            fill: currentTextColor,
            stroke: null,
            strokeWidth: 0,
            cornerStyle: "circle",
            transparentCorners: false,
            padding: 4,
            composerType: "shape"
        };
    }

    const DEFAULT_SHAPE_SIZE = 320;

    function getRegularPolygonRadiusForSize(sides, size) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const angleOffset = -Math.PI / 2;
        for (let i = 0; i < sides; i += 1) {
            const angle = angleOffset + (i * 2 * Math.PI) / sides;
            const x = Math.cos(angle);
            const y = Math.sin(angle);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        const unitSize = Math.max(maxX - minX, maxY - minY);
        return unitSize > 0 ? size / unitSize : size / 2;
    }

    function buildRegularPolygonPoints(sides, radius) {
        const points = [];
        const angleOffset = -Math.PI / 2;
        for (let i = 0; i < sides; i += 1) {
            const angle = angleOffset + (i * 2 * Math.PI) / sides;
            points.push({
                x: radius * Math.cos(angle),
                y: radius * Math.sin(angle)
            });
        }
        return points;
    }

    function addShapeToCanvas(shapeType) {
        if (!canvas || !window.fabric) {
            setStatus("Canvas or Fabric not ready");
            return;
        }

        const base = getShapeBaseProps();
        let shape = null;

        if (shapeType === "rect") {
            shape = new window.fabric.Rect({
                ...base,
                width: DEFAULT_SHAPE_SIZE,
                height: DEFAULT_SHAPE_SIZE,
                rx: 2,
                ry: 2,
                name: "Square"
            });
        } else if (shapeType === "circle") {
            shape = new window.fabric.Circle({
                ...base,
                radius: DEFAULT_SHAPE_SIZE / 2,
                name: "Circle"
            });
        } else if (shapeType === "triangle") {
            shape = new window.fabric.Polygon(buildRegularPolygonPoints(3, getRegularPolygonRadiusForSize(3, DEFAULT_SHAPE_SIZE)), {
                ...base,
                name: "Triangle"
            });
        } else if (shapeType === "pentagon") {
            shape = new window.fabric.Polygon(buildRegularPolygonPoints(5, getRegularPolygonRadiusForSize(5, DEFAULT_SHAPE_SIZE)), {
                ...base,
                name: "Pentagon"
            });
        } else if (shapeType === "hexagon") {
            shape = new window.fabric.Polygon(buildRegularPolygonPoints(6, getRegularPolygonRadiusForSize(6, DEFAULT_SHAPE_SIZE)), {
                ...base,
                name: "Hexagon"
            });
        } else if (shapeType === "octagon") {
            shape = new window.fabric.Polygon(buildRegularPolygonPoints(8, getRegularPolygonRadiusForSize(8, DEFAULT_SHAPE_SIZE)), {
                ...base,
                name: "Octagon"
            });
        }

        if (!shape) {
            setStatus("Unknown shape type");
            return;
        }

        canvas.add(shape);
        canvas.setActiveObject(shape);
        canvas.requestRenderAll();
        setStatus(`${shape.name} added`);
    }

    function isTextObject(obj) {
        if (!obj) return false;
        return obj.type === "i-text" || obj.type === "text" || obj.type === "textbox";
    }

    function isShapeObject(obj) {
        if (!obj) return false;
        if (obj.composerType === "shape" && obj.type !== "image") return true;
        return obj.type === "rect" || obj.type === "circle" || obj.type === "polygon" || obj.type === "triangle";
    }

    function isColorEditableObject(obj) {
        return isTextObject(obj) || isShapeObject(obj);
    }

    function normalizeFontWeight(value) {
        if (value === "bold") return "700";
        if (value === "normal") return "400";
        const num = Math.round(Number(value));
        if (Number.isFinite(num) && num >= 100 && num <= 900) {
            return String(num);
        }
        return "400";
    }

    function isBoldWeight(value) {
        const normalized = normalizeFontWeight(value);
        return Number(normalized) >= 600;
    }

    function normalizeFontStyle(value) {
        const text = String(value || "").toLowerCase();
        if (text === "italic" || text === "oblique") return "italic";
        return "normal";
    }

    function updateTextStyleControlsState() {
        const fontSelect = document.getElementById("composer-font-family");
        const boldBtn = document.getElementById("composer-font-bold-btn");
        const italicBtn = document.getElementById("composer-font-italic-btn");

        if (fontSelect) {
            const hasOption = Array.from(fontSelect.options).some((opt) => opt.value === currentTextFontFamily);
            if (!hasOption && fontSelect.options.length > 0) {
                currentTextFontFamily = fontSelect.options[0].value;
            }
            fontSelect.value = currentTextFontFamily;
        }

        if (boldBtn) {
            boldBtn.classList.toggle("is-active", isBoldWeight(currentTextFontWeight));
        }
        if (italicBtn) {
            italicBtn.classList.toggle("is-active", normalizeFontStyle(currentTextFontStyle) === "italic");
        }
    }

    function applyTextStyleToSelection(stylePatch, silent = false) {
        if (!canvas) return false;
        const active = canvas.getActiveObject();
        if (!active) return false;

        const patch = {};
        if (typeof stylePatch?.fontFamily === "string" && stylePatch.fontFamily.trim()) {
            patch.fontFamily = stylePatch.fontFamily.trim();
        }
        if (typeof stylePatch?.fontWeight !== "undefined") {
            patch.fontWeight = normalizeFontWeight(stylePatch.fontWeight);
        }
        if (typeof stylePatch?.fontStyle !== "undefined") {
            patch.fontStyle = normalizeFontStyle(stylePatch.fontStyle);
        }

        const keys = Object.keys(patch);
        if (keys.length === 0) return false;

        let changed = 0;
        const applyToObject = (obj) => {
            if (!isTextObject(obj)) return;

            let localChanged = false;
            keys.forEach((key) => {
                const nextValue = patch[key];
                if (obj[key] === nextValue) return;
                obj.set(key, nextValue);
                localChanged = true;
            });

            if (localChanged) {
                obj.setCoords();
                changed += 1;
            }
        };

        if (active.type === "activeSelection" && typeof active.forEachObject === "function") {
            active.forEachObject((obj) => applyToObject(obj));
        } else {
            applyToObject(active);
        }

        if (changed > 0) {
            canvas.requestRenderAll();
            scheduleHistoryCapture();
        }

        if (!silent) {
            if (changed > 0) {
                setStatus(changed === 1 ? "Text style applied" : `Text style applied: ${changed}`);
            } else {
                setStatus("Text style set for new text");
            }
        }

        return changed > 0;
    }

    function syncTextStyleControlsFromSelection() {
        const fontSelect = document.getElementById("composer-font-family");
        const boldBtn = document.getElementById("composer-font-bold-btn");
        const italicBtn = document.getElementById("composer-font-italic-btn");
        if (!fontSelect && !boldBtn && !italicBtn) return;
        if (!canvas) return;

        const active = canvas.getActiveObject();
        if (!active) {
            updateTextStyleControlsState();
            return;
        }

        let sample = null;
        if (isTextObject(active)) {
            sample = active;
        } else if (active.type === "activeSelection" && typeof active.getObjects === "function") {
            sample = active.getObjects().find((obj) => isTextObject(obj)) || null;
        }

        if (!sample) {
            updateTextStyleControlsState();
            return;
        }

        const nextFamily = String(sample.fontFamily || "").trim();
        if (nextFamily) {
            currentTextFontFamily = nextFamily;
        }
        currentTextFontWeight = normalizeFontWeight(sample.fontWeight);
        currentTextFontStyle = normalizeFontStyle(sample.fontStyle);
        updateTextStyleControlsState();
    }

    function bindTextStyleControls() {
        const fontSelect = document.getElementById("composer-font-family");
        const boldBtn = document.getElementById("composer-font-bold-btn");
        const italicBtn = document.getElementById("composer-font-italic-btn");
        if (!fontSelect || !boldBtn || !italicBtn) return;
        if (fontSelect.dataset.bound === "1") return;

        fontSelect.addEventListener("change", () => {
            const value = String(fontSelect.value || "").trim();
            if (!value) return;
            currentTextFontFamily = value;
            updateTextStyleControlsState();
            applyTextStyleToSelection({ fontFamily: currentTextFontFamily }, false);
        });

        boldBtn.addEventListener("click", () => {
            currentTextFontWeight = isBoldWeight(currentTextFontWeight) ? "400" : "700";
            updateTextStyleControlsState();
            applyTextStyleToSelection({ fontWeight: currentTextFontWeight }, false);
        });

        italicBtn.addEventListener("click", () => {
            currentTextFontStyle = normalizeFontStyle(currentTextFontStyle) === "italic" ? "normal" : "italic";
            updateTextStyleControlsState();
            applyTextStyleToSelection({ fontStyle: currentTextFontStyle }, false);
        });

        fontSelect.dataset.bound = "1";
        boldBtn.dataset.bound = "1";
        italicBtn.dataset.bound = "1";
        updateTextStyleControlsState();
    }

    function normalizeHexColor(colorValue) {
        if (typeof colorValue !== "string") return null;
        const value = colorValue.trim();
        if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
        if (/^#[0-9a-f]{3}$/i.test(value)) {
            const r = value[1];
            const g = value[2];
            const b = value[3];
            return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
        }
        const rgbMatch = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+\s*)?\)$/i);
        if (rgbMatch) {
            const clamp = (n) => Math.max(0, Math.min(255, Number(n) || 0));
            const toHex = (n) => clamp(n).toString(16).padStart(2, "0");
            return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
        }
        return null;
    }

    function syncCanvasBackgroundControl() {
        const colorInput = document.getElementById("composer-canvas-bg-color");
        const fromCanvas = normalizeHexColor(canvas?.backgroundColor);
        if (fromCanvas) {
            currentCanvasBackgroundColor = fromCanvas;
        }
        if (colorInput) {
            colorInput.value = currentCanvasBackgroundColor;
        }
    }

    function setCanvasBackgroundColor(colorValue, silent = false) {
        const normalized = normalizeHexColor(colorValue);
        if (!normalized) return false;

        currentCanvasBackgroundColor = normalized;
        const colorInput = document.getElementById("composer-canvas-bg-color");
        if (colorInput && colorInput.value !== normalized) {
            colorInput.value = normalized;
        }

        if (!canvas) return false;

        const previous = normalizeHexColor(canvas.backgroundColor) || "";
        if (previous === normalized) return false;

        if (typeof canvas.setBackgroundColor === "function") {
            canvas.setBackgroundColor(normalized, () => {
                canvas.requestRenderAll();
            });
        } else {
            canvas.backgroundColor = normalized;
            canvas.requestRenderAll();
        }

        scheduleHistoryCapture();
        if (!silent) setStatus(`Canvas color: ${normalized}`);
        return true;
    }

    function bindCanvasBackgroundControl() {
        const colorInput = document.getElementById("composer-canvas-bg-color");
        if (!colorInput || colorInput.dataset.bound === "1") return;

        colorInput.addEventListener("input", () => {
            setCanvasBackgroundColor(colorInput.value, true);
        });
        colorInput.addEventListener("change", () => {
            setCanvasBackgroundColor(colorInput.value, false);
        });

        colorInput.dataset.bound = "1";
        syncCanvasBackgroundControl();
    }

    function setTextColor(colorValue) {
        const normalized = normalizeHexColor(colorValue);
        if (!normalized) {
            setStatus("Invalid color");
            return;
        }

        currentTextColor = normalized;
        drawColor = normalized;
        const unifiedColorInput = document.getElementById("composer-draw-color");
        if (unifiedColorInput) {
            unifiedColorInput.value = normalized;
        }

        const active = canvas?.getActiveObject();
        if (!active) {
            setStatus(`Color set: ${currentTextColor}`);
            return;
        }

        if (active.type === "activeSelection" && typeof active.forEachObject === "function") {
            let changed = 0;
            active.forEachObject((obj) => {
                if (!isColorEditableObject(obj)) return;
                obj.set("fill", currentTextColor);
                obj.setCoords();
                changed += 1;
            });
            canvas.requestRenderAll();
            if (changed > 0) scheduleHistoryCapture();
            setStatus(changed > 0 ? `Color applied: ${currentTextColor}` : "No text/shape in selection");
            return;
        }

        if (isColorEditableObject(active)) {
            active.set("fill", currentTextColor);
            active.setCoords();
            canvas.requestRenderAll();
            scheduleHistoryCapture();
            setStatus(`Color applied: ${currentTextColor}`);
            return;
        }

        setStatus(`Color set: ${currentTextColor}`);
    }

    function syncTextColorControlFromSelection() {
        const colorInput = document.getElementById("composer-draw-color");
        if (!colorInput || !canvas) return;

        const active = canvas.getActiveObject();
        if (!active || active.type === "activeSelection") return;
        if (!isColorEditableObject(active)) return;

        const normalized = normalizeHexColor(active.fill);
        if (!normalized) return;

        currentTextColor = normalized;
        drawColor = normalized;
        colorInput.value = normalized;
        if (drawingTool === "brush" && canvas?.isDrawingMode) {
            applyDrawingBrush();
        }
    }

    function getOpacityPercentFromObject(obj) {
        if (!obj) return 100;
        const op = Number(obj.opacity);
        if (!Number.isFinite(op)) return 100;
        return Math.max(0, Math.min(100, Math.round(op * 100)));
    }

    function syncObjectOpacityControlFromSelection() {
        const opacityInput = document.getElementById("composer-object-opacity");
        const opacityValue = document.getElementById("composer-object-opacity-value");
        if (!opacityInput || !opacityValue || !canvas) return;

        const active = canvas.getActiveObject();
        if (!active) {
            opacityInput.disabled = true;
            opacityInput.value = "100";
            opacityValue.textContent = "100";
            return;
        }

        let percent = 100;
        if (active.type === "activeSelection" && typeof active.getObjects === "function") {
            const list = active.getObjects();
            percent = list.length > 0 ? getOpacityPercentFromObject(list[0]) : 100;
        } else {
            percent = getOpacityPercentFromObject(active);
        }

        opacityInput.disabled = false;
        opacityInput.value = String(percent);
        opacityValue.textContent = String(percent);
    }

    function applyOpacityToSelection(percent, silent = true) {
        if (!canvas) return false;
        const active = canvas.getActiveObject();
        if (!active) return false;

        const clamped = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        const value = clamped / 100;

        if (active.type === "activeSelection" && typeof active.forEachObject === "function") {
            active.forEachObject((obj) => {
                obj.set("opacity", value);
                obj.setCoords();
            });
        } else {
            active.set("opacity", value);
            active.setCoords();
        }

        canvas.requestRenderAll();
        scheduleHistoryCapture();
        if (!silent) setStatus(`Opacity: ${clamped}%`);
        return true;
    }

    function bindObjectOpacityControls() {
        const opacityInput = document.getElementById("composer-object-opacity");
        const opacityValue = document.getElementById("composer-object-opacity-value");
        if (!opacityInput || !opacityValue) return;

        const onInput = () => {
            const val = Math.max(0, Math.min(100, Math.round(Number(opacityInput.value) || 0)));
            opacityInput.value = String(val);
            opacityValue.textContent = String(val);
            applyOpacityToSelection(val, true);
        };

        opacityInput.addEventListener("input", onInput);
        opacityInput.addEventListener("change", () => {
            const val = Math.max(0, Math.min(100, Math.round(Number(opacityInput.value) || 0)));
            applyOpacityToSelection(val, false);
        });

        syncObjectOpacityControlFromSelection();
    }

    function moveActiveObjectLayer(direction) {
        if (!canvas) {
            setStatus("Canvas not ready");
            return;
        }

        const active = canvas.getActiveObject();
        if (!active) {
            setStatus("Select an object first");
            return;
        }

        const objects = canvas.getObjects();
        const currentIndex = objects.indexOf(active);

        if (currentIndex < 0) {
            setStatus("Selected object not found");
            return;
        }

        const minIndex = backgroundObject && active !== backgroundObject ? 1 : 0;
        const maxIndex = Math.max(minIndex, objects.length - 1);
        const shift = direction === "up" ? 1 : -1;
        const targetIndex = Math.max(minIndex, Math.min(maxIndex, currentIndex + shift));

        if (targetIndex === currentIndex) {
            setStatus(direction === "up" ? "Already on top" : "Already at bottom");
            return;
        }

        canvas.moveTo(active, targetIndex);
        active.setCoords();
        canvas.setActiveObject(active);
        canvas.requestRenderAll();
        syncLayersPanel();
        scheduleHistoryCapture();
        setStatus(direction === "up" ? "Moved layer up" : "Moved layer down");
    }

    function flipActiveObject(axis) {
        if (!canvas) {
            setStatus("Canvas not ready");
            return;
        }

        const active = canvas.getActiveObject();
        if (!active) {
            setStatus("Select an object first");
            return;
        }

        // Capture current state before flip so Undo reverts only the mirror action,
        // even if the latest operation before it was a pure move (not tracked separately).
        flushHistoryCaptureNow();

        const isX = axis === "x";
        const prop = isX ? "flipX" : "flipY";
        const normalizeAngle = (value) => {
            let a = Number(value) || 0;
            while (a > 180) a -= 360;
            while (a <= -180) a += 360;
            return a;
        };
        const applyMirrorToObject = (obj) => {
            if (!obj) return;
            const centerPoint = typeof obj.getCenterPoint === "function"
                ? obj.getCenterPoint()
                : null;
            const nextAngle = normalizeAngle(-(Number(obj.angle) || 0));
            obj.set(prop, !obj[prop]);
            obj.set("angle", nextAngle);
            if (centerPoint && typeof obj.setPositionByOrigin === "function") {
                obj.setPositionByOrigin(centerPoint, "center", "center");
            }
            obj.setCoords();
        };

        if (active.type === "activeSelection" && typeof active.forEachObject === "function") {
            const selectedObjects = active.getObjects ? active.getObjects().slice() : [];
            const changed = selectedObjects.length;
            const group = typeof active.toGroup === "function" ? active.toGroup() : null;
            if (!group) {
                setStatus("Flip failed");
                return;
            }

            applyMirrorToObject(group);

            if (typeof group.toActiveSelection === "function") {
                group.toActiveSelection();
            }
            const nextActive = canvas.getActiveObject();
            if (nextActive) nextActive.setCoords();
            canvas.requestRenderAll();
            if (changed > 0) scheduleHistoryCapture();
            setStatus(changed > 0 ? `Flipped ${changed} object(s)` : "Nothing to flip");
            return;
        }

        applyMirrorToObject(active);
        canvas.setActiveObject(active);
        canvas.requestRenderAll();
        scheduleHistoryCapture();
        setStatus(isX ? "Flipped horizontally" : "Flipped vertically");
    }

    function removeActiveObject() {
        if (!canvas) return false;

        const active = canvas.getActiveObject();
        if (!active) {
            setStatus("Select an object first");
            return false;
        }

        // Do not treat Delete as object remove while editing text content.
        if (isTextObject(active) && active.isEditing) {
            return false;
        }

        if (active.type === "activeSelection" && typeof active.forEachObject === "function") {
            const selected = [];
            active.forEachObject((obj) => selected.push(obj));
            selected.forEach((obj) => {
                if (obj === backgroundObject) {
                    backgroundObject = null;
                }
                canvas.remove(obj);
            });
            canvas.discardActiveObject();
            canvas.requestRenderAll();
            setStatus("Selected objects deleted");
            return true;
        }

        if (active === backgroundObject) {
            backgroundObject = null;
        }
        if (active === lastSelectedImageObject) {
            lastSelectedImageObject = null;
        }
        if (active === mosaicSourceObject) {
            mosaicSourceObject = null;
            clearMosaicOverlapPreview();
        }
        canvas.remove(active);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        setStatus("Object deleted");
        return true;
    }

    function cloneWithOffset(source, offsetX = 20, offsetY = 20) {
        return new Promise((resolve, reject) => {
            if (!source || typeof source.clone !== "function") {
                reject(new Error("Object cannot be cloned"));
                return;
            }

            source.clone((cloned) => {
                if (!cloned) {
                    reject(new Error("Clone result is empty"));
                    return;
                }

                // Keep custom metadata used by Composer tools.
                cloned.set({
                    composerType: source.composerType,
                    name: source.name,
                    warpCorners: source.warpCorners ? cloneWarpCorners(source.warpCorners) : undefined
                });

                cloned.set({
                    left: (source.left || 0) + offsetX,
                    top: (source.top || 0) + offsetY
                });
                cloned.setCoords();
                resolve(cloned);
            });
        });
    }

    async function duplicateActiveObject() {
        if (!canvas) return false;

        const active = canvas.getActiveObject();
        if (!active) {
            setStatus("Select an object first");
            return false;
        }

        if (isTextObject(active) && active.isEditing) {
            return false;
        }

        try {
            if (active.type === "activeSelection" && typeof active.forEachObject === "function") {
                const selected = [];
                active.forEachObject((obj) => selected.push(obj));
                if (selected.length === 0) {
                    setStatus("Nothing selected");
                    return false;
                }

                const clones = [];
                for (const obj of selected) {
                    const clone = await cloneWithOffset(obj, 20, 20);
                    clones.push(clone);
                }

                canvas.discardActiveObject();
                clones.forEach((obj) => canvas.add(obj));

                if (window.fabric?.ActiveSelection) {
                    const newSelection = new window.fabric.ActiveSelection(clones, { canvas });
                    canvas.setActiveObject(newSelection);
                } else {
                    canvas.setActiveObject(clones[clones.length - 1]);
                }

                canvas.requestRenderAll();
                setStatus(`Duplicated ${clones.length} object(s)`);
                return true;
            }

            const cloned = await cloneWithOffset(active, 20, 20);
            canvas.add(cloned);
            canvas.setActiveObject(cloned);
            canvas.requestRenderAll();
            setStatus("Object duplicated");
            return true;
        } catch (err) {
            console.error(err);
            setStatus("Duplicate failed");
            return false;
        }
    }

    function bindDeleteShortcut() {
        if (!document || document.__composerDeleteBound) return;

        document.addEventListener("keydown", (e) => {
            const target = e.target;
            const tag = target?.tagName ? String(target.tagName).toLowerCase() : "";
            const isTypingTarget = tag === "input" || tag === "textarea" || target?.isContentEditable;
            if (isTypingTarget) return;

            const hasNoModifiers = !e.ctrlKey && !e.metaKey && !e.altKey;
            if (hasNoModifiers && e.code === "KeyZ") {
                zViewportZoomActive = true;
                return;
            }

            if (e.key === "Delete" && removeActiveObject()) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            const isDuplicateShortcut = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
                && (e.key === "d" || e.key === "D");
            if (isDuplicateShortcut) {
                e.preventDefault();
                e.stopPropagation();
                duplicateActiveObject();
                return;
            }

            const isCopyShortcut = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
                && (e.key === "c" || e.key === "C");
            if (isCopyShortcut) {
                e.preventDefault();
                e.stopPropagation();
                void copyCanvasCompositionToClipboard();
                return;
            }

            const isUndoShortcut = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
                && (e.key === "z" || e.key === "Z");
            if (isUndoShortcut && undoHistory()) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            const isRedoShortcut = (e.ctrlKey || e.metaKey) && !e.altKey
                && (
                    (!e.shiftKey && (e.key === "y" || e.key === "Y"))
                    || (e.shiftKey && (e.key === "z" || e.key === "Z"))
                );
            if (isRedoShortcut && redoHistory()) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            if (hasNoModifiers && e.code === "KeyB") {
                e.preventDefault();
                e.stopPropagation();
                setDrawingTool("brush");
                return;
            }
            if (hasNoModifiers && e.code === "KeyE") {
                e.preventDefault();
                e.stopPropagation();
                setDrawingTool("eraser");
            }
        });
        document.addEventListener("keyup", (e) => {
            if (e.code === "KeyZ") zViewportZoomActive = false;
        });
        window.addEventListener("blur", () => {
            zViewportZoomActive = false;
        });

        document.__composerDeleteBound = true;
    }

    function bindOutsideCanvasDeselect() {
        if (!document || document.__composerOutsideDeselectBound) return;

        document.addEventListener("mousedown", (e) => {
            if (!canvas) return;
            if (e.button !== 0) return;

            const root = document.getElementById("forge-composer-root");
            if (!root || !isElementVisible(root)) return;
            const stageWrap = document.querySelector(".composer-stage-wrap");

            const active = canvas.getActiveObject();
            if (!active) return;

            const target = e.target;
            // Keep selection while interacting with composer UI controls
            // (sliders/buttons/toolbars); only stage-area clicks should deselect.
            if (root.contains(target) && stageWrap && !stageWrap.contains(target)) return;
            const inUpper = !!(canvas.upperCanvasEl && target && canvas.upperCanvasEl.contains(target));
            const inLower = !!(canvas.lowerCanvasEl && target && canvas.lowerCanvasEl.contains(target));
            if (inUpper || inLower) return;

            clearLayerSelectionLock();
            canvas.discardActiveObject();
            canvas.requestRenderAll();
            syncTextColorControlFromSelection();
            syncTextStyleControlsFromSelection();
            syncObjectOpacityControlFromSelection();
        });

        document.__composerOutsideDeselectBound = true;
    }

    function getClipboardImageFiles(clipboardData) {
        if (!clipboardData) return [];

        const files = [];
        const seen = new Set();
        const pushUnique = (file) => {
            if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) return;
            const key = [file.name || "", file.size || 0, file.type, file.lastModified || 0].join("|");
            if (seen.has(key)) return;
            seen.add(key);
            files.push(file);
        };

        if (clipboardData.items && clipboardData.items.length > 0) {
            for (const item of clipboardData.items) {
                if (!item || item.kind !== "file") continue;
                if (typeof item.type !== "string" || !item.type.startsWith("image/")) continue;
                const file = typeof item.getAsFile === "function" ? item.getAsFile() : null;
                pushUnique(file);
            }
        }

        if (files.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
            Array.from(clipboardData.files).forEach(pushUnique);
        }

        return files;
    }

    function bindClipboardPaste() {
        if (!document || document.__composerPasteBound) return;

        document.addEventListener("paste", (e) => {
            const target = e.target;
            const tag = target?.tagName ? String(target.tagName).toLowerCase() : "";
            const isTypingTarget = tag === "input" || tag === "textarea" || target?.isContentEditable;
            if (isTypingTarget) return;
            if (!canvas) return;

            const root = document.getElementById("forge-composer-root");
            if (!root || !isElementVisible(root)) return;

            const imageFiles = getClipboardImageFiles(e.clipboardData);
            if (imageFiles.length === 0) return;

            e.preventDefault();
            e.stopPropagation();
            disableDrawingMode(true);
            readFiles(imageFiles, false);
            setStatus(imageFiles.length === 1 ? "Image pasted from clipboard" : `Images pasted from clipboard: ${imageFiles.length}`);
        });

        document.__composerPasteBound = true;
    }

    async function copyCanvasCompositionToClipboard() {
        if (!canvas) {
            setStatus("Canvas not ready");
            return false;
        }

        const root = document.getElementById("forge-composer-root");
        if (!root || !isElementVisible(root)) {
            return false;
        }

        const dataUrl = exportCanvasToDataUrl();
        if (!dataUrl) return false;

        try {
            const blob = dataURLtoBlob(dataUrl);
            const clipboard = navigator?.clipboard;
            const ClipboardItemCtor = window.ClipboardItem || (typeof ClipboardItem !== "undefined" ? ClipboardItem : null);

            if (clipboard?.write && ClipboardItemCtor) {
                const mime = blob.type || "image/png";
                await clipboard.write([new ClipboardItemCtor({ [mime]: blob })]);
                setStatus("Scene copied to clipboard");
                return true;
            }

            if (clipboard?.writeText) {
                await clipboard.writeText(dataUrl);
                setStatus("Image API unavailable, copied PNG data URL");
                return true;
            }
        } catch (err) {
            console.error(err);
            setStatus("Copy to clipboard failed");
            return false;
        }

        setStatus("Clipboard copy is not supported here");
        return false;
    }

    function bindCanvasContextCopy() {
        if (!canvas || canvas.__composerContextCopyBound) return;
        const upper = canvas.upperCanvasEl;
        if (!upper) return;

        upper.addEventListener("contextmenu", (e) => {
            const root = document.getElementById("forge-composer-root");
            if (!root || !isElementVisible(root)) return;

            // Hold Shift to open browser native context menu when needed.
            if (e.shiftKey) return;

            e.preventDefault();
            e.stopPropagation();
            void copyCanvasCompositionToClipboard();
        });

        canvas.__composerContextCopyBound = true;
    }

    function hexToRgba(hexColor, alphaPercent) {
        const normalized = normalizeHexColor(hexColor) || "#ff0000";
        const r = parseInt(normalized.slice(1, 3), 16);
        const g = parseInt(normalized.slice(3, 5), 16);
        const b = parseInt(normalized.slice(5, 7), 16);
        const a = Math.max(0, Math.min(1, (Number(alphaPercent) || 0) / 100));
        return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
    }

    function updateDrawingControlsState() {
        const widthVal = document.getElementById("composer-draw-width-value");
        const opacityVal = document.getElementById("composer-draw-opacity-value");
        const softnessVal = document.getElementById("composer-draw-softness-value");
        const brushBtn = document.getElementById("composer-draw-brush-btn");
        const eraserBtn = document.getElementById("composer-draw-eraser-btn");
        const cleanMaskBtn = document.getElementById("composer-clean-mask-btn");

        if (widthVal) widthVal.textContent = String(drawWidth);
        if (opacityVal) opacityVal.textContent = String(drawOpacity);
        if (softnessVal) softnessVal.textContent = String(drawSoftness);

        const brushActive = drawingTool === "brush" && !!canvas?.isDrawingMode;
        const eraserActive = drawingTool === "eraser" && (!!canvas?.isDrawingMode || eraserFallbackActive);
        const cleanMaskActive = drawingTool === CLEAN_MASK_TYPE && !!canvas?.isDrawingMode;
        const cleanMaskCanRun = cleanMaskAvailable && (!!getCleanMaskTargetObject() || cleanMaskActive);
        if (brushBtn) brushBtn.classList.toggle("is-active", brushActive);
        if (eraserBtn) eraserBtn.classList.toggle("is-active", eraserActive);
        if (cleanMaskBtn) {
            cleanMaskBtn.classList.toggle("is-active", cleanMaskActive);
            cleanMaskBtn.disabled = !cleanMaskCanRun || cleanMaskInFlight;
            cleanMaskBtn.classList.toggle("is-disabled", !cleanMaskCanRun || cleanMaskInFlight);
        }
    }

    function setDrawWidth(nextWidth) {
        const widthInput = document.getElementById("composer-draw-width");
        const min = Math.max(1, Number(widthInput?.min) || 1);
        const max = Math.max(min, Number(widthInput?.max) || 200);
        const clamped = Math.max(min, Math.min(max, Math.round(Number(nextWidth) || drawWidth)));
        if (clamped === drawWidth) return false;

        drawWidth = clamped;
        if (widthInput) widthInput.value = String(drawWidth);
        updateDrawCursorSize();
        updateDrawingControlsState();
        if (canvas?.isDrawingMode || eraserFallbackActive) applyDrawingBrush();
        return true;
    }

    function adjustDrawWidthByWheel(deltaY) {
        const widthInput = document.getElementById("composer-draw-width");
        const rawStep = Number(widthInput?.step);
        const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : 1;
        const direction = deltaY < 0 ? 1 : -1;
        const wheelTicks = Math.max(1, Math.round(Math.abs(Number(deltaY) || 0) / 100));
        const speedMultiplier = 6;
        const deltaWidth = wheelTicks * step * speedMultiplier;
        const changed = setDrawWidth(drawWidth + direction * deltaWidth);
        if (changed) {
            setStatus(`Draw size: ${drawWidth}`);
        }
        return changed;
    }

    function updateDrawCursorSize() {
        if (!drawCursorEl) return;
        const zoom = canvas?.getZoom ? (canvas.getZoom() || 1) : 1;
        const base = Math.max(1, Number(drawWidth) || 1);
        // Fabric free-draw width is in scene units (scaled by zoom on screen),
        // but fallback eraser width is handled in screen pixels directly.
        const px = (eraserFallbackActive && drawingTool === "eraser")
            ? Math.max(4, base)
            : Math.max(4, base * zoom);
        drawCursorEl.style.width = `${px}px`;
        drawCursorEl.style.height = `${px}px`;
        drawCursorEl.style.marginLeft = `${-px / 2}px`;
        drawCursorEl.style.marginTop = `${-px / 2}px`;
    }

    function moveDrawCursorByClient(clientX, clientY) {
        const stageWrap = document.querySelector(".composer-stage-wrap");
        if (!drawCursorEl || !stageWrap) return;
        const rect = stageWrap.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        drawCursorEl.style.left = `${x}px`;
        drawCursorEl.style.top = `${y}px`;
        drawCursorEl.style.display = "block";
    }

    function hideDrawCursor() {
        if (!drawCursorEl) return;
        drawCursorEl.style.display = "none";
    }

    function setDrawCursorMode(tool) {
        if (!drawCursorEl) return;
        drawCursorEl.classList.toggle("is-eraser", tool === "eraser");
        drawCursorEl.classList.toggle("is-brush", tool === "brush");
        drawCursorEl.classList.toggle("is-clean-mask", tool === CLEAN_MASK_TYPE);
    }

    function applyDrawingBrush() {
        if (!canvas || !window.fabric) return false;

        if (!drawingTool) {
            stopEraserFallback();
            restoreEraserScope();
            canvas.isDrawingMode = false;
            canvas.selection = true;
            hideDrawCursor();
            updateDrawingControlsState();
            return true;
        }

        let brush = null;
        const width = Math.max(1, Number(drawWidth) || 1);

        if (drawingTool === "eraser") {
            if (!window.fabric.EraserBrush) {
                restoreEraserScope();
                if (!activateEraserFallback()) {
                    drawingTool = null;
                    canvas.isDrawingMode = false;
                    canvas.selection = true;
                    hideDrawCursor();
                    updateDrawingControlsState();
                    return false;
                }
                canvas.freeDrawingBrush = null;
                canvas.isDrawingMode = true;
                canvas.selection = false;
                setDrawCursorMode(drawingTool);
                updateDrawCursorSize();
                updateDrawingControlsState();
                return true;
            }

            stopEraserFallback();
            if (!prepareScopedEraser()) {
                disableDrawingMode(true);
                return false;
            }

            brush = new window.fabric.EraserBrush(canvas);
            brush.width = width;
        } else if (drawingTool === CLEAN_MASK_TYPE) {
            stopEraserFallback();
            restoreEraserScope();
            brush = new window.fabric.PencilBrush(canvas);
            brush.width = width;
            brush.color = "rgba(255, 48, 48, 0.46)";
            brush.globalCompositeOperation = "source-over";
            brush.shadow = null;
        } else {
            stopEraserFallback();
            restoreEraserScope();
            brush = new window.fabric.PencilBrush(canvas);
            brush.width = width;
            brush.color = hexToRgba(drawColor, drawOpacity);
            brush.globalCompositeOperation = "source-over";

            if (drawSoftness > 0 && window.fabric.Shadow) {
                brush.shadow = new window.fabric.Shadow({
                    color: brush.color,
                    blur: Number(drawSoftness) || 0,
                    offsetX: 0,
                    offsetY: 0
                });
            } else {
                brush.shadow = null;
            }
        }

        canvas.freeDrawingBrush = brush;
        canvas.isDrawingMode = true;
        canvas.selection = false;
        setDrawCursorMode(drawingTool);
        updateDrawCursorSize();
        updateDrawingControlsState();
        return true;
    }

    function getEraserTargets() {
        if (!canvas) return [];
        const active = canvas.getActiveObject();
        if (!active) return [];

        if (active.type === "activeSelection" && typeof active.forEachObject === "function") {
            const targets = [];
            active.forEachObject((obj) => targets.push(obj));
            return targets;
        }
        return [active];
    }

    function getScopedEraserTargets() {
        const direct = getEraserTargets();
        if (direct.length > 0) {
            lastEraserTargets = direct.slice();
            return direct;
        }

        if (!canvas || lastEraserTargets.length === 0) return [];
        const aliveSet = new Set(canvas.getObjects());
        const alive = lastEraserTargets.filter((obj) => aliveSet.has(obj));
        if (alive.length > 0) return alive;

        lastEraserTargets = [];
        return [];
    }

    function restoreEraserScope() {
        if (!canvas || eraserScopeSnapshot.length === 0) return;
        eraserScopeSnapshot.forEach((entry) => {
            if (!entry?.obj) return;
            entry.obj.erasable = entry.erasable;
        });
        eraserScopeSnapshot = [];
    }

    function stopEraserFallback() {
        eraserFallbackActive = false;
        eraserFallbackDrawing = false;
        eraserFallbackTarget = null;
        if (canvas) {
            canvas.skipTargetFind = false;
        }
    }

    function resetFabricDrawingState() {
        if (!canvas) return;

        // Hard reset of Fabric free-draw transient state when switching tools.
        canvas._isCurrentlyDrawing = false;
        canvas._groupSelector = null;
        if (typeof canvas.clearContext === "function" && canvas.contextTop) {
            canvas.clearContext(canvas.contextTop);
        }
    }

    function ensureImageBitmapState(target) {
        if (!target || target.type !== "image") return null;

        if (target.__composerBitmapCanvas) {
            return target.__composerBitmapCanvas;
        }

        const sourceEl = target._element;
        const w = sourceEl?.naturalWidth || sourceEl?.width || Math.round(target.width || 0);
        const h = sourceEl?.naturalHeight || sourceEl?.height || Math.round(target.height || 0);
        if (!w || !h) return null;

        const bmp = document.createElement("canvas");
        bmp.width = w;
        bmp.height = h;
        const ctx = bmp.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(sourceEl, 0, 0, w, h);

        target.__composerBitmapCanvas = bmp;
        target.__composerBitmapCtx = ctx;
        target.setElement(bmp);
        target.setCoords();
        return bmp;
    }

    function canRasterizeForFallbackEraser(obj) {
        if (!obj || obj.type === "image" || obj.type === "activeSelection") return false;
        if (isTextObject(obj)) return false;
        return typeof obj.toCanvasElement === "function";
    }

    function rasterizeObjectForFallbackEraser(obj) {
        if (!canvas || !obj || obj.type === "image") return obj;
        if (!canRasterizeForFallbackEraser(obj)) return null;

        let rendered = null;
        if (typeof obj.toCanvasElement === "function") {
            rendered = obj.toCanvasElement({
                multiplier: 1,
                withoutTransform: true
            });
        }
        if (!rendered) return null;

        const replacement = new window.fabric.Image(rendered, {
            left: obj.left,
            top: obj.top,
            originX: obj.originX,
            originY: obj.originY,
            scaleX: obj.scaleX,
            scaleY: obj.scaleY,
            angle: obj.angle,
            flipX: obj.flipX,
            flipY: obj.flipY,
            skewX: obj.skewX,
            skewY: obj.skewY,
            opacity: obj.opacity,
            selectable: obj.selectable,
            evented: obj.evented,
            hasControls: obj.hasControls,
            hasBorders: obj.hasBorders,
            lockMovementX: obj.lockMovementX,
            lockMovementY: obj.lockMovementY,
            lockRotation: obj.lockRotation,
            lockScalingX: obj.lockScalingX,
            lockScalingY: obj.lockScalingY,
            name: obj.name || "Rasterized",
            composerType: "rasterized"
        });

        const objects = canvas.getObjects();
        const index = objects.indexOf(obj);
        canvas.remove(obj);
        if (typeof canvas.insertAt === "function" && index >= 0) {
            canvas.insertAt(replacement, index);
        } else {
            canvas.add(replacement);
            if (index >= 0) canvas.moveTo(replacement, index);
        }

        replacement.setCoords();
        canvas.setActiveObject(replacement);
        canvas.requestRenderAll();
        return replacement;
    }

    function eraseOnFallbackTarget(pointer) {
        if (!canvas || !eraserFallbackTarget || !pointer) return;
        const target = eraserFallbackTarget;
        const bmp = ensureImageBitmapState(target);
        if (!bmp) return;
        const ctx = target.__composerBitmapCtx;
        if (!ctx) return;

        const fabricUtil = window.fabric?.util;
        if (!fabricUtil || typeof fabricUtil.invertTransform !== "function" || typeof fabricUtil.transformPoint !== "function") {
            return;
        }

        const scenePoint = new window.fabric.Point(pointer.x, pointer.y);
        const inv = fabricUtil.invertTransform(target.calcTransformMatrix());
        const local = fabricUtil.transformPoint(scenePoint, inv);
        const ow = Number(target.width) || bmp.width;
        const oh = Number(target.height) || bmp.height;
        if (!ow || !oh) return;

        // Fabric object local coords are centered for transform math.
        const u = (local.x + ow / 2) / ow;
        const v = (local.y + oh / 2) / oh;
        if (u < 0 || u > 1 || v < 0 || v > 1) return;

        const px = u * bmp.width;
        const py = v * bmp.height;

        const zoom = Math.max(0.0001, canvas.getZoom ? (canvas.getZoom() || 1) : 1);
        const sceneStep = 1 / zoom; // 1 screen pixel in scene units
        const localStepX = fabricUtil.transformPoint(new window.fabric.Point(pointer.x + sceneStep, pointer.y), inv);
        const localStepY = fabricUtil.transformPoint(new window.fabric.Point(pointer.x, pointer.y + sceneStep), inv);

        const localPerScreenX = Math.max(0.0001, Math.abs(localStepX.x - local.x));
        const localPerScreenY = Math.max(0.0001, Math.abs(localStepY.y - local.y));
        const halfBrush = Math.max(1, Number(drawWidth) || 1) / 2;

        const localRadiusX = halfBrush * localPerScreenX;
        const localRadiusY = halfBrush * localPerScreenY;
        const radiusPxX = Math.max(0.5, localRadiusX * (bmp.width / ow));
        const radiusPxY = Math.max(0.5, localRadiusY * (bmp.height / oh));

        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.ellipse(px, py, radiusPxX, radiusPxY, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.fill();
        ctx.restore();

        target.setElement(bmp);
        target.dirty = true;
        target.setCoords();
        canvas.requestRenderAll();
    }

    function bindEraserFallbackHandlers() {
        if (!canvas || canvas.__composerFallbackBound) return;

        const upper = canvas.upperCanvasEl;
        if (!upper) return;

        const onDown = (e) => {
            if (!eraserFallbackActive || drawingTool !== "eraser") return;
            if (middlePanActive) return;
            if (e.button !== 0) return; // Erase only on LMB.
            e.preventDefault();
            e.stopPropagation();
            moveDrawCursorByClient(e.clientX, e.clientY);
            eraserFallbackDrawing = true;
            const p = canvas.getPointer(e, false);
            eraseOnFallbackTarget(p);
        };

        const onMove = (e) => {
            if (!eraserFallbackActive || !eraserFallbackDrawing || drawingTool !== "eraser") return;
            if (middlePanActive) return;
            e.preventDefault();
            e.stopPropagation();
            moveDrawCursorByClient(e.clientX, e.clientY);
            const p = canvas.getPointer(e, false);
            eraseOnFallbackTarget(p);
        };

        const onUp = () => {
            const hadDrawing = eraserFallbackDrawing;
            eraserFallbackDrawing = false;
            if (hadDrawing) {
                flushHistoryCaptureNow();
            }
        };

        upper.addEventListener("mousedown", onDown);
        upper.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);

        canvas.__composerFallbackBound = true;
    }

    function activateEraserFallback() {
        if (!canvas) return false;
        const targets = getScopedEraserTargets();
        if (targets.length !== 1 || !targets[0]) {
            setStatus("Fallback eraser: select one object");
            return false;
        }

        let target = targets[0];
        if (target.type !== "image") {
            target = rasterizeObjectForFallbackEraser(target);
            if (!target || target.type !== "image") {
                setStatus("Fallback eraser: only image/shape/drawing is supported");
                return false;
            }
        }

        const bmp = ensureImageBitmapState(target);
        if (!bmp) {
            setStatus("Fallback eraser: image data unavailable");
            return false;
        }

        lastEraserTargets = [target];
        eraserFallbackTarget = target;
        eraserFallbackActive = true;
        eraserFallbackDrawing = false;
        canvas.skipTargetFind = true;
        canvas.isDrawingMode = false;
        canvas.selection = false;
        bindEraserFallbackHandlers();
        return true;
    }

    function prepareScopedEraser() {
        if (!canvas) return false;

        const targets = getScopedEraserTargets();
        if (targets.length === 0) {
            setStatus("Select object to erase");
            return false;
        }

        restoreEraserScope();

        const targetSet = new Set(targets);
        const all = canvas.getObjects();
        eraserScopeSnapshot = all.map((obj) => ({
            obj,
            erasable: obj.erasable
        }));

        all.forEach((obj) => {
            obj.erasable = targetSet.has(obj);
        });

        return true;
    }

    function disableDrawingMode(silent = false) {
        if (!drawingTool && !canvas?.isDrawingMode) return;
        drawingTool = null;
        cleanMaskTargetObject = null;
        lastEraserTargets = [];
        stopEraserFallback();
        restoreEraserScope();
        if (canvas) {
            canvas.freeDrawingBrush = null;
        }
        applyDrawingBrush();
        resetFabricDrawingState();
        if (!silent) setStatus("Draw mode off");
    }

    function setDrawingTool(tool) {
        if (!canvas) return;

        if (drawingTool === tool) {
            disableDrawingMode();
            return;
        }

        // Always fully stop previous mode first (especially fallback eraser),
        // then enable the next one to avoid phantom drawing on mouse move.
        disableDrawingMode(true);
        resetFabricDrawingState();

        drawingTool = tool;
        if (tool === CLEAN_MASK_TYPE) {
            const target = getCleanMaskTargetObject();
            if (!target) {
                drawingTool = null;
                setStatus("Select one image layer to clean");
                updateDrawingControlsState();
                return;
            }
            cleanMaskTargetObject = target;
        }
        const ok = applyDrawingBrush();
        if (!ok) return;
        if (tool === "eraser") {
            setStatus("Eraser mode on");
        } else if (tool === CLEAN_MASK_TYPE) {
            setStatus("Clean selected layer: paint object, then click the remove icon again");
        } else {
            setStatus("Brush mode on");
        }
    }

    function bindDrawingControls() {
        const overlay = document.getElementById("composer-draw-overlay");
        const brushBtn = document.getElementById("composer-draw-brush-btn");
        const eraserBtn = document.getElementById("composer-draw-eraser-btn");
        const cleanMaskBtn = document.getElementById("composer-clean-mask-btn");
        const colorInput = document.getElementById("composer-draw-color");
        const widthInput = document.getElementById("composer-draw-width");
        const opacityInput = document.getElementById("composer-draw-opacity");
        const softnessInput = document.getElementById("composer-draw-softness");

        if (!overlay || !brushBtn || !eraserBtn || !cleanMaskBtn || !colorInput || !widthInput || !opacityInput || !softnessInput) {
            return;
        }
        if (overlay.dataset.bound === "1") return;

        drawColor = normalizeHexColor(colorInput.value) || drawColor;
        currentTextColor = drawColor;
        drawWidth = Math.max(1, Number(widthInput.value) || drawWidth);
        drawOpacity = Math.max(1, Math.min(100, Number(opacityInput.value) || drawOpacity));
        drawSoftness = Math.max(0, Math.min(50, Number(softnessInput.value) || drawSoftness));
        colorInput.value = drawColor;
        widthInput.value = String(drawWidth);
        opacityInput.value = String(drawOpacity);
        softnessInput.value = String(drawSoftness);
        updateDrawingControlsState();

        overlay.addEventListener("mousedown", (e) => e.stopPropagation());
        overlay.addEventListener("click", (e) => e.stopPropagation());

        brushBtn.addEventListener("click", () => setDrawingTool("brush"));
        eraserBtn.addEventListener("click", () => setDrawingTool("eraser"));
        cleanMaskBtn.addEventListener("click", () => {
            if (!cleanMaskAvailable) {
                setStatus("LaMa Cleaner extension not found");
                return;
            }
            if (drawingTool === CLEAN_MASK_TYPE) {
                cleanSelectedLayerByMask();
                return;
            }
            if (!getCleanMaskTargetObject()) {
                setStatus("Select one image layer to clean");
                return;
            }
            setDrawingTool(CLEAN_MASK_TYPE);
        });

        colorInput.addEventListener("input", () => {
            const normalized = normalizeHexColor(colorInput.value);
            if (!normalized) return;
            setTextColor(normalized);
            if (drawingTool === "brush" && canvas?.isDrawingMode) {
                applyDrawingBrush();
            }
        });

        widthInput.addEventListener("input", () => {
            setDrawWidth(Number(widthInput.value));
        });

        opacityInput.addEventListener("input", () => {
            drawOpacity = Math.max(1, Math.min(100, Number(opacityInput.value) || drawOpacity));
            updateDrawingControlsState();
            if (drawingTool === "brush" && canvas?.isDrawingMode) applyDrawingBrush();
        });

        softnessInput.addEventListener("input", () => {
            drawSoftness = Math.max(0, Math.min(50, Number(softnessInput.value) || drawSoftness));
            updateDrawingControlsState();
            if (canvas?.isDrawingMode) applyDrawingBrush();
        });

        overlay.dataset.bound = "1";
    }

    function bindDrawingCursorPreview() {
        const stageWrap = document.querySelector(".composer-stage-wrap");
        if (!stageWrap || stageWrap.dataset.drawCursorBound === "1") return;

        drawCursorEl = document.createElement("div");
        drawCursorEl.className = "composer-draw-cursor is-brush";
        drawCursorEl.style.display = "none";
        stageWrap.appendChild(drawCursorEl);
        updateDrawCursorSize();

        stageWrap.addEventListener("mousemove", (e) => {
            const drawLikeMode = !!drawingTool && !!drawCursorEl && (canvas?.isDrawingMode || eraserFallbackActive);
            if (!drawLikeMode) {
                hideDrawCursor();
                return;
            }
            moveDrawCursorByClient(e.clientX, e.clientY);
        });

        stageWrap.addEventListener("mouseleave", hideDrawCursor);
        stageWrap.addEventListener("mousedown", hideDrawCursor);
        stageWrap.addEventListener("mouseup", () => {
            if (drawingTool && (canvas?.isDrawingMode || eraserFallbackActive) && drawCursorEl) {
                drawCursorEl.style.display = "block";
            }
        });

        stageWrap.dataset.drawCursorBound = "1";
    }

    function isImageObject(obj) {
        return !!obj && (obj.type === "image" || obj.type === "warpImage");
    }

    function getImageDataUrlFromObject(obj) {
        if (!obj) return null;

        try {
            if (typeof obj.getSrc === "function") {
                const src = obj.getSrc();
                if (typeof src === "string" && src.startsWith("data:image")) {
                    return src;
                }
            }
        } catch (err) {
            console.warn("[Composer] getSrc failed", err);
        }

        const elSrc = obj._element?.src;
        if (typeof elSrc === "string" && elSrc.startsWith("data:image")) {
            return elSrc;
        }

        try {
            if (typeof obj.toDataURL === "function") {
                return obj.toDataURL({ format: "png", multiplier: 1 });
            }
        } catch (err) {
            console.warn("[Composer] object toDataURL failed", err);
        }

        return null;
    }

    function loadFabricImageFromDataUrl(dataUrl) {
        return new Promise((resolve, reject) => {
            if (!window.fabric?.Image?.fromURL) {
                reject(new Error("Fabric image loader is unavailable"));
                return;
            }

            window.fabric.Image.fromURL(dataUrl, (img) => {
                if (!img) {
                    reject(new Error("Failed to create image object"));
                    return;
                }
                resolve(img);
            });
        });
    }

    function getCleanMaskObjects() {
        if (!canvas) return [];
        return canvas.getObjects().filter((obj) => obj?.composerType === CLEAN_MASK_TYPE);
    }

    function getCleanMaskTargetObject() {
        if (!canvas) return null;
        if (
            cleanMaskTargetObject
            && canvas.getObjects().includes(cleanMaskTargetObject)
            && isImageObject(cleanMaskTargetObject)
        ) {
            return cleanMaskTargetObject;
        }

        const active = canvas.getActiveObject();
        if (!active || active.type === "activeSelection") return null;
        if (!isImageObject(active)) return null;
        return active;
    }

    function getCleanMaskPathObjects() {
        return getCleanMaskObjects().filter((obj) => !obj.__composerCleanMaskPreview && obj.type === "path");
    }

    function withCleanMasksHidden(callback) {
        const masks = getCleanMaskObjects();
        const previous = masks.map((obj) => ({ obj, visible: obj.visible }));
        masks.forEach((obj) => {
            obj.visible = false;
        });
        try {
            return callback();
        } finally {
            previous.forEach(({ obj, visible }) => {
                obj.visible = visible;
            });
            canvas?.requestRenderAll();
        }
    }

    function clearCleanMaskObjects() {
        if (!canvas) return;
        getCleanMaskObjects().forEach((obj) => canvas.remove(obj));
        cleanMaskPreviewObject = null;
        canvas.requestRenderAll();
        syncLayersPanel();
    }

    function getPathCommandPoint(command) {
        if (!Array.isArray(command) || command.length < 3) return null;
        const x = Number(command[command.length - 2]);
        const y = Number(command[command.length - 1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
    }

    function getPathPoints(path) {
        const commands = Array.isArray(path?.path) ? path.path : [];
        const points = [];
        commands.forEach((command) => {
            const point = getPathCommandPoint(command);
            if (point) points.push(point);
        });
        return points;
    }

    function getPolygonArea(points) {
        if (!Array.isArray(points) || points.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < points.length; i += 1) {
            const current = points[i];
            const next = points[(i + 1) % points.length];
            area += (current.x * next.y) - (next.x * current.y);
        }
        return Math.abs(area) / 2;
    }

    function isCleanMaskPathClosed(path) {
        const points = getPathPoints(path);
        if (points.length < 4) return false;

        const first = points[0];
        const last = points[points.length - 1];
        const closeDistance = Math.hypot(last.x - first.x, last.y - first.y);
        const strokeWidth = Math.max(1, Number(path?.strokeWidth) || Number(drawWidth) || 1);
        const closeThreshold = Math.max(10, strokeWidth * 1.25);
        if (closeDistance > closeThreshold) return false;

        return getPolygonArea(points) > Math.max(32, strokeWidth * strokeWidth);
    }

    function markCleanMaskPath(path) {
        if (!path || drawingTool !== CLEAN_MASK_TYPE) return;
        const closed = isCleanMaskPathClosed(path);
        path.set({
            name: "Clean mask",
            composerType: CLEAN_MASK_TYPE,
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
            visible: false,
            excludeFromExport: false,
            fill: closed ? CLEAN_MASK_CLOSED_FILL : null,
            __composerCleanMaskClosedFill: closed,
            objectCaching: false
        });
        updateCleanMaskPreview();
        syncLayersPanel();
    }

    function cloneCleanMaskObject(obj) {
        return new Promise((resolve, reject) => {
            if (!obj || typeof obj.clone !== "function") {
                reject(new Error("Mask object cannot be cloned"));
                return;
            }
            obj.clone((clone) => {
                if (!clone) {
                    reject(new Error("Mask clone failed"));
                    return;
                }
                clone.set({
                    stroke: "#ffffff",
                    fill: obj.__composerCleanMaskClosedFill || obj.fill ? "#ffffff" : null,
                    opacity: 1,
                    visible: true,
                    shadow: null,
                    selectable: false,
                    evented: false,
                    globalCompositeOperation: "source-over",
                    objectCaching: false,
                    noScaleCache: true,
                    dirty: true
                });
                resolve(clone);
            });
        });
    }

    async function renderCleanMaskDataUrl() {
        if (!canvas || !window.fabric) {
            setStatus("Canvas not ready");
            return null;
        }

        const masks = getCleanMaskPathObjects();
        if (masks.length === 0) {
            setStatus("Paint a clean mask first");
            return null;
        }

        const maskCanvasEl = document.createElement("canvas");
        maskCanvasEl.width = sceneWidth;
        maskCanvasEl.height = sceneHeight;
        const maskCanvas = new window.fabric.StaticCanvas(maskCanvasEl, {
            width: sceneWidth,
            height: sceneHeight,
            backgroundColor: "#000000"
        });

        try {
            const clones = await Promise.all(masks.map(cloneCleanMaskObject));
            clones.forEach((clone) => maskCanvas.add(clone));
            maskCanvas.renderAll();
            return maskCanvas.toDataURL({ format: "png", multiplier: 1 });
        } catch (err) {
            console.error(err);
            setStatus(`Mask export failed: ${err?.message || err}`);
            return null;
        } finally {
            maskCanvas.dispose();
        }
    }

    function tintMaskDataUrl(maskDataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                const scratch = document.createElement("canvas");
                scratch.width = w;
                scratch.height = h;
                const ctx = scratch.getContext("2d");
                if (!ctx) {
                    reject(new Error("Preview canvas unavailable"));
                    return;
                }
                ctx.drawImage(img, 0, 0);
                const pixels = ctx.getImageData(0, 0, w, h);
                for (let i = 0; i < pixels.data.length; i += 4) {
                    const mask = pixels.data[i];
                    pixels.data[i] = 255;
                    pixels.data[i + 1] = 48;
                    pixels.data[i + 2] = 48;
                    pixels.data[i + 3] = Math.round(mask * 0.46);
                }
                ctx.putImageData(pixels, 0, 0);
                resolve(scratch.toDataURL("image/png"));
            };
            img.onerror = () => reject(new Error("Mask preview decode failed"));
            img.src = maskDataUrl;
        });
    }

    async function updateCleanMaskPreview() {
        if (!canvas) return;
        const revision = ++cleanMaskPreviewRevision;
        const target = getCleanMaskTargetObject();
        const maskDataUrl = target
            ? await exportCleanMaskForTargetToDataUrl(target)
            : await renderCleanMaskDataUrl();
        if (revision !== cleanMaskPreviewRevision) return;
        if (!maskDataUrl) return;

        try {
            const previewDataUrl = await tintMaskDataUrl(maskDataUrl);
            if (revision !== cleanMaskPreviewRevision) return;
            let preview = await loadFabricImageFromDataUrl(previewDataUrl);
            if (revision !== cleanMaskPreviewRevision) return;
            if (target?.warpCorners && window.fabric?.WarpImage && preview?._element) {
                preview = new window.fabric.WarpImage(preview._element, {
                    warpCorners: cloneWarpCorners(target.warpCorners)
                });
            }
            preview.set({
                left: target ? target.left : 0,
                top: target ? target.top : 0,
                scaleX: target ? target.scaleX : 1,
                scaleY: target ? target.scaleY : 1,
                angle: target ? target.angle : 0,
                flipX: target ? target.flipX : false,
                flipY: target ? target.flipY : false,
                skewX: target ? target.skewX : 0,
                skewY: target ? target.skewY : 0,
                originX: target ? target.originX : "left",
                originY: target ? target.originY : "top",
                name: "Clean mask preview",
                composerType: CLEAN_MASK_TYPE,
                selectable: false,
                evented: false,
                hasControls: false,
                hasBorders: false,
                objectCaching: false
            });
            preview.__composerCleanMaskPreview = true;

            if (cleanMaskPreviewObject && canvas.getObjects().includes(cleanMaskPreviewObject)) {
                canvas.remove(cleanMaskPreviewObject);
            }
            cleanMaskPreviewObject = preview;
            canvas.add(preview);
            if (typeof preview.bringToFront === "function") {
                preview.bringToFront();
            }
            canvas.requestRenderAll();
            syncLayersPanel();
        } catch (err) {
            console.warn("[Composer] clean mask preview failed", err);
        }
    }

    async function exportCleanMaskToDataUrl() {
        return renderCleanMaskDataUrl();
    }

    async function exportCleanMaskForTargetToDataUrl(target) {
        if (!target || !window.fabric?.util) {
            setStatus("Select one image layer to clean");
            return null;
        }

        const w = Math.max(1, Math.round(Number(target.width) || target._element?.naturalWidth || 0));
        const h = Math.max(1, Math.round(Number(target.height) || target._element?.naturalHeight || 0));
        if (!w || !h) {
            setStatus("Selected layer has invalid size");
            return null;
        }

        const matrix = target.calcTransformMatrix();
        const inverse = window.fabric.util.invertTransform(matrix);
        const scratch = document.createElement("canvas");
        scratch.width = w;
        scratch.height = h;
        const maskCanvas = new window.fabric.StaticCanvas(scratch, {
            width: w,
            height: h,
            backgroundColor: "#000000"
        });

        try {
            maskCanvas.viewportTransform = [
                inverse[0],
                inverse[1],
                inverse[2],
                inverse[3],
                inverse[4] + w / 2,
                inverse[5] + h / 2
            ];

            const masks = getCleanMaskPathObjects();
            if (masks.length === 0) {
                setStatus("Paint a clean mask first");
                return null;
            }
            const clones = await Promise.all(masks.map(cloneCleanMaskObject));
            clones.forEach((clone) => maskCanvas.add(clone));
            maskCanvas.renderAll();

            const ctx = scratch.getContext("2d");
            if (!ctx) {
                setStatus("Mask canvas unavailable");
                return null;
            }

            const pixels = ctx.getImageData(0, 0, w, h);
            let hasMask = false;
            for (let i = 0; i < pixels.data.length; i += 4) {
                const mask = pixels.data[i];
                const value = mask > 2 ? 255 : 0;
                if (value) hasMask = true;
                pixels.data[i] = value;
                pixels.data[i + 1] = value;
                pixels.data[i + 2] = value;
                pixels.data[i + 3] = 255;
            }
            ctx.putImageData(pixels, 0, 0);

            if (!hasMask) {
                setStatus("Mask does not overlap selected layer");
                return null;
            }

            return scratch.toDataURL("image/png");
        } finally {
            maskCanvas.dispose();
        }
    }

    async function replaceImageLayerWithDataUrl(target, dataUrl) {
        const nextImage = await loadFabricImageFromDataUrl(dataUrl);
        const activeWarpCorners = target.warpCorners ? cloneWarpCorners(target.warpCorners) : null;
        const activeWasWarpEditing = target === warpEditObject && target.__composerWarpEditing;
        const prevInteraction = target.__composerWarpPrevInteraction || null;
        let replacement = nextImage;
        if (activeWarpCorners && window.fabric?.WarpImage && nextImage?._element) {
            replacement = new window.fabric.WarpImage(nextImage._element, {
                warpCorners: activeWarpCorners
            });
        }

        const objects = canvas.getObjects();
        const prevIndex = objects.indexOf(target);
        const sourceW = target.width || target._element?.naturalWidth || replacement.width || 1;
        const sourceH = target.height || target._element?.naturalHeight || replacement.height || 1;

        replacement.set({
            left: target.left,
            top: target.top,
            scaleX: target.scaleX,
            scaleY: target.scaleY,
            angle: target.angle,
            flipX: target.flipX,
            flipY: target.flipY,
            skewX: target.skewX,
            skewY: target.skewY,
            originX: target.originX,
            originY: target.originY,
            opacity: target.opacity,
            selectable: target.selectable,
            evented: target.evented,
            hasControls: activeWasWarpEditing ? (prevInteraction?.hasControls ?? true) : target.hasControls,
            hasBorders: activeWasWarpEditing ? (prevInteraction?.hasBorders ?? true) : target.hasBorders,
            lockMovementX: activeWasWarpEditing ? (prevInteraction?.lockMovementX ?? false) : target.lockMovementX,
            lockMovementY: activeWasWarpEditing ? (prevInteraction?.lockMovementY ?? false) : target.lockMovementY,
            lockRotation: target.lockRotation,
            lockScalingX: target.lockScalingX,
            lockScalingY: target.lockScalingY,
            hoverCursor: activeWasWarpEditing ? (prevInteraction?.hoverCursor ?? null) : target.hoverCursor,
            moveCursor: activeWasWarpEditing ? (prevInteraction?.moveCursor ?? null) : target.moveCursor,
            name: target.name || "Cleaned layer",
            composerType: target.composerType || "object",
            warpCorners: activeWarpCorners || undefined,
            cornerStyle: "circle",
            transparentCorners: false,
            padding: 4,
            objectCaching: false
        });

        if (replacement.width && replacement.height && sourceW && sourceH) {
            replacement.set({
                scaleX: target.scaleX * (sourceW / replacement.width),
                scaleY: target.scaleY * (sourceH / replacement.height)
            });
        }

        canvas.remove(target);
        if (target === warpEditObject) {
            warpEditObject = null;
            warpDragCorner = null;
            clearWarpOverlay();
        }
        if (target === backgroundObject) {
            backgroundObject = null;
        }
        canvas.add(replacement);
        if (prevIndex >= 0) {
            canvas.moveTo(replacement, prevIndex);
        }
        if (target === backgroundObject || replacement.composerType === "background") {
            backgroundObject = replacement;
        }
        replacement.setCoords();
        canvas.setActiveObject(replacement);
        if (activeWasWarpEditing && activeWarpCorners && replacement.type === "warpImage") {
            setWarpControls(replacement);
            warpEditObject = replacement;
            syncWarpButtonState();
        } else {
            clearWarpControls(replacement);
            syncWarpButtonState();
        }
        replacement.dirty = true;
        canvas.requestRenderAll();
        syncLayersPanel();
        return replacement;
    }

    async function replaceSceneWithCleanedCanvas(dataUrl) {
        const nextImage = await loadFabricImageFromDataUrl(dataUrl);
        const realW = nextImage.width || nextImage._element?.naturalWidth || sceneWidth;
        const realH = nextImage.height || nextImage._element?.naturalHeight || sceneHeight;

        canvas.getObjects().slice().forEach((obj) => canvas.remove(obj));
        backgroundObject = nextImage;
        nextImage.set({
            left: 0,
            top: 0,
            scaleX: sceneWidth / Math.max(1, realW),
            scaleY: sceneHeight / Math.max(1, realH),
            angle: 0,
            originX: "left",
            originY: "top",
            name: "Cleaned canvas",
            composerType: "background",
            selectable: true,
            evented: true,
            cornerStyle: "circle",
            transparentCorners: false,
            padding: 4,
            objectCaching: false
        });
        canvas.add(nextImage);
        canvas.setActiveObject(nextImage);
        nextImage.setCoords();
        canvas.requestRenderAll();
        syncLayersPanel();
    }

    async function refreshCleanMaskAvailability() {
        try {
            const response = await fetch("/forge-composer/clean-mask/status");
            const payload = await response.json();
            cleanMaskAvailable = !!(response.ok && payload?.ok && payload?.available);
            const btn = document.getElementById("composer-clean-mask-btn");
            if (btn) {
                btn.title = cleanMaskAvailable
                    ? "Select an image layer, paint mask, then click again to clean that layer"
                    : (payload?.error || "LaMa Cleaner extension not found");
            }
        } catch (err) {
            cleanMaskAvailable = false;
            console.warn("[Composer] clean mask status failed", err);
        } finally {
            updateDrawingControlsState();
        }
    }

    async function cleanSelectedLayerByMask() {
        if (!canvas) {
            setStatus("Canvas not ready");
            return;
        }
        if (!cleanMaskAvailable) {
            setStatus("LaMa Cleaner extension not found");
            return;
        }
        if (cleanMaskInFlight) {
            setStatus("Clean mask is already running");
            return;
        }

        const target = getCleanMaskTargetObject();
        if (!target) {
            setStatus("Select one image layer to clean");
            return;
        }
        if (target.type === "activeSelection" || !isImageObject(target)) {
            setStatus("Clean mask works only on one image layer");
            return;
        }

        const imageDataUrl = getImageDataUrlFromObject(target);
        if (!imageDataUrl) {
            setStatus("Could not read selected layer image");
            return;
        }

        const maskDataUrl = await exportCleanMaskForTargetToDataUrl(target);
        if (!maskDataUrl) return;

        cleanMaskInFlight = true;
        updateDrawingControlsState();
        setStatus("Cleaning selected layer with LaMa Cleaner...");

        try {
            flushHistoryCaptureNow();
            const response = await fetch("/forge-composer/clean-mask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    image: imageDataUrl,
                    mask: maskDataUrl,
                    blur: 2,
                    padding: 90
                })
            });

            const payload = await response.json();
            if (!response.ok || !payload?.ok || !payload?.image) {
                const errText = payload?.error || `HTTP ${response.status}`;
                throw new Error(errText);
            }

            disableDrawingMode(true);
            clearCleanMaskObjects();
            await replaceImageLayerWithDataUrl(target, payload.image);
            scheduleHistoryCapture();
            setStatus("Selected layer cleaned");
        } catch (err) {
            console.error(err);
            setStatus(`Clean mask failed: ${err?.message || "Unknown error"}`);
        } finally {
            cleanMaskInFlight = false;
            updateDrawingControlsState();
        }
    }

    async function removeBackgroundFromActiveImage() {
        if (!canvas) {
            setStatus("Canvas not ready");
            return;
        }

        if (removeBgInFlight) {
            setStatus("Remove BG is already running");
            return;
        }

        const active = canvas.getActiveObject();
        if (!active) {
            setStatus("Select an image first");
            return;
        }

        if (active.type === "activeSelection") {
            setStatus("Select one image object");
            return;
        }

        if (!isImageObject(active)) {
            setStatus("Remove BG works only for images");
            return;
        }

        const imageDataUrl = getImageDataUrlFromObject(active);
        if (!imageDataUrl) {
            setStatus("Could not read image data");
            return;
        }

        removeBgInFlight = true;
        setStatus("Removing background...");

        try {
            const response = await fetch("/forge-composer/remove-bg", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image: imageDataUrl })
            });

            const payload = await response.json();
            if (!response.ok || !payload?.ok || !payload?.image) {
                const errText = payload?.error || `HTTP ${response.status}`;
                throw new Error(errText);
            }

            const activeWarpCorners = active.warpCorners ? cloneWarpCorners(active.warpCorners) : null;
            const activeWasWarpEditing = active === warpEditObject && active.__composerWarpEditing;
            const prevInteraction = active.__composerWarpPrevInteraction || null;
            let nextImage = await loadFabricImageFromDataUrl(payload.image);
            if (activeWarpCorners && window.fabric?.WarpImage && nextImage?._element) {
                nextImage = new window.fabric.WarpImage(nextImage._element, {
                    warpCorners: activeWarpCorners
                });
            }
            const objects = canvas.getObjects();
            const prevIndex = objects.indexOf(active);

            nextImage.set({
                left: active.left,
                top: active.top,
                scaleX: active.scaleX,
                scaleY: active.scaleY,
                angle: active.angle,
                flipX: active.flipX,
                flipY: active.flipY,
                skewX: active.skewX,
                skewY: active.skewY,
                originX: active.originX,
                originY: active.originY,
                opacity: active.opacity,
                selectable: active.selectable,
                evented: active.evented,
                hasControls: activeWasWarpEditing ? (prevInteraction?.hasControls ?? true) : active.hasControls,
                hasBorders: activeWasWarpEditing ? (prevInteraction?.hasBorders ?? true) : active.hasBorders,
                lockMovementX: activeWasWarpEditing ? (prevInteraction?.lockMovementX ?? false) : active.lockMovementX,
                lockMovementY: activeWasWarpEditing ? (prevInteraction?.lockMovementY ?? false) : active.lockMovementY,
                lockRotation: active.lockRotation,
                lockScalingX: active.lockScalingX,
                lockScalingY: active.lockScalingY,
                hoverCursor: activeWasWarpEditing ? (prevInteraction?.hoverCursor ?? null) : active.hoverCursor,
                moveCursor: activeWasWarpEditing ? (prevInteraction?.moveCursor ?? null) : active.moveCursor,
                name: active.name || "Image",
                composerType: active.composerType || "object",
                warpCorners: activeWarpCorners || undefined,
                cornerStyle: "circle",
                transparentCorners: false,
                padding: 4,
                objectCaching: false
            });

            canvas.remove(active);
            if (active === warpEditObject) {
                warpEditObject = null;
                warpDragCorner = null;
                clearWarpOverlay();
            }
            if (active === backgroundObject) {
                backgroundObject = null;
            }

            canvas.add(nextImage);
            if (prevIndex >= 0) {
                canvas.moveTo(nextImage, prevIndex);
            }
            nextImage.setCoords();
            canvas.setActiveObject(nextImage);
            if (activeWasWarpEditing && activeWarpCorners && nextImage.type === "warpImage") {
                setWarpControls(nextImage);
                warpEditObject = nextImage;
                syncWarpButtonState();
            } else {
                clearWarpControls(nextImage);
                syncWarpButtonState();
            }
            nextImage.dirty = true;
            canvas.requestRenderAll();
            setStatus("Background removed");
        } catch (err) {
            console.error(err);
            const msg = err?.message || "Unknown error";
            setStatus(`Remove BG failed: ${msg}`);
        } finally {
            removeBgInFlight = false;
        }
    }

    function readFiles(files, asBackground = false) {
        Array.from(files).forEach((file, idx) => {
            if (!file) return;
            const fileName = (file.name && String(file.name).trim())
                ? file.name
                : `Clipboard image ${idx + 1}`;

            const reader = new FileReader();

            reader.onload = (e) => {
                const result = e.target?.result;
                if (!result) {
                    setStatus(`Empty file result: ${fileName}`);
                    return;
                }
                addImageToCanvas(result, asBackground, fileName);
            };

            reader.onerror = () => {
                setStatus(`Read error: ${fileName}`);
            };

            reader.readAsDataURL(file);
        });
    }

    function addExternalImageToCanvas(dataUrl, name = "Generated image") {
        if (!dataUrl || typeof dataUrl !== "string") {
            return false;
        }

        if (!canvas || !window.fabric) {
            pendingExternalImages.push({ dataUrl, name });
            initComposer();
            return true;
        }

        disableDrawingMode(true);
        addImageToCanvas(dataUrl, false, name);
        return true;
    }

    function flushPendingExternalImages() {
        if (!canvas || !window.fabric || pendingExternalImages.length === 0) return;
        const images = pendingExternalImages.splice(0);
        images.forEach(({ dataUrl, name }) => addExternalImageToCanvas(dataUrl, name));
    }

    function imageUrlToDataUrl(url) {
        if (!url) return Promise.reject(new Error("Image URL is empty"));
        if (url.startsWith("data:image")) return Promise.resolve(url);

        return fetch(url)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Image fetch failed: ${response.status}`);
                }
                return response.blob();
            })
            .then((blob) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error("Image read failed"));
                reader.readAsDataURL(blob);
            }));
    }

    function getGalleryImageCandidates(tabName) {
        const gallery = document.getElementById(`${tabName}_gallery`);
        if (!gallery) return [];

        const selectors = [
            ".selected img",
            "[aria-selected='true'] img",
            ".thumbnail-item.selected img",
            ".thumbnail-item[aria-selected='true'] img",
            "button[aria-selected='true'] img",
            "img"
        ];

        const seen = new Set();
        const images = [];
        selectors.forEach((selector) => {
            gallery.querySelectorAll(selector).forEach((img) => {
                const src = img.currentSrc || img.src || "";
                if (!src || seen.has(src)) return;
                seen.add(src);
                images.push(img);
            });
        });
        return images;
    }

    async function sendSelectedGalleryImageToComposer(tabName) {
        try {
            const images = getGalleryImageCandidates(tabName);
            const img = images[0] || null;
            const src = img?.currentSrc || img?.src || "";
            if (!src) {
                console.warn("[Composer] Gallery image not found");
                return [`<b>No ${tabName} image found</b>`];
            }

            const dataUrl = await imageUrlToDataUrl(src);
            const name = `${tabName}_generated.png`;
            const composerTab = findTabButton(/\bcomposer\b/i);
            if (composerTab) {
                composerTab.click();
                await new Promise((r) => setTimeout(r, 250));
            }

            const ok = window.forgeComposerNeo?.addImageFromDataUrl?.(dataUrl, name);
            if (!ok) {
                console.warn("[Composer] Composer bridge is not ready");
                return ["<b>Composer is not ready</b>"];
            }
            return [`<b>Sent to Composer</b>`];
        } catch (err) {
            console.error(err);
            return [`<b>Send to Composer failed: ${err?.message || err}</b>`];
        }
    }

    function placeComposerGalleryButton(tabName) {
        const button = document.getElementById(`${tabName}_send_to_composer`);
        const extrasButton = document.getElementById(`${tabName}_send_to_extras`);
        if (!button || !extrasButton || !extrasButton.parentElement) return;
        if (extrasButton.nextElementSibling !== button) {
            extrasButton.after(button);
        }
    }

    function placeComposerGalleryButtons() {
        placeComposerGalleryButton("txt2img");
        placeComposerGalleryButton("img2img");
    }

    function exportCanvasToDataUrl() {
        if (!canvas) {
            setStatus("Canvas not ready for export");
            return null;
        }

        const prevActive = canvas.getActiveObject() || null;
        const prevSelectionItems = (
            prevActive
            && prevActive.type === "activeSelection"
            && typeof prevActive.getObjects === "function"
        )
            ? prevActive.getObjects().slice()
            : null;
        const prevViewportTransform = Array.isArray(canvas.viewportTransform)
            ? canvas.viewportTransform.slice()
            : [1, 0, 0, 1, 0, 0];
        const prevWidth = canvas.getWidth();
        const prevHeight = canvas.getHeight();
        const canvasEl = document.getElementById("forge-composer-canvas");
        const prevCanvasElWidth = canvasEl?.style.width || "";
        const prevCanvasElHeight = canvasEl?.style.height || "";
        const wrapper = canvas.wrapperEl || null;
        const prevWrapperWidth = wrapper?.style.width || "";
        const prevWrapperHeight = wrapper?.style.height || "";
        const prevWrapperMargin = wrapper?.style.margin || "";
        let internalVisibility = [];

        try {
            mosaicOverlapPreviewSuspended = true;
            clearMosaicOverlapPreview();
            internalVisibility = canvas.getObjects().filter(isInternalComposerObject).map((obj) => ({
                obj,
                visible: obj.visible
            }));
            internalVisibility.forEach(({ obj }) => {
                obj.visible = false;
            });
            if (prevActive) {
                canvas.discardActiveObject();
            }

            // Export the current viewport framing (pan/zoom) at full output resolution.
            // Scale current viewport transform from preview pixels to scene pixels.
            const sx = prevWidth > 0 ? sceneWidth / prevWidth : 1;
            const sy = prevHeight > 0 ? sceneHeight / prevHeight : 1;
            const exportViewportTransform = [
                (prevViewportTransform[0] || 0) * sx,
                (prevViewportTransform[1] || 0) * sy,
                (prevViewportTransform[2] || 0) * sx,
                (prevViewportTransform[3] || 0) * sy,
                (prevViewportTransform[4] || 0) * sx,
                (prevViewportTransform[5] || 0) * sy
            ];

            canvas.setViewportTransform(exportViewportTransform);
            canvas.setWidth(sceneWidth);
            canvas.setHeight(sceneHeight);
            if (canvasEl) {
                canvasEl.style.width = `${sceneWidth}px`;
                canvasEl.style.height = `${sceneHeight}px`;
            }
            if (wrapper) {
                wrapper.style.width = `${sceneWidth}px`;
                wrapper.style.height = `${sceneHeight}px`;
                wrapper.style.margin = "0";
            }

            canvas.renderAll();
            const src = canvas.lowerCanvasEl;
            if (!src) {
                setStatus("Export source canvas not ready");
                return null;
            }
            return src.toDataURL("image/png");
        } catch (err) {
            console.error(err);
            setStatus("Export failed");
            return null;
        } finally {
            canvas.setWidth(prevWidth);
            canvas.setHeight(prevHeight);
            canvas.setViewportTransform(prevViewportTransform);
            if (canvasEl) {
                canvasEl.style.width = prevCanvasElWidth;
                canvasEl.style.height = prevCanvasElHeight;
            }
            if (wrapper) {
                wrapper.style.width = prevWrapperWidth;
                wrapper.style.height = prevWrapperHeight;
                wrapper.style.margin = prevWrapperMargin;
            }
            internalVisibility.forEach(({ obj, visible }) => {
                obj.visible = visible;
            });

            if (prevSelectionItems && prevSelectionItems.length > 0 && window.fabric?.ActiveSelection) {
                try {
                    const restoredSelection = new window.fabric.ActiveSelection(prevSelectionItems, { canvas });
                    canvas.setActiveObject(restoredSelection);
                } catch (restoreErr) {
                    console.error(restoreErr);
                }
            } else if (prevActive) {
                try {
                    canvas.setActiveObject(prevActive);
                } catch (restoreErr) {
                    console.error(restoreErr);
                }
            }
            mosaicOverlapPreviewSuspended = false;
            syncMosaicOverlapPreview();
            canvas.requestRenderAll();
        }
    }

    function sanitizeDownloadName(value, fallback) {
        const base = String(value || fallback || "composer_layer")
            .trim()
            .replace(/[\\/:*?"<>|]+/g, "_")
            .replace(/\s+/g, "_")
            .replace(/^_+|_+$/g, "");
        return base || fallback || "composer_layer";
    }

    function trimTransparentDataUrl(dataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const width = img.naturalWidth || img.width;
                const height = img.naturalHeight || img.height;
                if (!width || !height) {
                    resolve(dataUrl);
                    return;
                }

                const scratch = document.createElement("canvas");
                scratch.width = width;
                scratch.height = height;
                const ctx = scratch.getContext("2d");
                if (!ctx) {
                    resolve(dataUrl);
                    return;
                }

                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0);

                let pixels;
                try {
                    pixels = ctx.getImageData(0, 0, width, height).data;
                } catch (err) {
                    console.warn("[Composer] transparent trim failed", err);
                    resolve(dataUrl);
                    return;
                }

                let minX = width;
                let minY = height;
                let maxX = -1;
                let maxY = -1;

                for (let y = 0; y < height; y += 1) {
                    for (let x = 0; x < width; x += 1) {
                        const alpha = pixels[((y * width + x) * 4) + 3];
                        if (alpha === 0) continue;
                        if (x < minX) minX = x;
                        if (y < minY) minY = y;
                        if (x > maxX) maxX = x;
                        if (y > maxY) maxY = y;
                    }
                }

                if (maxX < minX || maxY < minY) {
                    resolve(dataUrl);
                    return;
                }

                const cropWidth = maxX - minX + 1;
                const cropHeight = maxY - minY + 1;
                if (cropWidth === width && cropHeight === height) {
                    resolve(dataUrl);
                    return;
                }

                const cropped = document.createElement("canvas");
                cropped.width = cropWidth;
                cropped.height = cropHeight;
                const croppedCtx = cropped.getContext("2d");
                if (!croppedCtx) {
                    resolve(dataUrl);
                    return;
                }

                croppedCtx.clearRect(0, 0, cropWidth, cropHeight);
                croppedCtx.drawImage(scratch, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
                resolve(cropped.toDataURL("image/png"));
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    async function exportActiveLayerToDataUrl() {
        if (!canvas) {
            setStatus("Canvas not ready for export");
            return null;
        }

        const active = canvas.getActiveObject();
        if (!active) {
            setStatus("Select a layer first");
            return null;
        }

        if (typeof active.toDataURL !== "function") {
            setStatus("Selected layer cannot be exported");
            return null;
        }

        try {
            const dataUrl = active.toDataURL({
                format: "png",
                multiplier: 1,
                enableRetinaScaling: false
            });
            if (!dataUrl) {
                setStatus("Layer export failed");
                return null;
            }
            return await trimTransparentDataUrl(dataUrl);
        } catch (err) {
            console.error(err);
            setStatus("Layer export failed");
            return null;
        }
    }

    function downloadDataUrl(dataUrl, filename) {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    function dataURLtoBlob(dataurl) {
        const arr = dataurl.split(",");
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);

        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }

        return new Blob([u8arr], { type: mime });
    }

    function isElementVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
            return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function findTabButton(labelRegex) {
        const composerRoot = document.getElementById("forge-composer-root");
        const candidates = [
            ...document.querySelectorAll('button, [role="tab"], .tab-nav button, .tabs button')
        ].filter((el) => !(composerRoot && composerRoot.contains(el)));

        return candidates.find((el) => labelRegex.test((el.textContent || "").trim().toLowerCase())) || null;
    }

    function findTabButtonInScopes(scopeSelectors, labelRegex) {
        const composerRoot = document.getElementById("forge-composer-root");
        for (const scopeSelector of scopeSelectors) {
            const scope = document.querySelector(scopeSelector);
            if (!scope) continue;
            const localCandidates = [
                ...scope.querySelectorAll('button, [role="tab"], .tab-nav button, .tabs button')
            ].filter((el) => !(composerRoot && composerRoot.contains(el)));
            const match = localCandidates.find((el) => labelRegex.test((el.textContent || "").trim().toLowerCase()));
            if (match) return match;
        }
        return null;
    }

    function findBestFileInput(selectors, opts = {}) {
        const allowGenericFallback = opts.allowGenericFallback !== false;
        for (const selector of selectors) {
            const all = [...document.querySelectorAll(selector)];
            const visible = all.find(isElementVisible);
            if (visible) return visible;
            if (all.length > 0) return all[0];
        }

        if (!allowGenericFallback) {
            return null;
        }

        const composerRoot = document.getElementById("forge-composer-root");
        const genericVisible = [...document.querySelectorAll('input[type="file"]')]
            .filter((el) => !(composerRoot && composerRoot.contains(el)))
            .find(isElementVisible);

        if (genericVisible) return genericVisible;

        const genericAny = [...document.querySelectorAll('input[type="file"]')]
            .filter((el) => !(composerRoot && composerRoot.contains(el)));
        return genericAny[0] || null;
    }

    function normalizeUiText(value) {
        return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
    }

    function findControlNetIndependentUploadToggle(scopeSelectors) {
        const exactNeedle = "upload independent control image";
        const fuzzyPatterns = [
            /\bupload\b.*\bindependent\b.*\bcontrol\b.*\bimage\b/i,
            /\bindependent\b.*\bcontrol\b.*\bimage\b/i
        ];

        const toToggle = (el) => {
            if (!el) return null;
            if (el.matches?.('input[type="checkbox"]')) return { kind: "input", el, clickTarget: el };
            if (el.matches?.('[role="checkbox"], button[aria-checked]')) return { kind: "aria", el, clickTarget: el };
            return null;
        };
        const controlNetNeedle = /(independent.*control.*image|control.*image.*independent)/i;

        for (const scopeSelector of scopeSelectors) {
            const scope = document.querySelector(scopeSelector);
            if (!scope) continue;

            // 1) Prefer exact label matches to avoid accidentally toggling "Enable".
            const labels = [...scope.querySelectorAll("label")];
            for (const label of labels) {
                const text = normalizeUiText(label.textContent);
                if (!text) continue;
                const hit = text.includes(exactNeedle) || fuzzyPatterns.some((re) => re.test(text));
                if (!hit) continue;

                const own = toToggle(label.querySelector('input[type="checkbox"], [role="checkbox"], button[aria-checked]'));
                if (own) return own;

                const forId = label.getAttribute("for");
                if (forId) {
                    const byId = document.getElementById(forId);
                    const linked = toToggle(byId);
                    if (linked) return linked;
                }

                const prev = toToggle(label.previousElementSibling);
                if (prev) return prev;
                const next = toToggle(label.nextElementSibling);
                if (next) return next;
            }

            // 2) Then try nearby text nodes (short strings only), bound to immediate row siblings.
            const textNodes = [...scope.querySelectorAll("span, p, div")]
                .filter((node) => {
                    const text = normalizeUiText(node.textContent);
                    if (!text || text.length > 80) return false;
                    return text.includes(exactNeedle) || fuzzyPatterns.some((re) => re.test(text));
                });
            for (const node of textNodes) {
                const parent = node.parentElement;
                if (!parent) continue;

                const directInParent = toToggle(parent.querySelector(':scope > input[type="checkbox"], :scope > [role="checkbox"], :scope > button[aria-checked]'));
                if (directInParent) return directInParent;

                const prev = toToggle(node.previousElementSibling);
                if (prev) return prev;
                const next = toToggle(node.nextElementSibling);
                if (next) return next;
            }
        }

        // Some UIs render ControlNet rows outside the img2img subtree.
        // Fallback: search globally, but skip hidden nodes and Composer itself.
        const composerRoot = document.getElementById("forge-composer-root");
        const globalLabels = [...document.querySelectorAll("label")];
        for (const label of globalLabels) {
            if (!label || (composerRoot && composerRoot.contains(label))) continue;
            if (!isElementVisible(label)) continue;
            const text = normalizeUiText(label.textContent);
            if (!text) continue;
            const hit = text.includes(exactNeedle) || fuzzyPatterns.some((re) => re.test(text));
            if (!hit) continue;

            const own = toToggle(label.querySelector('input[type="checkbox"], [role="checkbox"], button[aria-checked]'));
            if (own) return own;

            const forId = label.getAttribute("for");
            if (forId) {
                const byId = document.getElementById(forId);
                const linked = toToggle(byId);
                if (linked) return linked;
            }

            const prev = toToggle(label.previousElementSibling);
            if (prev) return prev;
            const next = toToggle(label.nextElementSibling);
            if (next) return next;
        }

        // Hard fallback by attributes (id/name/aria) for custom ControlNet widgets.
        const globalCandidates = [
            ...document.querySelectorAll(
                'input[type="checkbox"], [role="checkbox"], button[aria-checked], [id], [name], [aria-label]'
            )
        ].filter((el) => !(composerRoot && composerRoot.contains(el)));

        for (const el of globalCandidates) {
            if (!isElementVisible(el)) continue;
            const haystack = [
                el.id,
                el.getAttribute?.("name"),
                el.getAttribute?.("aria-label"),
                el.getAttribute?.("data-testid"),
                el.textContent
            ].map((v) => normalizeUiText(v)).join(" ");

            if (!controlNetNeedle.test(haystack)) continue;

            const direct = toToggle(el);
            if (direct) return direct;

            const parent = el.closest("label, .gr-checkbox, .gradio-checkbox, .gr-form, .form, .block, div");
            if (parent) {
                const nested = toToggle(
                    parent.querySelector('input[type="checkbox"], [role="checkbox"], button[aria-checked]')
                );
                if (nested) return nested;
            }
        }

        return null;
    }

    function isToggleEnabled(toggle) {
        if (!toggle?.el) return false;
        if (toggle.kind === "input") {
            return !!toggle.el.checked;
        }
        const aria = String(toggle.el.getAttribute("aria-checked") || "").toLowerCase();
        return aria === "true";
    }

    async function ensureControlNetIndependentUploadEnabled(scopeSelectors) {
        const getToggle = () => findControlNetIndependentUploadToggle(scopeSelectors);
        let toggle = getToggle();
        if (!toggle) return false;
        if (isToggleEnabled(toggle)) return true;

        const clickTarget = toggle.clickTarget || toggle.el;
        clickTarget.click();

        if (toggle.kind === "input") {
            toggle.el.dispatchEvent(new Event("input", { bubbles: true }));
            toggle.el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        await new Promise((r) => setTimeout(r, 460));
        toggle = getToggle() || toggle;
        if (isToggleEnabled(toggle)) return true;

        // Second attempt: click both target and its label/container to support custom wrappers.
        clickTarget.click();
        const container = toggle.el?.closest?.("label, .gr-checkbox, .gradio-checkbox, .gr-form, .form, .block, div");
        if (container && container !== clickTarget) {
            container.click();
        }
        if (toggle.kind === "input") {
            toggle.el.checked = true;
            toggle.el.dispatchEvent(new Event("input", { bubbles: true }));
            toggle.el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        await new Promise((r) => setTimeout(r, 320));
        toggle = getToggle() || toggle;
        return isToggleEnabled(toggle);
    }

    function readToggleStateFromNode(node) {
        if (!node) return null;
        if (node.matches?.('input[type="checkbox"]')) return !!node.checked;
        if (node.matches?.('[role="checkbox"], button[aria-checked]')) {
            return String(node.getAttribute("aria-checked") || "").toLowerCase() === "true";
        }
        const nested = node.querySelector?.('input[type="checkbox"], [role="checkbox"], button[aria-checked]');
        if (nested) {
            return readToggleStateFromNode(nested);
        }
        return null;
    }

    function clickToggleNode(node) {
        if (!node) return false;
        const target = node.matches?.('input[type="checkbox"], [role="checkbox"], button[aria-checked]')
            ? node
            : node.querySelector?.('input[type="checkbox"], [role="checkbox"], button[aria-checked]');
        if (!target) return false;

        target.click();
        if (target.matches?.('input[type="checkbox"]')) {
            target.dispatchEvent(new Event("input", { bubbles: true }));
            target.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return true;
    }

    async function ensureControlNetIndependentByKnownIds() {
        const unitIds = [0, 1, 2].map((idx) => ({
            enableId: `img2img_controlnet_ControlNet-${idx}_controlnet_enable_checkbox`,
            sameImgId: `img2img_controlnet_ControlNet-${idx}_controlnet_same_img2img_checkbox`
        }));

        const enabledUnits = [];
        const disabledUnits = [];

        for (const ids of unitIds) {
            const enableNode = document.getElementById(ids.enableId);
            const sameImgNode = document.getElementById(ids.sameImgId);
            if (!sameImgNode) continue;

            const enableState = readToggleStateFromNode(enableNode);
            if (enableState === true) {
                enabledUnits.push(sameImgNode);
            } else {
                disabledUnits.push(sameImgNode);
            }
        }

        const targets = enabledUnits.length > 0 ? enabledUnits : disabledUnits.slice(0, 1);
        if (targets.length === 0) return false;

        let changed = false;
        for (const node of targets) {
            const current = readToggleStateFromNode(node);
            // According to saved img2img presets in this Forge setup:
            // same_img2img=true corresponds to "Upload independent control image" enabled.
            if (current !== true) {
                clickToggleNode(node);
                changed = true;
            }
        }

        if (changed) {
            await new Promise((r) => setTimeout(r, 420));
        }
        return true;
    }

    function assignFileToInput(targetInput, file) {
        if (!targetInput || !file) return false;
        const dt = new DataTransfer();
        dt.items.add(file);
        targetInput.files = dt.files;
        targetInput.dispatchEvent(new Event("input", { bubbles: true }));
        targetInput.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }

    function getObjectSceneBounds(obj) {
        if (!obj || !window.fabric?.util?.transformPoint || typeof obj.calcTransformMatrix !== "function") return null;
        const width = obj.width || obj._element?.width || 0;
        const height = obj.height || obj._element?.height || 0;
        if (!width || !height) return null;

        const matrix = obj.calcTransformMatrix();
        const points = [
            new window.fabric.Point(-width / 2, -height / 2),
            new window.fabric.Point(width / 2, -height / 2),
            new window.fabric.Point(width / 2, height / 2),
            new window.fabric.Point(-width / 2, height / 2)
        ].map((point) => window.fabric.util.transformPoint(point, matrix));

        return {
            minX: Math.min(...points.map((p) => p.x)),
            minY: Math.min(...points.map((p) => p.y)),
            maxX: Math.max(...points.map((p) => p.x)),
            maxY: Math.max(...points.map((p) => p.y))
        };
    }

    function getMosaicInpaintSourceObject() {
        if (!canvas) return null;
        if (mosaicSourceObject && canvas.getObjects().includes(mosaicSourceObject)) {
            return mosaicSourceObject;
        }
        const active = canvas.getActiveObject();
        if (isImageObject(active) && active?.composerType !== MOSAIC_TYPE) {
            return active;
        }

        const objects = canvas.getObjects();
        const mosaicIndex = objects.findIndex((obj) => obj?.composerType === MOSAIC_TYPE);
        if (mosaicIndex >= 0) {
            return objects.slice(mosaicIndex + 1).find((obj) => isImageObject(obj) && obj?.composerType !== MOSAIC_TYPE) || null;
        }

        return [...objects].reverse().find((obj) => isImageObject(obj) && obj?.composerType !== MOSAIC_TYPE) || null;
    }

    function exportMosaicInpaintMaskToDataUrl(overlapRatio = mosaicMaskOverlap) {
        if (!canvas || !window.fabric?.util?.invertTransform || !window.fabric?.util?.transformPoint) return null;

        const sourceObj = getMosaicInpaintSourceObject();
        if (!sourceObj) {
            setStatus("Mosaic source image not found for mask");
            return null;
        }

        const sourceCanvas = renderObjectSourceCanvas(sourceObj);
        if (!sourceCanvas) {
            setStatus("Mask source is not ready");
            return null;
        }

        const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
        if (!sourceCtx) return null;

        const sourceW = sourceCanvas.width;
        const sourceH = sourceCanvas.height;
        const sourcePixels = sourceCtx.getImageData(0, 0, sourceW, sourceH).data;
        const objectW = sourceObj.width || sourceW;
        const objectH = sourceObj.height || sourceH;
        const bounds = getObjectSceneBounds(sourceObj);
        const matrix = typeof sourceObj.calcTransformMatrix === "function" ? sourceObj.calcTransformMatrix() : null;
        if (!bounds || !Array.isArray(matrix) || !objectW || !objectH) return null;

        const out = document.createElement("canvas");
        out.width = sceneWidth;
        out.height = sceneHeight;
        const outCtx = out.getContext("2d");
        if (!outCtx) return null;
        outCtx.fillStyle = "#ffffff";
        outCtx.fillRect(0, 0, sceneWidth, sceneHeight);

        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        const objectToPixelX = (value) => clamp(Math.round((value / Math.max(1, objectW - 1)) * (sourceW - 1)), 0, sourceW - 1);
        const objectToPixelY = (value) => clamp(Math.round((value / Math.max(1, objectH - 1)) * (sourceH - 1)), 0, sourceH - 1);
        const minX = clamp(Math.floor(bounds.minX), 0, sceneWidth);
        const minY = clamp(Math.floor(bounds.minY), 0, sceneHeight);
        const maxX = clamp(Math.ceil(bounds.maxX), 0, sceneWidth);
        const maxY = clamp(Math.ceil(bounds.maxY), 0, sceneHeight);
        const width = Math.max(0, maxX - minX);
        const height = Math.max(0, maxY - minY);
        if (!width || !height) return out.toDataURL("image/png");

        const pixels = outCtx.getImageData(minX, minY, width, height);
        const data = pixels.data;
        const inverted = window.fabric.util.invertTransform(matrix);
        const overlapX = Math.max(1, objectW * overlapRatio);
        const overlapY = Math.max(1, objectH * overlapRatio);
        const holeOverlap = Math.max(2, Math.round(Math.min(width, height, objectW, objectH) * overlapRatio));
        const sidePad = 1;
        const hasLeftOutpaint = bounds.minX > sidePad;
        const hasRightOutpaint = bounds.maxX < sceneWidth - sidePad;
        const hasTopOutpaint = bounds.minY > sidePad;
        const hasBottomOutpaint = bounds.maxY < sceneHeight - sidePad;
        const shouldProtect = new Uint8Array(width * height);

        for (let py = 0; py < height; py += 1) {
            for (let px = 0; px < width; px += 1) {
                const sceneX = minX + px + 0.5;
                const sceneY = minY + py + 0.5;
                const local = window.fabric.util.transformPoint(new window.fabric.Point(sceneX, sceneY), inverted);
                const objectX = local.x + objectW / 2;
                const objectY = local.y + objectH / 2;
                if (objectX < 0 || objectX >= objectW || objectY < 0 || objectY >= objectH) continue;

                const sampleX = objectToPixelX(objectX);
                const sampleY = objectToPixelY(objectY);
                const alpha = sourcePixels[(sampleY * sourceW + sampleX) * 4 + 3] || 0;
                if (alpha <= 8) continue;

                const inOverlap = (hasLeftOutpaint && objectX < overlapX)
                    || (hasRightOutpaint && objectX > objectW - overlapX)
                    || (hasTopOutpaint && objectY < overlapY)
                    || (hasBottomOutpaint && objectY > objectH - overlapY);
                if (inOverlap) continue;

                shouldProtect[py * width + px] = 1;
            }
        }

        if (holeOverlap > 0) {
            const originalProtect = shouldProtect.slice();
            const horizontalWhite = new Uint8Array(width * height);

            for (let py = 0; py < height; py += 1) {
                let windowWhite = 0;
                for (let x = 0; x <= Math.min(holeOverlap, width - 1); x += 1) {
                    if (originalProtect[py * width + x] === 0) windowWhite += 1;
                }
                for (let px = 0; px < width; px += 1) {
                    if (windowWhite > 0) horizontalWhite[py * width + px] = 1;
                    const removeX = px - holeOverlap;
                    const addX = px + holeOverlap + 1;
                    if (removeX >= 0 && originalProtect[py * width + removeX] === 0) windowWhite -= 1;
                    if (addX < width && originalProtect[py * width + addX] === 0) windowWhite += 1;
                }
            }

            for (let px = 0; px < width; px += 1) {
                let windowWhite = 0;
                for (let y = 0; y <= Math.min(holeOverlap, height - 1); y += 1) {
                    if (horizontalWhite[y * width + px] !== 0) windowWhite += 1;
                }
                for (let py = 0; py < height; py += 1) {
                    shouldProtect[py * width + px] = windowWhite > 0 ? 0 : originalProtect[py * width + px];
                    const removeY = py - holeOverlap;
                    const addY = py + holeOverlap + 1;
                    if (removeY >= 0 && horizontalWhite[removeY * width + px] !== 0) windowWhite -= 1;
                    if (addY < height && horizontalWhite[addY * width + px] !== 0) windowWhite += 1;
                }
            }
        }

        for (let py = 0; py < height; py += 1) {
            for (let px = 0; px < width; px += 1) {
                if (shouldProtect[py * width + px] === 0) continue;
                const idx = (py * width + px) * 4;
                data[idx] = 0;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 255;
            }
        }

        outCtx.putImageData(pixels, minX, minY);
        return out.toDataURL("image/png");
    }

    function findLabeledFileInput(labelRegex, preferredScopes = []) {
        const composerRoot = document.getElementById("forge-composer-root");
        const scopes = preferredScopes
            .map((selector) => document.querySelector(selector))
            .filter(Boolean);
        if (scopes.length === 0) scopes.push(document);

        for (const scope of scopes) {
            const labels = [...scope.querySelectorAll("label, span, p, div")]
                .filter((el) => !(composerRoot && composerRoot.contains(el)))
                .filter((el) => {
                    if (!isElementVisible(el)) return false;
                    const text = normalizeUiText(el.textContent);
                    return text.length > 0 && text.length <= 80 && labelRegex.test(text);
                });
            for (const label of labels) {
                const block = label.closest(".block, .form, .gradio-container, .gradio-file, .file-preview, div") || label.parentElement;
                const input = block?.querySelector?.('input[type="file"]');
                if (input) return input;
                let sibling = label.nextElementSibling;
                for (let i = 0; sibling && i < 4; i += 1, sibling = sibling.nextElementSibling) {
                    const candidate = sibling.matches?.('input[type="file"]')
                        ? sibling
                        : sibling.querySelector?.('input[type="file"]');
                    if (candidate) return candidate;
                }
            }
        }

        return null;
    }

    function findInpaintUploadMaskInput(imageInput) {
        const selectors = [
            '#img2img_inpaint_upload [id*="mask"] input[type="file"]',
            '#img2img_inpaint_upload_tab [id*="mask"] input[type="file"]',
            '#inpaint_upload [id*="mask"] input[type="file"]',
            '[id*="inpaint"][id*="upload"] [id*="mask"] input[type="file"]',
            '[id*="img2img"][id*="inpaint"][id*="upload"] [id*="mask"] input[type="file"]'
        ];
        const direct = findBestFileInput(selectors, { allowGenericFallback: false });
        if (direct && direct !== imageInput) return direct;

        const labeled = findLabeledFileInput(/\bmask\b/i, [
            '#img2img_inpaint_upload',
            '#img2img_inpaint_upload_tab',
            '#inpaint_upload',
            '[id*="inpaint"][id*="upload"]'
        ]);
        if (labeled && labeled !== imageInput) return labeled;

        const composerRoot = document.getElementById("forge-composer-root");
        const all = [...document.querySelectorAll('input[type="file"]')]
            .filter((el) => !(composerRoot && composerRoot.contains(el)));
        const idx = all.indexOf(imageInput);
        if (idx >= 0) {
            return all.slice(idx + 1).find((el) => normalizeUiText(el.closest(".block, .form, div")?.textContent).includes("mask")) || all[idx + 1] || null;
        }

        return null;
    }

    async function sendToForgeTarget(targetMode) {
        const dataUrl = exportCanvasToDataUrl();
        if (!dataUrl) {
            setStatus("Nothing to send");
            return;
        }

        const blob = dataURLtoBlob(dataUrl);
        const file = new File([blob], "composer_scene.png", { type: "image/png" });

        let tabButton = null;
        let inputSelectorCandidates = [];
        let findInputOpts = { allowGenericFallback: true };

        if (targetMode === "img2img") {
            tabButton = findTabButton(/\bimg2img\b/i);
            inputSelectorCandidates = [
                '#img2img_image input[type="file"]',
                '#img2img_tab input[type="file"]',
                '#img2img input[type="file"]'
            ];
        } else if (targetMode === "inpaint") {
            const img2imgTab = findTabButton(/\bimg2img\b/i);
            if (img2imgTab) {
                img2imgTab.click();
                await new Promise((r) => setTimeout(r, 250));
            }

            tabButton = findTabButton(/\binpaint\b/i);
            inputSelectorCandidates = [
                '#img2img_inpaint input[type="file"]',
                '#img2maskimg input[type="file"]',
                '#inpaint_image input[type="file"]',
                '#img2img_inpaint_tab input[type="file"]',
                '#img2img input[type="file"]'
            ];
        } else if (targetMode === "inpaint_upload") {
            const img2imgTab = findTabButton(/\bimg2img\b/i);
            if (img2imgTab) {
                img2imgTab.click();
                await new Promise((r) => setTimeout(r, 250));
            }

            tabButton = findTabButton(/\binpaint\s*upload\b/i);
            inputSelectorCandidates = [
                '#img2img_inpaint_upload input[type="file"]',
                '#img2img_inpaint_upload_tab input[type="file"]',
                '#inpaint_upload input[type="file"]',
                '[id*="inpaint"][id*="upload"] input[type="file"]',
                '[id*="img2img"][id*="inpaint"][id*="upload"] input[type="file"]',
                '#img2img input[type="file"]'
            ];
        } else if (targetMode === "controlnet_i2i") {
            const controlNetScopes = ['#img2img', '#img2img_tab', '[id*="img2img"]'];
            const img2imgTab = findTabButton(/\bimg2img\b/i);
            if (img2imgTab) {
                img2imgTab.click();
                await new Promise((r) => setTimeout(r, 300));
            }

            tabButton = findTabButtonInScopes(
                controlNetScopes,
                /\bcontrolnet\b/i
            );
            inputSelectorCandidates = [
                '#img2img_controlnet input[type="file"]',
                '#img2img [id*="controlnet"] input[type="file"]',
                '#img2img [class*="controlnet"] input[type="file"]',
                '[id*="img2img"] [id*="controlnet"] input[type="file"]',
                '[id*="img2img"] [class*="controlnet"] input[type="file"]'
            ];
            findInputOpts = { allowGenericFallback: false };

            if (tabButton) {
                tabButton.click();
                await new Promise((r) => setTimeout(r, 450));
            }

            const byKnownIds = await ensureControlNetIndependentByKnownIds();
            if (!byKnownIds) {
                await ensureControlNetIndependentUploadEnabled(controlNetScopes);
            }
            await new Promise((r) => setTimeout(r, 120));
        } else if (targetMode === "controlnet_t2i") {
            const controlNetScopes = ['#txt2img', '#txt2img_tab', '[id*="txt2img"]'];
            const txt2imgTab = findTabButton(/\btxt2img\b/i);
            if (txt2imgTab) {
                txt2imgTab.click();
                await new Promise((r) => setTimeout(r, 300));
            }

            tabButton = findTabButtonInScopes(
                controlNetScopes,
                /\bcontrolnet\b/i
            );
            inputSelectorCandidates = [
                '#txt2img_controlnet input[type="file"]',
                '#txt2img [id*="controlnet"] input[type="file"]',
                '#txt2img [class*="controlnet"] input[type="file"]',
                '[id*="txt2img"] [id*="controlnet"] input[type="file"]',
                '[id*="txt2img"] [class*="controlnet"] input[type="file"]'
            ];
            findInputOpts = { allowGenericFallback: false };

            if (tabButton) {
                tabButton.click();
                await new Promise((r) => setTimeout(r, 450));
            }
        } else {
            setStatus(`Unknown target: ${targetMode}`);
            return;
        }

        if (tabButton && targetMode !== "controlnet_i2i" && targetMode !== "controlnet_t2i") {
            tabButton.click();
            await new Promise((r) => setTimeout(r, 450));
        }

        let targetInput = findBestFileInput(inputSelectorCandidates, findInputOpts);
        if (!targetInput) {
            setStatus(`Target input not found: ${targetMode}`);
            return;
        }

        assignFileToInput(targetInput, file);

        if (targetMode === "inpaint_upload") {
            await new Promise((r) => setTimeout(r, 260));
            const maskDataUrl = exportMosaicInpaintMaskToDataUrl(mosaicMaskOverlap);
            if (!maskDataUrl) {
                setStatus("Sent to Inpaint upload, mask export failed");
                return;
            }

            const maskInput = findInpaintUploadMaskInput(targetInput);
            if (!maskInput) {
                setStatus("Sent to Inpaint upload, mask input not found");
                return;
            }

            const maskBlob = dataURLtoBlob(maskDataUrl);
            const maskFile = new File([maskBlob], "composer_inpaint_mask.png", { type: "image/png" });
            assignFileToInput(maskInput, maskFile);
            setStatus("Sent to Inpaint upload with mask");
            return;
        }

        // ControlNet UI may rebuild the input right after mode switch.
        // Retry once more after a short delay to make the upload stick.
        if (targetMode === "controlnet_i2i" || targetMode === "controlnet_t2i") {
            await new Promise((r) => setTimeout(r, 380));
            targetInput = findBestFileInput(inputSelectorCandidates, findInputOpts);
            if (targetInput) {
                assignFileToInput(targetInput, file);
            }
        }

        setStatus(`Sent to ${targetMode}`);
    }

    function bindUploadButtons() {
        const imageUpload = document.getElementById("composer-image-upload");

        if (!imageUpload) {
            setStatus("Upload inputs not found");
            return false;
        }

        imageUpload.addEventListener("change", (e) => {
            disableDrawingMode(true);
            if (e.target.files?.length) {
                readFiles(e.target.files, false);
            }
            e.target.value = "";
        });
        imageUpload.addEventListener("click", () => disableDrawingMode(true));

        return true;
    }

    function bindCanvasDropZone() {
        const stageWrap = document.querySelector(".composer-stage-wrap");
        if (!stageWrap || stageWrap.dataset.dropBound === "1") return;

        const hasImageFiles = (dt) => {
            if (!dt || !dt.files) return false;
            return Array.from(dt.files).some((file) => file && typeof file.type === "string" && file.type.startsWith("image/"));
        };

        stageWrap.addEventListener("dragenter", (e) => {
            if (!hasImageFiles(e.dataTransfer)) return;
            e.preventDefault();
            stageWrap.classList.add("composer-drag-over");
        });

        stageWrap.addEventListener("dragover", (e) => {
            if (!hasImageFiles(e.dataTransfer)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            stageWrap.classList.add("composer-drag-over");
        });

        stageWrap.addEventListener("dragleave", (e) => {
            if (!stageWrap.contains(e.relatedTarget)) {
                stageWrap.classList.remove("composer-drag-over");
            }
        });

        stageWrap.addEventListener("drop", (e) => {
            e.preventDefault();
            stageWrap.classList.remove("composer-drag-over");
            disableDrawingMode(true);
            const files = e.dataTransfer?.files;
            if (!files || files.length === 0) {
                setStatus("No files dropped");
                return;
            }

            const asBackground = !!e.shiftKey;
            if (asBackground) {
                readFiles([files[0]], true);
                setStatus("Image dropped as background");
                return;
            }

            readFiles(files, false);
        });

        stageWrap.dataset.dropBound = "1";
    }

    function initComposer() {
        if (composerInitialized) return;

        const root = document.getElementById("forge-composer-root");
        const canvasEl = document.getElementById("forge-composer-canvas");

        if (!root || !canvasEl) return;

        applyCompactLayout();

        loadFabric(() => {
            if (composerInitialized) return;

            if (!window.fabric) {
                setStatus("Fabric is not available");
                return;
            }

            installWarpImageClass();
            installShiftCropControls();

            try {
                canvas = new fabric.Canvas("forge-composer-canvas", {
                    preserveObjectStacking: true,
                    backgroundColor: currentCanvasBackgroundColor
                });
            } catch (err) {
                console.error(err);
                setStatus("Canvas init failed");
                return;
            }

            fitCanvasSize();
            window.addEventListener("resize", fitCanvasSize);
            canvas.on("mouse:wheel", (opt) => {
                if (!opt.e) return;
                if (middlePanActive) {
                    opt.e.preventDefault();
                    opt.e.stopPropagation();
                    return;
                }
                if (zViewportZoomActive && !opt.e.ctrlKey && !opt.e.metaKey && !opt.e.altKey) {
                    opt.e.preventDefault();
                    opt.e.stopPropagation();
                    const currentScale = getViewportZoomFromTransform();
                    const factor = opt.e.deltaY < 0 ? 1.08 : 0.92;
                    applyViewportZoomAtPoint(currentScale * factor, opt.e.clientX, opt.e.clientY);
                    return;
                }
                const drawToolActive = drawingTool === "brush" || drawingTool === "eraser" || drawingTool === CLEAN_MASK_TYPE;
                if (opt.e.altKey && drawToolActive) {
                    opt.e.preventDefault();
                    opt.e.stopPropagation();
                    adjustDrawWidthByWheel(opt.e.deltaY || 0);
                    return;
                }
                if (!opt.e.ctrlKey) return;
                opt.e.preventDefault();
                opt.e.stopPropagation();

                const active = canvas.getActiveObject();
                if (active) {
                    scaleObjectByWheel(active, opt.e.deltaY || 0);
                    return;
                }

                scaleBackgroundByWheel(opt.e.deltaY || 0);
            });
            canvas.on("mouse:down", (opt) => {
                if (!lockedLayerObject) return;
                if (middlePanActive) return;
                if (opt?.e?.button !== 0) return;
                if (opt?.target) {
                    if (opt.target !== lockedLayerObject) {
                        ensureLockedLayerIsActive();
                        opt.e.preventDefault();
                        opt.e.stopPropagation();
                    }
                    return;
                }

                // Empty click inside canvas should fully unlock layer targeting.
                clearLayerSelectionLock();
                syncLayersPanel();
            });
            canvas.on("mouse:down", (opt) => {
                if (!canvas) return;
                if (middlePanActive) return;
                if (opt?.e?.button !== 0) return;
                if (lockedLayerObject) return; // panel lock already handles targeting
                if (drawingTool === "brush" || drawingTool === "eraser" || drawingTool === CLEAN_MASK_TYPE) return;

                const active = canvas.getActiveObject();
                const target = opt?.target;
                if (!active || !target) return;
                if (active !== target) return;
                if (active.type === "activeSelection") return;

                // If user starts dragging currently selected object from canvas,
                // keep target locked even when cursor passes over upper layers.
                beginPointerDragTargetLock();
            });
            canvas.on("selection:created", () => {
                syncLayerLockFromCanvasSelection();
                updateDrawingControlsState();
                syncMosaicOverlapPreview();
            });
            canvas.on("selection:updated", () => {
                syncLayerLockFromCanvasSelection();
                updateDrawingControlsState();
                syncMosaicOverlapPreview();
            });
            canvas.on("selection:cleared", syncMosaicOverlapPreview);
            canvas.on("object:moving", (opt) => {
                if (opt?.target === mosaicSourceObject) syncMosaicOverlapPreview();
            });
            canvas.on("object:scaling", (opt) => {
                if (opt?.target === mosaicSourceObject) syncMosaicOverlapPreview();
            });
            canvas.on("object:modified", (opt) => {
                if (opt?.target === mosaicSourceObject) syncMosaicOverlapPreview();
                if (opt?.target?.composerType !== MOSAIC_TYPE && opt?.target?.composerType !== MOSAIC_OVERLAP_PREVIEW_TYPE) {
                    setMosaicControlsVisible(false);
                }
            });
            canvas.on("object:added", (opt) => {
                if (opt?.target?.composerType !== MOSAIC_TYPE && opt?.target?.composerType !== MOSAIC_OVERLAP_PREVIEW_TYPE) {
                    setMosaicControlsVisible(false);
                }
            });

            const ok = bindUploadButtons();
            if (!ok) return;
            bindCanvasDropZone();
            bindMiddleMouseCameraControls();
            bindStageActionsOverlay();
            bindLayersPanel();
            bindCanvasBackgroundControl();
            bindDrawingControls();
            bindDrawingCursorPreview();
            bindWarpEditHandlers();
            bindObjectOpacityControls();
            bindTextStyleControls();
            bindCanvasSizeControls();
            bindGridControls();
            bindMosaicControls();
            bindDeleteShortcut();
            bindOutsideCanvasDeselect();
            bindClipboardPaste();
            bindCanvasContextCopy();
            bindHistoryButtons();
            bindHistoryTracking();
            bindLayersPanelTracking();
            resetHistoryToCurrentScene();
            setGridDivisions(1, true);
            refreshCleanMaskAvailability();
            flushPendingExternalImages();

            const clearBtn = document.getElementById("composer-clear-btn");
            const addTextBtn = document.getElementById("composer-add-text-btn");
            const addTriangleBtn = document.getElementById("composer-add-triangle-btn");
            const addRectBtn = document.getElementById("composer-add-rect-btn");
            const addCircleBtn = document.getElementById("composer-add-circle-btn");
            const addPentagonBtn = document.getElementById("composer-add-pentagon-btn");
            const addHexagonBtn = document.getElementById("composer-add-hexagon-btn");
            const addOctagonBtn = document.getElementById("composer-add-octagon-btn");
            const removeBgBtn = document.getElementById("composer-remove-bg-btn");
            const mosaicOutpaintBtn = document.getElementById("composer-mosaic-outpaint-btn");
            const layerUpBtn = document.getElementById("composer-layer-up-btn");
            const layerDownBtn = document.getElementById("composer-layer-down-btn");
            const flipXBtn = document.getElementById("composer-flip-x-btn");
            const flipYBtn = document.getElementById("composer-flip-y-btn");
            const warpBtn = document.getElementById("composer-warp-btn");
            const coverCanvasBtn = document.getElementById("composer-cover-canvas-btn");
            const fitCanvasToImageBtn = document.getElementById("composer-fit-canvas-to-image-btn");
            const exportBtn = document.getElementById("composer-export-btn");
            const exportLayerBtn = document.getElementById("composer-export-layer-btn");
            const sendImg2ImgBtn = document.getElementById("composer-send-img2img-btn");
            const sendInpaintBtn = document.getElementById("composer-send-inpaint-btn");
            const sendInpaintUploadBtn = document.getElementById("composer-send-inpaint-upload-btn");
            const sendControlNetT2IBtn = document.getElementById("composer-send-controlnet-t2i-btn");
            const sendControlNetI2IBtn = document.getElementById("composer-send-controlnet-i2i-btn");

            clearBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                clearLayerSelectionLock();
                const all = canvas.getObjects().slice();
                all.forEach(obj => canvas.remove(obj));
                backgroundObject = null;
                lastEraserTargets = [];
                mosaicSourceObject = null;
                lastSelectedImageObject = null;
                mosaicOverlapPreviewObjects = [];
                setMosaicControlsVisible(false);
                resetSceneViewport();
                canvas.renderAll();
                setStatus("Scene cleared");
            });

            addTextBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                const textValue = window.prompt("Enter text", "Your text here");
                if (textValue === null) {
                    setStatus("Text add canceled");
                    return;
                }
                addTextToCanvas(textValue);
            });

            addTriangleBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                addShapeToCanvas("triangle");
            });
            addRectBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                addShapeToCanvas("rect");
            });
            addCircleBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                addShapeToCanvas("circle");
            });
            addPentagonBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                addShapeToCanvas("pentagon");
            });
            addHexagonBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                addShapeToCanvas("hexagon");
            });
            addOctagonBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                addShapeToCanvas("octagon");
            });

            removeBgBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                removeBackgroundFromActiveImage();
            });
            mosaicOutpaintBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                createMosaicOutpaintFromActiveImage();
            });

            layerUpBtn?.addEventListener("click", () => moveActiveObjectLayer("up"));
            layerDownBtn?.addEventListener("click", () => moveActiveObjectLayer("down"));
            flipXBtn?.addEventListener("click", () => flipActiveObject("x"));
            flipYBtn?.addEventListener("click", () => flipActiveObject("y"));
            warpBtn?.addEventListener("click", () => toggleWarpModeForActiveObject());
            coverCanvasBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                coverActiveImageToCanvas();
            });
            fitCanvasToImageBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                fitCanvasToActiveImage();
            });

            canvas.on("selection:created", syncTextColorControlFromSelection);
            canvas.on("selection:updated", syncTextColorControlFromSelection);
            canvas.on("selection:created", syncTextStyleControlsFromSelection);
            canvas.on("selection:updated", syncTextStyleControlsFromSelection);
            canvas.on("selection:created", syncObjectOpacityControlFromSelection);
            canvas.on("selection:updated", syncObjectOpacityControlFromSelection);
            canvas.on("selection:created", syncWarpButtonState);
            canvas.on("selection:updated", () => {
                const active = canvas.getActiveObject();
                if (warpEditObject && active !== warpEditObject) disableWarpEdit(true);
                syncWarpButtonState();
            });
            canvas.on("selection:created", () => {
                lastEraserTargets = getEraserTargets();
                if (drawingTool === "eraser" && canvas.isDrawingMode) applyDrawingBrush();
            });
            canvas.on("selection:updated", () => {
                lastEraserTargets = getEraserTargets();
                if (drawingTool === "eraser" && canvas.isDrawingMode) applyDrawingBrush();
            });
            canvas.on("selection:cleared", () => {
                disableWarpEdit(true);
                syncTextStyleControlsFromSelection();
                syncObjectOpacityControlFromSelection();
                updateDrawingControlsState();
                if (drawingTool === "eraser" && canvas.isDrawingMode && !eraserFallbackActive) {
                    disableDrawingMode(true);
                    setStatus("Select object to erase");
                }
            });
            canvas.on("path:created", (opt) => {
                markCleanMaskPath(opt?.path);
            });
            canvas.on("after:render", syncGridOverlay);

            exportBtn?.addEventListener("click", () => {
                const dataUrl = exportCanvasToDataUrl();
                if (!dataUrl) return;
                downloadDataUrl(dataUrl, "composer_scene.png");
                setStatus("PNG exported");
            });

            exportLayerBtn?.addEventListener("click", async () => {
                const active = canvas.getActiveObject();
                const dataUrl = await exportActiveLayerToDataUrl();
                if (!dataUrl) return;

                const baseName = sanitizeDownloadName(
                    active?.type === "activeSelection" ? "composer_layers" : active?.name,
                    "composer_layer"
                );
                downloadDataUrl(dataUrl, `${baseName}.png`);
                setStatus(active?.type === "activeSelection" ? "Layers PNG exported" : "Layer PNG exported");
            });

            sendImg2ImgBtn?.addEventListener("click", () => sendToForgeTarget("img2img"));
            sendInpaintBtn?.addEventListener("click", () => sendToForgeTarget("inpaint"));
            sendInpaintUploadBtn?.addEventListener("click", () => sendToForgeTarget("inpaint_upload"));
            sendControlNetT2IBtn?.addEventListener("click", () => sendToForgeTarget("controlnet_t2i"));
            sendControlNetI2IBtn?.addEventListener("click", () => sendToForgeTarget("controlnet_i2i"));

            composerInitialized = true;
            bindStageHeightOverlay();
            applyStageHeight();
            setStatus("Composer initialized");
        });
    }

    window.forgeComposerNeo = Object.assign(window.forgeComposerNeo || {}, {
        addImageFromDataUrl: addExternalImageToCanvas
    });
    window.txt2img_composer_send_selected_to_composer = () => sendSelectedGalleryImageToComposer("txt2img");
    window.img2img_composer_send_selected_to_composer = () => sendSelectedGalleryImageToComposer("img2img");
    placeComposerGalleryButtons();

    function bootstrapComposer() {
        // Gradio can render tabs after script load. We retry until canvas exists.
        initComposer();
    }

    const observer = new MutationObserver(() => {
        placeComposerGalleryButtons();
        initComposer();
    });

    function startObserverWhenBodyReady() {
        if (!document.body) {
            setTimeout(startObserverWhenBodyReady, 100);
            return;
        }

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    startObserverWhenBodyReady();

    // Safety net: if observer misses late tab mount, polling will still init once.
    const bootInterval = setInterval(() => {
        if (composerInitialized) {
            clearInterval(bootInterval);
            return;
        }
        bootstrapComposer();
    }, 500);

    window.addEventListener("load", bootstrapComposer);
    document.addEventListener("DOMContentLoaded", bootstrapComposer);
})();
