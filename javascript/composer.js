(function () {
    let composerInitialized = false;
    let canvas = null;
    let backgroundObject = null;
    let fabricLoadPromise = null;
    const STAGE_MIN_HEIGHT = 512;
    const STAGE_MAX_HEIGHT = 512;
    const MIN_SCENE_SIZE = 64;
    const MAX_SCENE_SIZE = 2048;
    const SCENE_STEP = 64;
    let sceneWidth = 1024;
    let sceneHeight = 1024;
    let displayScale = 1;
    let currentTextColor = "#ffffff";
    let removeBgInFlight = false;
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
    const HISTORY_LIMIT = 80;
    const HISTORY_CAPTURE_DELAY_MS = 140;
    let historyUndoStack = [];
    let historyRedoStack = [];
    let historyCaptureTimer = null;
    let historyRestoring = false;

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

    function getHistorySnapshot() {
        if (!canvas) return null;
        const canvasJson = canvas.toJSON(["name", "composerType"]);
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
            canvas.renderAll();
            syncTextColorControlFromSelection();
            syncObjectOpacityControlFromSelection();
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

    function bindHistoryTracking() {
        if (!canvas || canvas.__composerHistoryBound) return;

        const onHistoryChange = () => {
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
                angle: target.angle,
                skewX: target.skewX,
                skewY: target.skewY
            };
        };

        const shouldTrackModified = (target) => {
            if (!target) return true;
            const before = target.__composerBeforeTransform;
            target.__composerBeforeTransform = null;
            if (!before) return true;

            const moved = changed(before.left, target.left) || changed(before.top, target.top);
            const scaledOrSkewed = changed(before.scaleX, target.scaleX)
                || changed(before.scaleY, target.scaleY)
                || changed(before.skewX, target.skewX)
                || changed(before.skewY, target.skewY);
            const rotated = changed(before.angle, target.angle);

            // Ignore pure translate moves in undo stack.
            return scaledOrSkewed || rotated || !moved;
        };

        canvas.on("object:added", onHistoryChange);
        canvas.on("object:removed", onHistoryChange);
        canvas.on("before:transform", (e) => {
            rememberBeforeTransform(e?.transform?.target);
        });
        canvas.on("object:modified", (e) => {
            if (!shouldTrackModified(e?.target)) return;
            onHistoryChange();
        });
        canvas.on("path:created", onHistoryChange);
        canvas.on("erasing:end", () => {
            flushHistoryCaptureNow();
        });
        canvas.on("mouse:up", () => {
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
            wrap.style.minHeight = `${STAGE_MIN_HEIGHT}px`;
            wrap.style.maxHeight = `${STAGE_MAX_HEIGHT}px`;
            wrap.style.height = `${STAGE_MAX_HEIGHT}px`;
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

        const rawWidth = stageWrap.clientWidth - 8;
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
        }

        mountStageActionsOverlay();
        updateDrawCursorSize();
        canvas.renderAll();
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

        upper.addEventListener("mousedown", (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            middlePanActive = true;
            middlePanLastX = e.clientX;
            middlePanLastY = e.clientY;
            upper.style.cursor = "grabbing";
        });

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

    function getSceneFocusCenter() {
        if (!canvas || !window.fabric) {
            return { x: sceneWidth / 2, y: sceneHeight / 2 };
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
            sceneWidth = next;
            updateSizeLabels();
            fitCanvasSize();
            scheduleHistoryCapture();
        });

        heightSlider.addEventListener("input", () => {
            const next = clampToStepSize(heightSlider.value);
            heightSlider.value = String(next);
            sceneHeight = next;
            updateSizeLabels();
            fitCanvasSize();
            scheduleHistoryCapture();
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

        const viewport = getSceneViewportSize();
        const cw = viewport.width;
        const ch = viewport.height;
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

        obj.set({
            scaleX: nextScale,
            scaleY: nextScale
        });

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

        const maxSize = 260;
        const scale = Math.min(1, maxSize / realW, maxSize / realH);
        const focus = getSceneFocusCenter();

        img.scale(scale);
        img.set({
            left: Math.max(20, focus.x - img.getScaledWidth() / 2),
            top: Math.max(20, focus.y - img.getScaledHeight() / 2)
        });

        canvas.add(img);
        canvas.setActiveObject(img);
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
            fontFamily: "Arial",
            fontWeight: "600",
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
                width: 140,
                height: 140,
                rx: 2,
                ry: 2,
                name: "Square"
            });
        } else if (shapeType === "circle") {
            shape = new window.fabric.Circle({
                ...base,
                radius: 70,
                name: "Circle"
            });
        } else if (shapeType === "pentagon") {
            shape = new window.fabric.Polygon(buildRegularPolygonPoints(5, 80), {
                ...base,
                name: "Pentagon"
            });
        } else if (shapeType === "hexagon") {
            shape = new window.fabric.Polygon(buildRegularPolygonPoints(6, 80), {
                ...base,
                name: "Hexagon"
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

    function setTextColor(colorValue) {
        const normalized = normalizeHexColor(colorValue);
        if (!normalized) {
            setStatus("Invalid color");
            return;
        }

        currentTextColor = normalized;

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
        const colorInput = document.getElementById("composer-text-color");
        if (!colorInput || !canvas) return;

        const active = canvas.getActiveObject();
        if (!active || active.type === "activeSelection") return;
        if (!isColorEditableObject(active)) return;

        const normalized = normalizeHexColor(active.fill);
        if (!normalized) return;

        currentTextColor = normalized;
        colorInput.value = normalized;
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

        const isX = axis === "x";
        const prop = isX ? "flipX" : "flipY";

        if (active.type === "activeSelection" && typeof active.forEachObject === "function") {
            let changed = 0;
            active.forEachObject((obj) => {
                obj.set(prop, !obj[prop]);
                obj.setCoords();
                changed += 1;
            });
            canvas.requestRenderAll();
            if (changed > 0) scheduleHistoryCapture();
            setStatus(changed > 0 ? `Flipped ${changed} object(s)` : "Nothing to flip");
            return;
        }

        active.set(prop, !active[prop]);
        active.setCoords();
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
                    name: source.name
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

            const hasNoModifiers = !e.ctrlKey && !e.metaKey && !e.altKey;
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

        document.__composerDeleteBound = true;
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

        if (widthVal) widthVal.textContent = String(drawWidth);
        if (opacityVal) opacityVal.textContent = String(drawOpacity);
        if (softnessVal) softnessVal.textContent = String(drawSoftness);

        const brushActive = drawingTool === "brush" && !!canvas?.isDrawingMode;
        const eraserActive = drawingTool === "eraser" && (!!canvas?.isDrawingMode || eraserFallbackActive);
        if (brushBtn) brushBtn.classList.toggle("is-active", brushActive);
        if (eraserBtn) eraserBtn.classList.toggle("is-active", eraserActive);
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
        const ok = applyDrawingBrush();
        if (!ok) return;
        setStatus(tool === "eraser" ? "Eraser mode on" : "Brush mode on");
    }

    function bindDrawingControls() {
        const overlay = document.getElementById("composer-draw-overlay");
        const brushBtn = document.getElementById("composer-draw-brush-btn");
        const eraserBtn = document.getElementById("composer-draw-eraser-btn");
        const colorInput = document.getElementById("composer-draw-color");
        const widthInput = document.getElementById("composer-draw-width");
        const opacityInput = document.getElementById("composer-draw-opacity");
        const softnessInput = document.getElementById("composer-draw-softness");

        if (!overlay || !brushBtn || !eraserBtn || !colorInput || !widthInput || !opacityInput || !softnessInput) {
            return;
        }
        if (overlay.dataset.bound === "1") return;

        drawColor = normalizeHexColor(colorInput.value) || drawColor;
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

        colorInput.addEventListener("input", () => {
            drawColor = normalizeHexColor(colorInput.value) || drawColor;
            colorInput.value = drawColor;
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
        return !!obj && obj.type === "image";
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

            const nextImage = await loadFabricImageFromDataUrl(payload.image);
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
                hasControls: active.hasControls,
                hasBorders: active.hasBorders,
                lockMovementX: active.lockMovementX,
                lockMovementY: active.lockMovementY,
                lockRotation: active.lockRotation,
                lockScalingX: active.lockScalingX,
                lockScalingY: active.lockScalingY,
                name: active.name || "Image",
                composerType: active.composerType || "object",
                cornerStyle: "circle",
                transparentCorners: false,
                padding: 4
            });

            canvas.remove(active);
            if (active === backgroundObject) {
                backgroundObject = null;
            }

            canvas.add(nextImage);
            if (prevIndex >= 0) {
                canvas.moveTo(nextImage, prevIndex);
            }
            nextImage.setCoords();
            canvas.setActiveObject(nextImage);
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

        try {
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
            canvas.requestRenderAll();
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

            try {
                canvas = new fabric.Canvas("forge-composer-canvas", {
                    preserveObjectStacking: true,
                    backgroundColor: "#000000"
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
                const drawToolActive = drawingTool === "brush" || drawingTool === "eraser";
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

            const ok = bindUploadButtons();
            if (!ok) return;
            bindCanvasDropZone();
            bindMiddleMouseCameraControls();
            bindStageActionsOverlay();
            bindDrawingControls();
            bindDrawingCursorPreview();
            bindObjectOpacityControls();
            bindCanvasSizeControls();
            bindDeleteShortcut();
            bindClipboardPaste();
            bindHistoryButtons();
            bindHistoryTracking();
            resetHistoryToCurrentScene();

            const clearBtn = document.getElementById("composer-clear-btn");
            const addTextBtn = document.getElementById("composer-add-text-btn");
            const addRectBtn = document.getElementById("composer-add-rect-btn");
            const addCircleBtn = document.getElementById("composer-add-circle-btn");
            const addPentagonBtn = document.getElementById("composer-add-pentagon-btn");
            const addHexagonBtn = document.getElementById("composer-add-hexagon-btn");
            const removeBgBtn = document.getElementById("composer-remove-bg-btn");
            const textColorInput = document.getElementById("composer-text-color");
            const layerUpBtn = document.getElementById("composer-layer-up-btn");
            const layerDownBtn = document.getElementById("composer-layer-down-btn");
            const flipXBtn = document.getElementById("composer-flip-x-btn");
            const flipYBtn = document.getElementById("composer-flip-y-btn");
            const exportBtn = document.getElementById("composer-export-btn");
            const sendImg2ImgBtn = document.getElementById("composer-send-img2img-btn");
            const sendInpaintBtn = document.getElementById("composer-send-inpaint-btn");
            const sendControlNetT2IBtn = document.getElementById("composer-send-controlnet-t2i-btn");
            const sendControlNetI2IBtn = document.getElementById("composer-send-controlnet-i2i-btn");

            clearBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                const all = canvas.getObjects().slice();
                all.forEach(obj => canvas.remove(obj));
                backgroundObject = null;
                lastEraserTargets = [];
                canvas.renderAll();
                setStatus("Scene cleared");
            });

            if (textColorInput) {
                currentTextColor = normalizeHexColor(textColorInput.value) || currentTextColor;
                textColorInput.addEventListener("input", () => setTextColor(textColorInput.value));
            }

            addTextBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                const textValue = window.prompt("Enter text", "Your text here");
                if (textValue === null) {
                    setStatus("Text add canceled");
                    return;
                }
                addTextToCanvas(textValue);
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

            removeBgBtn?.addEventListener("click", () => {
                disableDrawingMode(true);
                removeBackgroundFromActiveImage();
            });

            layerUpBtn?.addEventListener("click", () => moveActiveObjectLayer("up"));
            layerDownBtn?.addEventListener("click", () => moveActiveObjectLayer("down"));
            flipXBtn?.addEventListener("click", () => flipActiveObject("x"));
            flipYBtn?.addEventListener("click", () => flipActiveObject("y"));

            canvas.on("selection:created", syncTextColorControlFromSelection);
            canvas.on("selection:updated", syncTextColorControlFromSelection);
            canvas.on("selection:created", syncObjectOpacityControlFromSelection);
            canvas.on("selection:updated", syncObjectOpacityControlFromSelection);
            canvas.on("selection:created", () => {
                lastEraserTargets = getEraserTargets();
                if (drawingTool === "eraser" && canvas.isDrawingMode) applyDrawingBrush();
            });
            canvas.on("selection:updated", () => {
                lastEraserTargets = getEraserTargets();
                if (drawingTool === "eraser" && canvas.isDrawingMode) applyDrawingBrush();
            });
            canvas.on("selection:cleared", () => {
                syncObjectOpacityControlFromSelection();
                if (drawingTool === "eraser" && canvas.isDrawingMode && !eraserFallbackActive) {
                    disableDrawingMode(true);
                    setStatus("Select object to erase");
                }
            });

            exportBtn?.addEventListener("click", () => {
                const dataUrl = exportCanvasToDataUrl();
                if (!dataUrl) return;
                downloadDataUrl(dataUrl, "composer_scene.png");
                setStatus("PNG exported");
            });

            sendImg2ImgBtn?.addEventListener("click", () => sendToForgeTarget("img2img"));
            sendInpaintBtn?.addEventListener("click", () => sendToForgeTarget("inpaint"));
            sendControlNetT2IBtn?.addEventListener("click", () => sendToForgeTarget("controlnet_t2i"));
            sendControlNetI2IBtn?.addEventListener("click", () => sendToForgeTarget("controlnet_i2i"));

            composerInitialized = true;
            setStatus("Composer initialized");
        });
    }

    function bootstrapComposer() {
        // Gradio can render tabs after script load. We retry until canvas exists.
        initComposer();
    }

    const observer = new MutationObserver(() => {
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
