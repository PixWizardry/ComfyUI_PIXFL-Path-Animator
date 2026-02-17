/**
 * File: FL_PathAnimator.js
 * Project: ComfyUI_FL-Path-Animator
 *
 * Interactive path animator with modal drawing editor.
 * All fork features ported with 16 bug fixes applied.
 */

import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";

// Module imports
import { Icons } from './modules/icons.js';
import { createSliderControl, createCheckboxControl, createColorPickerControl } from './modules/uiControls.js';
import { PAN_ZOOM_DEFAULTS, getCanvasCoords, getTransformedCoords, onMouseWheel, startPan, updatePan, stopPan, resetView, applyTransform } from './modules/panZoom.js';
import { GRID_DEFAULTS, drawGrid, getSnappedCoords } from './modules/grid.js';
import { GUIDE_DEFAULTS, GUIDE_TYPES, renderGuideLayer, loadSVG } from './modules/guides.js';
import { RESOLUTION_PRESETS, resizeCanvasAndImage } from './modules/canvasResize.js';
import { cloneSelectedPath, flipSelectedPath, reversePathPoints } from './modules/cloneFlip.js';
import { generateEllipsePoints, onOrbitMouseDown, onOrbitMouseMove, onOrbitMouseUp, renderOrbitPreview } from './modules/tools/OrbitTool.js';
import { generateArcPoints, onArcMouseDown, onArcMouseMove, onArcMouseUp, renderArcPreview } from './modules/tools/ArcTool.js';
import { onZoomBoxMouseDown, onZoomBoxMouseMove, onZoomBoxMouseUp, onZoomBoxWheel, finalizeZoomBox, renderZoomBoxPreview, onRightClick } from './modules/tools/ZoomBoxTool.js';

function moveWidgetToTop(node, widget) {
    if (!widget) return;
    const widgetIndex = node.widgets.indexOf(widget);
    if (widgetIndex > 0) {
        node.widgets.splice(widgetIndex, 1);
        node.widgets.unshift(widget);
    }
}

app.registerExtension({
    name: "FillNodes.PathAnimator",
    async nodeCreated(node) {
        if (node.comfyClass === "FL_PathAnimator") {
            const pathsDataWidget = node.widgets.find(w => w.name === "paths_data");
            if (!pathsDataWidget) {
                console.error("FL_PathAnimator: 'paths_data' widget not found!");
                return;
            }

            moveWidgetToTop(node, pathsDataWidget);
            pathsDataWidget._cachedBackgroundImage = null;

            const editButton = node.addWidget("button", "Edit Paths", null, () => {
                openPathEditor(node, pathsDataWidget);
            });

            const pathCountWidget = node.addWidget("text", "Path Count", "0 paths", null);
            pathCountWidget.disabled = true;

            function updatePathCount() {
                try {
                    const data = JSON.parse(pathsDataWidget.value);
                    const count = data.paths ? data.paths.length : 0;
                    const staticCount = data.paths ? data.paths.filter(p => p.isSinglePoint || p.points.length === 1).length : 0;
                    const motionCount = count - staticCount;
                    pathCountWidget.value = `${count} path${count !== 1 ? 's' : ''} (${staticCount} static, ${motionCount} motion)`;
                } catch (e) {
                    pathCountWidget.value = "0 paths";
                }
            }

            updatePathCount();
            node._updatePathCount = updatePathCount;
        }
    }
});

function openPathEditor(node, pathsDataWidget) {
    const frameWidthWidget = node.widgets.find(w => w.name === "frame_width");
    const frameHeightWidget = node.widgets.find(w => w.name === "frame_height");
    const frameWidth = frameWidthWidget ? frameWidthWidget.value : 512;
    const frameHeight = frameHeightWidget ? frameHeightWidget.value : 512;

    const modal = new PathEditorModal(node, pathsDataWidget, frameWidth, frameHeight);
    modal.show();
}

class PathEditorModal {
    constructor(node, pathsDataWidget, frameWidth, frameHeight) {
        this.node = node;
        this.pathsDataWidget = pathsDataWidget;
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        this.paths = [];
        this.currentPath = null;
        this.selectedPathIndex = -1;
        this.isDrawing = false;
        this.tool = 'pencil';
        this.currentColor = this.getRandomColor();
        this.backgroundImage = null;
        this.originalBackgroundImage = null;
        this.backgroundImageFilename = null;
        this.canvasScale = 1.0;
        this.canvasOffsetX = 0;
        this.canvasOffsetY = 0;
        this.pathThickness = 3;
        this.shiftPressed = false;
        this.backgroundOpacity = 1.0;
        this.animationOffset = 0;
        this.animationFrame = null;

        // Tool states
        this.orbitState = null;
        this.orbitDirection = 'cw';
        this.halfCircleState = null;
        this.arcDirection = 'up';
        this.zoomBoxState = null;

        // Dragging state
        this.draggedItem = null;
        this.dragStartPos = null;
        this.isDragging = false;

        // Pan/zoom state (B8 fix foundation)
        Object.assign(this, PAN_ZOOM_DEFAULTS);

        // Grid state (B14 fix foundation)
        Object.assign(this, GRID_DEFAULTS);

        // Guide layer state (B12 fix foundation)
        this.guideLayer = { ...GUIDE_DEFAULTS.guideLayer };
        this.guideSelectElement = null; // B12 fix: stored reference

        // B10 fix: tracked document listeners for cleanup
        this._documentListeners = [];

        // Make zoom box wheel handler accessible to panZoom module
        this._zoomBoxTool = { onZoomBoxWheel };

        // Load existing paths
        this.loadPaths();
        this.loadCachedBackgroundImage();
        this.createModal();
        this.setupKeyboardHandlers();
        this.startAnimation();
    }

    // --- B10 fix: tracked listener helpers ---
    _addDocumentListener(event, handler) {
        document.addEventListener(event, handler);
        this._documentListeners.push({ event, handler });
    }

    _removeAllDocumentListeners() {
        for (const { event, handler } of this._documentListeners) {
            document.removeEventListener(event, handler);
        }
        this._documentListeners = [];
    }

    startAnimation() {
        const animate = () => {
            this.animationOffset += 0.5;
            if (this.animationOffset > 20) this.animationOffset = 0;
            this.render();
            this.animationFrame = requestAnimationFrame(animate);
        };
        this.animationFrame = requestAnimationFrame(animate);
    }

    stopAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    setupKeyboardHandlers() {
        this.keydownHandler = (e) => {
            if (e.key === 'Shift') this.shiftPressed = true;

            if (e.key === 'Escape') {
                // B15 fix: finalize zoom box on Escape before closing
                if (this.tool === 'zoomBox' && this.zoomBoxState) {
                    finalizeZoomBox(this);
                }
                this.savePaths();
                this.close();
            }

            // Enter finalizes zoom box
            if (e.key === 'Enter' && this.tool === 'zoomBox' && this.zoomBoxState) {
                e.preventDefault();
                finalizeZoomBox(this);
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                e.preventDefault();
                e.stopPropagation();
                this.pasteFromClipboard();
            }
        };

        this.keyupHandler = (e) => {
            if (e.key === 'Shift') this.shiftPressed = false;
        };

        this.pasteHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handlePaste(e);
        };

        document.addEventListener('keydown', this.keydownHandler);
        document.addEventListener('keyup', this.keyupHandler);
    }

    attachPasteListener() {
        if (this.container) {
            this.container.addEventListener('paste', this.pasteHandler);
            document.addEventListener('paste', this.pasteHandler);
        }
    }

    loadCachedBackgroundImage() {
        // Fast path: in-memory cache from same session
        if (this.pathsDataWidget._cachedBackgroundImage) {
            const img = new Image();
            img.onload = () => {
                this.backgroundImage = img;
                this.originalBackgroundImage = img;
                if (this.canvas) {
                    this.canvas.width = img.width;
                    this.canvas.height = img.height;
                    this.render();
                }
            };
            img.src = this.pathsDataWidget._cachedBackgroundImage;
            return;
        }

        // Slow path: reload from ComfyUI server using persisted filename
        if (this.backgroundImageFilename) {
            const { name, subfolder } = this.backgroundImageFilename;
            const params = new URLSearchParams({ filename: name, type: 'input' });
            if (subfolder) params.set('subfolder', subfolder);
            const url = api.apiURL(`/view?${params.toString()}`);
            const img = new Image();
            img.onload = () => {
                this.backgroundImage = img;
                this.originalBackgroundImage = img;
                if (this.canvas) {
                    this.canvas.width = img.width;
                    this.canvas.height = img.height;
                    this.render();
                }
                // Re-populate the in-memory cache
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                tempCanvas.getContext('2d').drawImage(img, 0, 0);
                this.pathsDataWidget._cachedBackgroundImage = tempCanvas.toDataURL('image/png');
            };
            img.onerror = () => {
                console.warn('FL_PathAnimator: could not load background image from server:', name);
            };
            img.src = url;
        }
    }

    async pasteFromClipboard() {
        try {
            if (!navigator.clipboard || !navigator.clipboard.read) return;
            const clipboardItems = await navigator.clipboard.read();
            for (const clipboardItem of clipboardItems) {
                for (const type of clipboardItem.types) {
                    if (type.startsWith('image/')) {
                        const blob = await clipboardItem.getType(type);
                        this.loadImageFromBlob(blob);
                        return;
                    }
                }
            }
        } catch (err) {
            console.error('FL_PathAnimator: Error reading from clipboard:', err);
        }
    }

    async uploadImageToComfyUI(blob) {
        const body = new FormData();
        const filename = `fl_path_bg_${Date.now()}.png`;
        body.append('image', new File([blob], filename, { type: blob.type || 'image/png' }));
        body.append('subfolder', 'fl_path_animator');
        body.append('overwrite', 'false');
        try {
            const resp = await api.fetchApi('/upload/image', { method: 'POST', body });
            if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
            const result = await resp.json();
            return { name: result.name, subfolder: result.subfolder || 'fl_path_animator' };
        } catch (err) {
            console.error('FL_PathAnimator: image upload failed:', err);
            return null;
        }
    }

    loadImageFromBlob(blob) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                this.backgroundImage = img;
                this.originalBackgroundImage = img;
                this.canvas.width = img.width;
                this.canvas.height = img.height;
                this.pathsDataWidget._cachedBackgroundImage = event.target.result;
                this.render();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(blob);

        // Upload to ComfyUI input folder for persistence
        this.uploadImageToComfyUI(blob).then((result) => {
            if (result) {
                this.backgroundImageFilename = result;
                console.log('FL_PathAnimator: background image uploaded as', result.name);
            }
        });
    }

    handlePaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (blob) { this.loadImageFromBlob(blob); break; }
            }
        }
    }

    loadPaths() {
        try {
            const data = JSON.parse(this.pathsDataWidget.value);
            this.paths = data.paths || [];
            if (data.background_image) {
                this.backgroundImageFilename = data.background_image;
            }
        } catch (e) {
            this.paths = [];
        }
    }

    savePaths() {
        const data = {
            formatVersion: 2,
            paths: this.paths,
            canvas_size: { width: this.canvas.width, height: this.canvas.height }
        };
        if (this.backgroundImageFilename) {
            data.background_image = this.backgroundImageFilename;
        }
        this.pathsDataWidget.value = JSON.stringify(data);
        if (this.node._updatePathCount) this.node._updatePathCount();
    }

    getRandomColor() {
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    createModal() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'fl-path-editor-overlay';
        this.overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(4px); z-index: 10000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s ease-out;`;

        this.container = document.createElement('div');
        this.container.className = 'fl-path-editor-container';
        this.container.tabIndex = 0;
        this.container.style.cssText = `background: linear-gradient(145deg, #2d2d2d, #252525); border-radius: 12px; border: 1px solid #3a3a3a; width: 95%; height: 95%; max-width: 2000px; max-height: 1400px; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05); animation: slideIn 0.3s ease-out; outline: none;`;

        this.createHeader();
        this.createMainContent();
        this.createFooter();

        this.overlay.appendChild(this.container);
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });
    }

    createHeader() {
        const header = document.createElement('div');
        header.style.cssText = `padding: 20px 24px 16px 24px; border-bottom: 1px solid #404040; background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 100%); display: flex; flex-direction: column; gap: 16px; border-radius: 12px 12px 0 0;`;

        // Top row
        const topRow = document.createElement('div');
        topRow.style.cssText = `display: flex; justify-content: space-between; align-items: center;`;

        const titleContainer = document.createElement('div');
        titleContainer.style.cssText = `display: flex; flex-direction: column; gap: 4px;`;

        const title = document.createElement('h2');
        title.innerHTML = `${Icons.edit()} <span style="margin-left: 8px;">Path Animator Editor</span>`;
        title.style.cssText = `margin: 0; color: #fff; font-size: 20px; font-weight: 600; letter-spacing: -0.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center;`;

        const subtitle = document.createElement('div');
        subtitle.textContent = 'ESC: Save & Close | SHIFT: Straight Lines | CTRL+V: Paste | Middle-Click: Pan | Ctrl+Scroll: Zoom';
        subtitle.style.cssText = `color: #888; font-size: 12px; font-weight: 400;`;

        titleContainer.appendChild(title);
        titleContainer.appendChild(subtitle);

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = Icons.close();
        closeBtn.style.cssText = `background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; color: #fff; cursor: pointer; padding: 0; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;`;
        closeBtn.onmouseover = () => { closeBtn.style.background = 'rgba(255, 77, 77, 0.8)'; closeBtn.style.borderColor = 'rgba(255, 77, 77, 1)'; };
        closeBtn.onmouseout = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.05)'; closeBtn.style.borderColor = 'rgba(255, 255, 255, 0.1)'; };
        closeBtn.onclick = () => this.close();

        topRow.appendChild(titleContainer);
        topRow.appendChild(closeBtn);

        // Grid controls row
        const viewControlsRow = document.createElement('div');
        viewControlsRow.style.cssText = `display: flex; gap: 24px; align-items: center; padding: 12px 16px; background: rgba(0, 0, 0, 0.2); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);`;

        viewControlsRow.appendChild(createCheckboxControl('Show Grid', this.showGrid, (v) => { this.showGrid = v; this.render(); }));
        viewControlsRow.appendChild(createCheckboxControl('Snap to Grid', this.snapToGrid, (v) => { this.snapToGrid = v; }));
        viewControlsRow.appendChild(createSliderControl(this, 'Grid Size', 10, 200, this.gridSize, (v) => { this.gridSize = v; }, 'px'));
        viewControlsRow.appendChild(createSliderControl(this, 'Grid Opacity', 0, 100, this.gridOpacity, (v) => { this.gridOpacity = v; }, '%'));
        viewControlsRow.appendChild(createColorPickerControl('Grid Color', this.gridColor, (v) => { this.gridColor = v; this.render(); }));

        // Guide controls row
        const guideControlsRow = document.createElement('div');
        guideControlsRow.style.cssText = viewControlsRow.style.cssText;
        guideControlsRow.appendChild(createSliderControl(this, 'Guide Opacity', 0, 100, this.guideLayer.opacity * 100, (v) => { this.guideLayer.opacity = v / 100; this.render(); }, '%'));
        guideControlsRow.appendChild(createColorPickerControl('Guide Color', this.guideLayer.color, (v) => { this.guideLayer.color = v; this.render(); }));
        const spacer = document.createElement('div');
        spacer.style.flex = '1';
        guideControlsRow.appendChild(spacer);

        // Resize controls row
        const resizeControlsRow = document.createElement('div');
        resizeControlsRow.style.cssText = viewControlsRow.style.cssText;
        resizeControlsRow.style.paddingTop = '12px';
        resizeControlsRow.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
        resizeControlsRow.style.marginTop = '12px';

        const resizeLabel = document.createElement('label');
        resizeLabel.textContent = 'Resize Canvas';
        resizeLabel.style.cssText = `color: #fff; font-size: 13px; font-weight: 500; min-width: 100px;`;

        this.resolutionSelect = document.createElement('select');
        this.resolutionSelect.style.cssText = `background: #333; color: white; border: 1px solid #555; border-radius: 4px; padding: 6px; font-size: 12px;`;
        RESOLUTION_PRESETS.forEach(res => {
            const option = document.createElement('option');
            option.value = res.value;
            option.textContent = res.text;
            this.resolutionSelect.appendChild(option);
        });

        const resizeBtn = document.createElement('button');
        resizeBtn.textContent = 'Apply Resize';
        resizeBtn.style.cssText = `padding: 6px 12px; background: #4ECDC4; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-size: 13px; font-weight: 500;`;
        resizeBtn.onclick = () => resizeCanvasAndImage(this);

        resizeControlsRow.appendChild(resizeLabel);
        resizeControlsRow.appendChild(this.resolutionSelect);
        resizeControlsRow.appendChild(resizeBtn);

        // Path/bg controls row
        const controlsRow = document.createElement('div');
        controlsRow.style.cssText = viewControlsRow.style.cssText;
        controlsRow.appendChild(createSliderControl(this, 'Path Width', 1, 10, this.pathThickness, (v) => { this.pathThickness = v; }));
        controlsRow.appendChild(createSliderControl(this, 'Background Opacity', 0, 100, this.backgroundOpacity * 100, (v) => { this.backgroundOpacity = v / 100; }, '%'));

        header.appendChild(topRow);
        header.appendChild(viewControlsRow);
        header.appendChild(guideControlsRow);
        header.appendChild(resizeControlsRow);
        header.appendChild(controlsRow);
        this.container.appendChild(header);
    }

    createMainContent() {
        const content = document.createElement('div');
        content.style.cssText = `flex: 1; display: flex; overflow: hidden;`;
        this.createToolbar(content);
        this.createCanvasArea(content);
        this.createSidebar(content);
        this.container.appendChild(content);
    }

    createToolbarButton(iconSvg, title, isActive = false) {
        const btn = document.createElement('button');
        btn.innerHTML = iconSvg;
        btn.title = title;
        btn.style.cssText = `width: 50px; height: 50px; border: 2px solid ${isActive ? '#4ECDC4' : 'rgba(255, 255, 255, 0.15)'}; background: ${isActive ? 'rgba(78, 205, 196, 0.2)' : 'rgba(255, 255, 255, 0.05)'}; color: #fff; cursor: pointer; border-radius: 8px; transition: all 0.2s ease; box-shadow: ${isActive ? '0 0 12px rgba(78, 205, 196, 0.3)' : 'none'}; display: flex; align-items: center; justify-content: center; padding: 0;`;
        btn.onmouseover = () => { if (!isActive) { btn.style.background = 'rgba(255, 255, 255, 0.1)'; btn.style.borderColor = 'rgba(255, 255, 255, 0.25)'; btn.style.transform = 'scale(1.05)'; } };
        btn.onmouseout = () => { if (!isActive) { btn.style.background = 'rgba(255, 255, 255, 0.05)'; btn.style.borderColor = 'rgba(255, 255, 255, 0.15)'; btn.style.transform = 'scale(1)'; } };
        return btn;
    }

    createToolbar(parent) {
        const toolbar = document.createElement('div');
        toolbar.style.cssText = `width: 70px; background: linear-gradient(180deg, #1e1e1e 0%, #181818 100%); border-right: 1px solid #3a3a3a; padding: 12px 10px; display: flex; flex-direction: column; gap: 8px; box-shadow: 2px 0 8px rgba(0, 0, 0, 0.3); overflow-y: auto;`;

        const uploadBtn = this.createToolbarButton(Icons.image(), 'Load Background Image');
        uploadBtn.onclick = () => this.loadImage();
        toolbar.appendChild(uploadBtn);

        const clearImgBtn = this.createToolbarButton(Icons.xCircle(), 'Clear Background Image');
        clearImgBtn.onclick = () => this.clearImage();
        toolbar.appendChild(clearImgBtn);

        const makeSeparator = () => {
            const sep = document.createElement('div');
            sep.style.cssText = `height: 1px; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent); margin: 8px 0;`;
            return sep;
        };
        toolbar.appendChild(makeSeparator());

        // Direction toggles
        const orbitDirectionBtn = this.createToolbarButton(Icons.clockwise(), 'Orbit Direction: Clockwise');
        orbitDirectionBtn.onclick = () => {
            if (this.orbitDirection === 'cw') {
                this.orbitDirection = 'ccw';
                orbitDirectionBtn.innerHTML = Icons.counterClockwise();
                orbitDirectionBtn.title = 'Orbit Direction: Counter-Clockwise';
            } else {
                this.orbitDirection = 'cw';
                orbitDirectionBtn.innerHTML = Icons.clockwise();
                orbitDirectionBtn.title = 'Orbit Direction: Clockwise';
            }
        };
        toolbar.appendChild(orbitDirectionBtn);

        const arcDirectionBtn = this.createToolbarButton(Icons.arcUp(), 'Arc Direction: Above/Left');
        arcDirectionBtn.onclick = () => {
            if (this.arcDirection === 'up') {
                this.arcDirection = 'down';
                arcDirectionBtn.innerHTML = Icons.arcDown();
                arcDirectionBtn.title = 'Arc Direction: Below/Right';
            } else {
                this.arcDirection = 'up';
                arcDirectionBtn.innerHTML = Icons.arcUp();
                arcDirectionBtn.title = 'Arc Direction: Above/Left';
            }
        };
        toolbar.appendChild(arcDirectionBtn);

        // Drawing tools
        const tools = [
            { name: 'pencil', icon: Icons.pencil(), title: 'Draw Path (Motion)' },
            { name: 'orbit', icon: Icons.orbit(), title: 'Orbit (Click center, drag shape)' },
            { name: 'halfCircle', icon: Icons.halfCircle(), title: 'Arc (Click start, drag to end)' },
            { name: 'zoomBox', icon: Icons.zoomBox(), title: 'Zoom Box (Draw box, scroll to resize)' },
            { name: 'point', icon: Icons.pin(), title: 'Add Static Point (Anchor)' },
            { name: 'eraser', icon: Icons.trash(), title: 'Erase Path' },
            { name: 'select', icon: Icons.cursor(), title: 'Select Path' },
        ];

        const toolButtons = [];
        tools.forEach(tool => {
            const btn = this.createToolbarButton(tool.icon, tool.title, this.tool === tool.name);
            btn.dataset.tool = tool.name;
            btn.onclick = () => {
                if (this.tool === 'zoomBox' && this.zoomBoxState) finalizeZoomBox(this);
                this.tool = tool.name;
                const cursors = { point: 'crosshair', pencil: 'crosshair', eraser: 'not-allowed', select: 'pointer', orbit: 'crosshair', halfCircle: 'crosshair', zoomBox: 'crosshair' };
                this.canvas.style.cursor = cursors[tool.name] || 'crosshair';
                toolButtons.forEach(tb => {
                    const isActive = tb.dataset.tool === tool.name;
                    tb.style.border = `2px solid ${isActive ? '#4ECDC4' : 'rgba(255, 255, 255, 0.15)'}`;
                    tb.style.background = isActive ? 'rgba(78, 205, 196, 0.2)' : 'rgba(255, 255, 255, 0.05)';
                    tb.style.boxShadow = isActive ? '0 0 12px rgba(78, 205, 196, 0.3)' : 'none';
                });
            };
            toolButtons.push(btn);
            toolbar.appendChild(btn);
        });

        toolbar.appendChild(makeSeparator());

        // Manipulation tools
        const cloneBtn = this.createToolbarButton(Icons.clone(), 'Clone Selected Path');
        cloneBtn.onclick = () => cloneSelectedPath(this);
        toolbar.appendChild(cloneBtn);

        const flipHBtn = this.createToolbarButton(Icons.flipH(), 'Flip Horizontal');
        flipHBtn.onclick = () => flipSelectedPath(this, true);
        toolbar.appendChild(flipHBtn);

        const flipVBtn = this.createToolbarButton(Icons.flipV(), 'Flip Vertical');
        flipVBtn.onclick = () => flipSelectedPath(this, false);
        toolbar.appendChild(flipVBtn);

        toolbar.appendChild(makeSeparator());

        // View tools
        const resetViewBtn = this.createToolbarButton(Icons.reset(), 'Reset View (Zoom & Pan)');
        resetViewBtn.onclick = () => resetView(this);
        toolbar.appendChild(resetViewBtn);

        // Guide controls
        const guideLabel = document.createElement('div');
        guideLabel.textContent = 'Guides';
        guideLabel.style.cssText = `color: #888; font-size: 10px; text-align: center; font-weight: bold; margin-bottom: -4px;`;
        toolbar.appendChild(guideLabel);

        const guideSelect = document.createElement('select');
        guideSelect.style.cssText = `width: 100%; background: #333; color: white; border: 1px solid #555; border-radius: 4px; font-size: 11px; padding: 4px; margin-bottom: 4px;`;
        GUIDE_TYPES.forEach(g => {
            const option = document.createElement('option');
            option.value = g.value;
            option.textContent = g.text;
            guideSelect.appendChild(option);
        });
        guideSelect.onchange = (e) => {
            this.guideLayer.type = e.target.value;
            this.guideLayer.svgImage = null;
            this.render();
        };
        this.guideSelectElement = guideSelect; // B12 fix: store reference
        toolbar.appendChild(guideSelect);

        const loadSvgBtn = this.createToolbarButton(Icons.loadSvg(), 'Load SVG as Guide');
        loadSvgBtn.onclick = () => loadSVG(this);
        toolbar.appendChild(loadSvgBtn);

        const clearGuideBtn = this.createToolbarButton(Icons.broom(), 'Clear Guide Layer');
        clearGuideBtn.onclick = () => {
            this.guideLayer.type = 'none';
            this.guideLayer.svgImage = null;
            guideSelect.value = 'none';
            this.render();
        };
        toolbar.appendChild(clearGuideBtn);

        // Perimeter + clear
        const lockPerimeterBtn = this.createToolbarButton(Icons.lock(), 'Lock Perimeter');
        lockPerimeterBtn.onclick = () => this.lockPerimeter();
        toolbar.appendChild(lockPerimeterBtn);

        toolbar.appendChild(makeSeparator());

        const clearBtn = this.createToolbarButton(Icons.trash(), 'Clear All Paths');
        clearBtn.style.marginTop = 'auto';
        clearBtn.onclick = () => {
            if (confirm('Clear all paths?')) {
                this.paths = [];
                this.selectedPathIndex = -1;
                this.updateSidebar();
                this.render();
            }
        };
        toolbar.appendChild(clearBtn);

        parent.appendChild(toolbar);
    }

    loadImage() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                this.loadImageFromBlob(file);
            }
        };
        input.click();
    }

    clearImage() {
        if (confirm('Clear background image?')) {
            this.backgroundImage = null;
            this.originalBackgroundImage = null;
            this.backgroundImageFilename = null;
            this.pathsDataWidget._cachedBackgroundImage = null;
            this.canvas.width = this.frameWidth;
            this.canvas.height = this.frameHeight;
            this.render();
        }
    }

    lockPerimeter() {
        const numPoints = prompt('How many shapes around the perimeter?', '12');
        if (!numPoints || isNaN(numPoints) || numPoints < 1) return;
        const count = parseInt(numPoints);
        const w = this.canvas.width, h = this.canvas.height;
        const perimeter = 2 * (w + h);
        const spacing = perimeter / count;

        for (let i = 0; i < count; i++) {
            const d = i * spacing;
            let x, y;
            if (d < w) { x = d; y = 0; }
            else if (d < w + h) { x = w; y = d - w; }
            else if (d < 2 * w + h) { x = w - (d - w - h); y = h; }
            else { x = 0; y = h - (d - 2 * w - h); }

            this.paths.push({
                id: 'path_' + Date.now() + '_' + i,
                name: 'Perimeter ' + (i + 1),
                points: [{ x: Math.round(x), y: Math.round(y) }],
                color: this.getRandomColor(),
                isSinglePoint: true,
                startTime: 0.0, endTime: 1.0, interpolation: 'linear', visibilityMode: 'pop'
            });
        }
        this.updateSidebar();
        this.render();
    }

    createCanvasArea(parent) {
        const canvasContainer = document.createElement('div');
        canvasContainer.style.cssText = `flex: 1; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at center, #1e1e1e 0%, #0a0a0a 100%); position: relative; overflow: hidden; padding: 20px;`;

        this.canvas = document.createElement('canvas');
        this.canvas.width = this.frameWidth;
        this.canvas.height = this.frameHeight;
        this.canvas.style.cssText = `border: 1px solid #4a4a4a; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6); cursor: crosshair; max-width: 100%; max-height: 100%; border-radius: 4px;`;
        this.ctx = this.canvas.getContext('2d');

        this.setupCanvasEvents();
        canvasContainer.appendChild(this.canvas);
        parent.appendChild(canvasContainer);
        this.render();
    }

    setupCanvasEvents() {
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => onMouseWheel(this, e), { passive: false });
        this.canvas.addEventListener('contextmenu', (e) => onRightClick(this, e));
    }

    // --- Mouse handlers (B8 fix: all use transformed coords) ---

    onMouseDown(e) {
        // Middle mouse button for panning
        if (e.button === 1) {
            e.preventDefault();
            startPan(this, e);
            return;
        }

        // B8 fix: world-space coords for all tools
        const pos = getTransformedCoords(this, e);
        const rawPos = getCanvasCoords(this, e);
        this.dragStartPos = rawPos;

        if (this.isDrawing) return;

        // Tool-specific drawing
        if (this.tool === 'orbit') { onOrbitMouseDown(this, pos); return; }
        if (this.tool === 'halfCircle') { onArcMouseDown(this, pos); return; }
        if (this.tool === 'zoomBox') { onZoomBoxMouseDown(this, pos); return; }

        if (this.tool === 'pencil') {
            this.isDrawing = true;
            this.currentPath = {
                id: 'path_' + Date.now(), name: 'Path ' + (this.paths.length + 1),
                points: [pos], color: this.currentColor, isSinglePoint: false,
                startTime: 0.0, endTime: 1.0, interpolation: 'linear', visibilityMode: 'pop'
            };
            return;
        }

        if (this.tool === 'point') {
            const path = {
                id: 'path_' + Date.now(), name: 'Static ' + (this.paths.filter(p => p.isSinglePoint).length + 1),
                points: [pos], color: this.currentColor, isSinglePoint: true,
                startTime: 0.0, endTime: 1.0, interpolation: 'linear', visibilityMode: 'pop'
            };
            this.paths.push(path);
            this.selectedPathIndex = this.paths.length - 1;
            this.currentColor = this.getRandomColor();
            this.updateSidebar();
            this.render();
            return;
        }

        // Selection and dragging logic (B8 fix: use transformed coords for hit testing)
        let clickedItem = null;

        if (this.selectedPathIndex !== -1) {
            const selectedPath = this.paths[this.selectedPathIndex];
            if (!selectedPath.isSinglePoint) {
                for (const point of selectedPath.points) {
                    const dist = Math.sqrt(Math.pow(pos.x - point.x, 2) + Math.pow(pos.y - point.y, 2));
                    // B13 fix: threshold divided by scale
                    if (dist < 10 / this.scale) {
                        clickedItem = { type: 'point', point, path: selectedPath };
                        break;
                    }
                }
            }
        }

        if (!clickedItem) {
            // B8 fix: pass world-space coords to findPathAtPoint
            const pathIndex = this.findPathAtPoint(pos);
            if (pathIndex !== -1) {
                clickedItem = { type: 'path', path: this.paths[pathIndex], index: pathIndex };
            }
        }

        if (this.tool === 'select') {
            if (clickedItem) {
                this.isDragging = true;
                this.draggedItem = clickedItem;
                if (clickedItem.type === 'point') {
                    this.selectedPathIndex = this.paths.indexOf(clickedItem.path);
                    clickedItem.point._startPos = { x: clickedItem.point.x, y: clickedItem.point.y };
                } else if (clickedItem.type === 'path') {
                    this.selectedPathIndex = clickedItem.index;
                    clickedItem.path._startPoints = clickedItem.path.points.map(p => ({ x: p.x, y: p.y }));
                }
            } else {
                this.selectedPathIndex = -1;
            }
            this.updateSidebar();
            this.render();
        } else if (this.tool === 'eraser') {
            if (clickedItem && clickedItem.type === 'path') {
                this.paths.splice(clickedItem.index, 1);
                if (this.selectedPathIndex === clickedItem.index) this.selectedPathIndex = -1;
                this.updateSidebar();
                this.render();
            }
        }
    }

    onMouseMove(e) {
        // Panning
        if (this.isPanning) { updatePan(this, e); return; }

        // Dragging existing items
        if (this.isDragging && this.draggedItem) {
            const currentPos = getCanvasCoords(this, e);
            const dx = (currentPos.x - this.dragStartPos.x) / this.scale;
            const dy = (currentPos.y - this.dragStartPos.y) / this.scale;

            if (this.draggedItem.type === 'point') {
                const sp = this.draggedItem.point._startPos;
                const snapped = getSnappedCoords(this, { x: sp.x + dx, y: sp.y + dy });
                this.draggedItem.point.x = snapped.x;
                this.draggedItem.point.y = snapped.y;
            } else if (this.draggedItem.type === 'path') {
                this.draggedItem.path.points.forEach((p, i) => {
                    const sp = this.draggedItem.path._startPoints[i];
                    p.x = sp.x + dx;
                    p.y = sp.y + dy;
                });
            }
            this.render();
            return;
        }

        // Drawing actions
        if (this.isDrawing) {
            const currentPos = getTransformedCoords(this, e);

            if (this.tool === 'orbit' && this.orbitState) { onOrbitMouseMove(this, currentPos); return; }
            if (this.tool === 'halfCircle' && this.halfCircleState) { onArcMouseMove(this, currentPos); return; }
            if (this.tool === 'zoomBox') { onZoomBoxMouseMove(this, currentPos); return; }

            if (this.tool === 'pencil' && this.currentPath) {
                const pos = getSnappedCoords(this, currentPos);

                if (this.shiftPressed && this.currentPath.points.length > 0) {
                    const lastPoint = this.currentPath.points[this.currentPath.points.length - 1];
                    const dx = Math.abs(pos.x - lastPoint.x);
                    const dy = Math.abs(pos.y - lastPoint.y);
                    let constrainedPos;
                    if (dx > dy * 2) constrainedPos = { x: pos.x, y: lastPoint.y };
                    else if (dy > dx * 2) constrainedPos = { x: lastPoint.x, y: pos.y };
                    else {
                        const dist = Math.min(dx, dy);
                        constrainedPos = {
                            x: lastPoint.x + dist * Math.sign(pos.x - lastPoint.x),
                            y: lastPoint.y + dist * Math.sign(pos.y - lastPoint.y)
                        };
                    }
                    if (!this.shiftPreviewPoint) {
                        this.shiftPreviewPoint = true;
                        this.currentPath.points.push(constrainedPos);
                    } else {
                        this.currentPath.points[this.currentPath.points.length - 1] = constrainedPos;
                    }
                } else {
                    this.shiftPreviewPoint = false;
                    const lastPoint = this.currentPath.points[this.currentPath.points.length - 1];
                    const dist = Math.sqrt(Math.pow(pos.x - lastPoint.x, 2) + Math.pow(pos.y - lastPoint.y, 2));
                    if (dist > 3 / this.scale) this.currentPath.points.push(pos);
                }
                this.render();
            }
        }
    }

    onMouseUp(e) {
        if (this.isPanning) { stopPan(this); }

        if (this.isDragging) {
            this.isDragging = false;
            this.draggedItem = null;
            this.dragStartPos = null;
        }

        if (this.isDrawing) {
            this.isDrawing = false;

            if (this.tool === 'orbit' && this.orbitState) { onOrbitMouseUp(this); return; }
            if (this.tool === 'halfCircle' && this.halfCircleState) { onArcMouseUp(this); return; }
            if (this.tool === 'zoomBox' && this.zoomBoxState) { onZoomBoxMouseUp(this); return; }

            if (this.tool === 'pencil' && this.currentPath) {
                this.shiftPreviewPoint = false;
                if (this.currentPath.points.length > 1) {
                    this.paths.push(this.currentPath);
                    this.selectedPathIndex = this.paths.length - 1;
                    this.currentColor = this.getRandomColor();
                    this.updateSidebar();
                } else if (this.currentPath.points.length === 1) {
                    this.currentPath.isSinglePoint = true;
                    this.currentPath.name = 'Static ' + (this.paths.filter(p => p.isSinglePoint).length + 1);
                    this.paths.push(this.currentPath);
                    this.selectedPathIndex = this.paths.length - 1;
                    this.currentColor = this.getRandomColor();
                    this.updateSidebar();
                }
                this.currentPath = null;
                this.render();
            }
        }
    }

    // B8+B13 fix: findPathAtPoint operates in world space with zoom-adjusted threshold
    findPathAtPoint(point, baseThreshold = 10) {
        const renderScale = this.getRenderScale();
        // B13 fix: threshold accounts for zoom level
        const threshold = (baseThreshold * renderScale) / this.scale;

        for (let i = this.paths.length - 1; i >= 0; i--) {
            const path = this.paths[i];
            if (path.isSinglePoint || path.points.length === 1) {
                const p = path.points[0];
                const dist = Math.sqrt(Math.pow(point.x - p.x, 2) + Math.pow(point.y - p.y, 2));
                if (dist < threshold) return i;
            }
        }

        for (let i = this.paths.length - 1; i >= 0; i--) {
            const path = this.paths[i];
            if (!path.isSinglePoint && path.points.length > 1) {
                for (let j = 0; j < path.points.length - 1; j++) {
                    const dist = this.distanceToSegment(point, path.points[j], path.points[j + 1]);
                    if (dist < threshold) return i;
                }
            }
        }
        return -1;
    }

    distanceToSegment(point, p1, p2) {
        const A = point.x - p1.x, B = point.y - p1.y;
        const C = p2.x - p1.x, D = p2.y - p1.y;
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = lenSq !== 0 ? dot / lenSq : -1;

        let xx, yy;
        if (param < 0) { xx = p1.x; yy = p1.y; }
        else if (param > 1) { xx = p2.x; yy = p2.y; }
        else { xx = p1.x + param * C; yy = p1.y + param * D; }

        return Math.sqrt(Math.pow(point.x - xx, 2) + Math.pow(point.y - yy, 2));
    }

    getRenderScale() {
        const baseResolution = 512;
        return Math.min(this.canvas.width, this.canvas.height) / baseResolution;
    }

    render() {
        if (!this.ctx) return;

        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Apply pan/zoom transform
        applyTransform(this);

        // Background
        if (this.backgroundImage && this.backgroundImage.complete) {
            this.ctx.globalAlpha = this.backgroundOpacity;
            this.ctx.drawImage(this.backgroundImage, 0, 0, this.canvas.width, this.canvas.height);
            this.ctx.globalAlpha = 1.0;
        } else {
            this.ctx.fillStyle = '#1a1a1a';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // Grid (B14 fix applied in module)
        drawGrid(this);

        // Guide layer
        renderGuideLayer(this);

        // Paths
        this.paths.forEach((path, index) => {
            this.drawPath(path, index === this.selectedPathIndex);
        });
        if (this.currentPath) this.drawPath(this.currentPath, true);

        // Tool previews
        if (this.tool === 'zoomBox' && this.zoomBoxState) renderZoomBoxPreview(this);
        if (this.tool === 'orbit' && this.isDrawing && this.orbitState) renderOrbitPreview(this);
        if (this.tool === 'halfCircle' && this.isDrawing && this.halfCircleState) renderArcPreview(this);

        this.ctx.restore();
    }

    drawPath(path, isSelected = false) {
        const isSinglePoint = path.isSinglePoint || path.points.length === 1;
        const scale = this.getRenderScale();
        const neonGreen = '#00FF41';

        if (isSinglePoint) {
            const point = path.points[0];
            const size = (isSelected ? 14 : 8) * scale;
            this.ctx.fillStyle = isSelected ? neonGreen : path.color;
            this.ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
            this.ctx.strokeStyle = isSelected ? neonGreen : '#fff';
            this.ctx.lineWidth = 2 * scale;
            this.ctx.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
            if (isSelected) {
                this.ctx.fillStyle = neonGreen;
                this.ctx.font = `bold ${12 * scale}px sans-serif`;
                this.ctx.fillText('Static', point.x + 10 * scale, point.y - 10 * scale);
            }
        } else if (path.points.length >= 2) {
            this.ctx.beginPath();
            this.ctx.moveTo(path.points[0].x, path.points[0].y);
            for (let i = 1; i < path.points.length; i++) this.ctx.lineTo(path.points[i].x, path.points[i].y);
            this.ctx.strokeStyle = isSelected ? neonGreen : path.color;
            this.ctx.lineWidth = (isSelected ? this.pathThickness + 0.1 : this.pathThickness) * scale;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.stroke();

            // Animated directional flow
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.moveTo(path.points[0].x, path.points[0].y);
            for (let i = 1; i < path.points.length; i++) this.ctx.lineTo(path.points[i].x, path.points[i].y);
            const dashLen = 10 * scale;
            this.ctx.setLineDash([dashLen, dashLen]);
            this.ctx.lineDashOffset = -this.animationOffset * scale;
            this.ctx.strokeStyle = isSelected ? 'rgba(0, 255, 65, 0.8)' : 'rgba(255, 255, 255, 0.6)';
            this.ctx.lineWidth = Math.max(1, this.pathThickness * 0.5) * scale;
            this.ctx.stroke();
            this.ctx.restore();

            if (isSelected) {
                path.points.forEach((point, idx) => {
                    this.ctx.beginPath();
                    this.ctx.arc(point.x, point.y, Math.max(6, this.pathThickness + 2) * scale, 0, Math.PI * 2);
                    this.ctx.fillStyle = neonGreen;
                    this.ctx.fill();
                    this.ctx.beginPath();
                    this.ctx.arc(point.x, point.y, Math.max(3, this.pathThickness * 0.6) * scale, 0, Math.PI * 2);
                    this.ctx.fillStyle = '#000';
                    this.ctx.fill();
                    if (path.points.length < 20) {
                        this.ctx.fillStyle = neonGreen;
                        this.ctx.font = `bold ${10 * scale}px sans-serif`;
                        this.ctx.fillText(idx, point.x + 8 * scale, point.y - 8 * scale);
                    }
                });
                const midPoint = path.points[Math.floor(path.points.length / 2)];
                this.ctx.fillStyle = neonGreen;
                this.ctx.font = `bold ${12 * scale}px sans-serif`;
                this.ctx.fillText(`Motion (${path.points.length} pts)`, midPoint.x + 10 * scale, midPoint.y - 10 * scale);
            }
        }
    }

    createSidebar(parent) {
        this.sidebar = document.createElement('div');
        this.sidebar.style.cssText = `width: 280px; background: #1e1e1e; border-left: 1px solid #444; padding: 15px; overflow-y: auto;`;

        const title = document.createElement('h3');
        title.textContent = 'Paths';
        title.style.cssText = `margin: 0 0 15px 0; color: #fff; font-size: 14px; font-weight: 500;`;
        this.sidebar.appendChild(title);

        this.pathList = document.createElement('div');
        this.pathList.style.cssText = `display: flex; flex-direction: column; gap: 8px;`;
        this.sidebar.appendChild(this.pathList);
        parent.appendChild(this.sidebar);
        this.updateSidebar();
    }

    updateSidebar() {
        if (!this.pathList) return;

        // B10 fix: clean up tracked document listeners before rebuild
        this._removeAllDocumentListeners();

        this.pathList.innerHTML = '';
        this.paths.forEach((path, index) => {
            const isSinglePoint = path.isSinglePoint || path.points.length === 1;
            const neonGreen = '#00FF41';
            const isSelected = index === this.selectedPathIndex;

            const item = document.createElement('div');
            item.style.cssText = `padding: 10px; background: ${isSelected ? 'rgba(0, 255, 65, 0.15)' : '#2b2b2b'}; border: 2px solid ${isSelected ? neonGreen : '#444'}; border-radius: 4px; cursor: pointer; color: #fff; font-size: 12px; display: flex; flex-direction: column; gap: 6px; transition: all 0.2s ease;`;

            const topRow = document.createElement('div');
            topRow.style.cssText = `display: flex; justify-content: space-between; align-items: center;`;

            const info = document.createElement('div');
            info.style.cssText = `display: flex; align-items: center; gap: 8px; flex: 1;`;

            const colorBox = document.createElement('div');
            colorBox.style.cssText = `width: 16px; height: 16px; background: ${isSelected ? neonGreen : path.color}; border-radius: ${isSinglePoint ? '2px' : '50%'}; border: 2px solid ${isSelected ? neonGreen : (isSinglePoint ? '#fff' : 'transparent')};`;

            const nameContainer = document.createElement('div');
            nameContainer.style.cssText = `display: flex; flex-direction: column; gap: 2px;`;

            const name = document.createElement('span');
            name.textContent = path.name || `Path ${index + 1}`;
            name.style.cssText = `font-weight: 500; color: ${isSelected ? neonGreen : '#fff'};`;

            const typeLabel = document.createElement('span');
            typeLabel.innerHTML = isSinglePoint
                ? `${Icons.target()} <span style="margin-left: 4px;">Static (1 pt)</span>`
                : `${Icons.arrowRight()} <span style="margin-left: 4px;">Motion (${path.points.length} pts)</span>`;
            typeLabel.style.cssText = `font-size: 10px; color: ${isSelected ? neonGreen : (isSinglePoint ? '#F7DC6F' : '#4ECDC4')}; display: flex; align-items: center;`;

            nameContainer.appendChild(name);
            nameContainer.appendChild(typeLabel);
            info.appendChild(colorBox);
            info.appendChild(nameContainer);

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '\u2715';
            deleteBtn.style.cssText = `background: rgba(255, 77, 77, 0.2); border: 1px solid rgba(255, 77, 77, 0.4); border-radius: 4px; color: #ff4d4d; cursor: pointer; font-size: 14px; padding: 4px 8px; transition: all 0.2s ease;`;
            deleteBtn.onmouseover = () => { deleteBtn.style.background = 'rgba(255, 77, 77, 0.4)'; };
            deleteBtn.onmouseout = () => { deleteBtn.style.background = 'rgba(255, 77, 77, 0.2)'; };
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                this.paths.splice(index, 1);
                this.selectedPathIndex = -1;
                this.updateSidebar();
                this.render();
            };

            topRow.appendChild(info);
            topRow.appendChild(deleteBtn);
            item.appendChild(topRow);

            if (isSelected) {
                const controls = this.createTimelineControls(path, index);
                item.appendChild(controls);
            }

            item.onclick = (e) => {
                if (e.target.closest('.timeline-controls')) return;
                this.selectedPathIndex = index;
                this.updateSidebar();
                this.render();
            };

            this.pathList.appendChild(item);
        });
    }

    createTimelineControls(path, pathIndex) {
        const container = document.createElement('div');
        container.className = 'timeline-controls';
        container.style.cssText = `margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.1); display: flex; flex-direction: column; gap: 12px;`;

        // Timeline range slider
        const timelineSection = document.createElement('div');
        timelineSection.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;

        const timelineLabel = document.createElement('label');
        timelineLabel.textContent = 'Timeline Range';
        timelineLabel.style.cssText = `color: #fff; font-size: 11px; font-weight: 500; opacity: 0.9;`;

        const timelineSliderContainer = document.createElement('div');
        timelineSliderContainer.style.cssText = `position: relative; height: 40px; background: rgba(0, 0, 0, 0.3); border-radius: 4px; padding: 8px;`;

        const rangeTrack = document.createElement('div');
        rangeTrack.style.cssText = `position: absolute; left: 8px; right: 8px; top: 50%; transform: translateY(-50%); height: 6px; background: rgba(255, 255, 255, 0.1); border-radius: 3px;`;

        const startPercent = (path.startTime || 0) * 100;
        const endPercent = (path.endTime || 1) * 100;

        const activeRange = document.createElement('div');
        activeRange.style.cssText = `position: absolute; left: ${startPercent}%; width: ${endPercent - startPercent}%; height: 100%; background: #4ECDC4; border-radius: 3px;`;
        rangeTrack.appendChild(activeRange);

        const startHandle = this.createRangeHandle('Start', startPercent, true);
        const endHandle = this.createRangeHandle('End', endPercent, false);

        // B10 fix: use tracked listeners
        this.setupRangeHandleDrag(startHandle, endHandle, activeRange, path, pathIndex, true);
        this.setupRangeHandleDrag(endHandle, startHandle, activeRange, path, pathIndex, false);

        timelineSliderContainer.appendChild(rangeTrack);
        timelineSliderContainer.appendChild(startHandle);
        timelineSliderContainer.appendChild(endHandle);

        const valuesDisplay = document.createElement('div');
        valuesDisplay.style.cssText = `display: flex; justify-content: space-between; font-size: 10px; color: #888; margin-top: 4px;`;
        valuesDisplay.innerHTML = `<span>Start: ${Math.round(startPercent)}%</span><span>End: ${Math.round(endPercent)}%</span>`;

        timelineSection.appendChild(timelineLabel);
        timelineSection.appendChild(timelineSliderContainer);
        timelineSection.appendChild(valuesDisplay);

        // Dropdowns
        const makeDropdown = (labelText, options, currentValue, onChangeHandler) => {
            const section = document.createElement('div');
            section.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
            const lbl = document.createElement('label');
            lbl.textContent = labelText;
            lbl.style.cssText = `color: #fff; font-size: 11px; font-weight: 500; opacity: 0.9;`;
            const sel = document.createElement('select');
            sel.style.cssText = `background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; color: #fff; padding: 6px; font-size: 11px; cursor: pointer;`;
            options.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.value; o.textContent = opt.label;
                o.selected = currentValue === opt.value;
                sel.appendChild(o);
            });
            sel.onchange = (e) => { e.stopPropagation(); onChangeHandler(e.target.value); };
            section.appendChild(lbl);
            section.appendChild(sel);
            return section;
        };

        const interpSection = makeDropdown('Interpolation', [
            { value: 'linear', label: 'Linear' }, { value: 'ease-in', label: 'Ease In' },
            { value: 'ease-out', label: 'Ease Out' }, { value: 'ease-in-out', label: 'Ease In-Out' }
        ], path.interpolation || 'linear', (v) => { path.interpolation = v; this.savePaths(); });

        const visSection = makeDropdown('Visibility Mode', [
            { value: 'pop', label: 'Pop (Appear/Disappear)' }, { value: 'static', label: 'Static (Always Visible)' }
        ], path.visibilityMode || 'pop', (v) => { path.visibilityMode = v; this.savePaths(); });

        container.appendChild(timelineSection);
        container.appendChild(interpSection);
        container.appendChild(visSection);

        // Motion direction (for multi-point paths)
        if (!path.isSinglePoint && path.points.length > 1) {
            const dirSection = makeDropdown('Motion Direction', [
                { value: 'cw', label: 'Clockwise' }, { value: 'ccw', label: 'Counter-Clockwise' }
            ], path.direction || 'cw', (v) => {
                const old = path.direction || 'cw';
                if (v !== old) {
                    reversePathPoints(path);
                    path.direction = v;
                    this.savePaths();
                    this.render();
                }
            });
            container.appendChild(dirSection);
        }

        // Point count for generated paths (orbit/arc)
        if (path.generationParams) {
            const pcSection = document.createElement('div');
            pcSection.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
            const pcLabel = document.createElement('label');
            pcLabel.textContent = 'Point Count (Granularity)';
            pcLabel.style.cssText = `color: #fff; font-size: 11px; font-weight: 500; opacity: 0.9;`;
            const pcInput = document.createElement('input');
            pcInput.type = 'number'; pcInput.min = 2; pcInput.max = 500;
            pcInput.value = path.generationParams.numPoints || 20;
            pcInput.style.cssText = `background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; color: #fff; padding: 6px; font-size: 11px; width: 70px;`;
            pcInput.onchange = (e) => {
                e.stopPropagation();
                let count = parseInt(e.target.value);
                if (isNaN(count) || count < 2) count = 2;
                path.generationParams.numPoints = count;
                if (path.generationParams.type === 'orbit') {
                    path.points = generateEllipsePoints(path.generationParams.state, path.direction, count);
                } else if (path.generationParams.type === 'arc') {
                    const arcDir = (path.direction === 'cw') ? 'down' : 'up';
                    path.points = generateArcPoints(path.generationParams.state, arcDir, count);
                }
                this.savePaths();
                this.updateSidebar();
                this.render();
            };
            pcSection.appendChild(pcLabel);
            pcSection.appendChild(pcInput);
            container.appendChild(pcSection);
        }

        return container;
    }

    createRangeHandle(label, position, isStart) {
        const handle = document.createElement('div');
        handle.style.cssText = `position: absolute; left: ${position}%; top: 50%; transform: translate(-50%, -50%); width: 16px; height: 16px; background: #4ECDC4; border: 2px solid #fff; border-radius: 50%; cursor: ${isStart ? 'e-resize' : 'w-resize'}; z-index: 10; transition: transform 0.1s ease;`;
        handle.onmouseover = () => { handle.style.transform = 'translate(-50%, -50%) scale(1.2)'; };
        handle.onmouseout = () => { handle.style.transform = 'translate(-50%, -50%) scale(1)'; };
        handle.dataset.label = label;
        return handle;
    }

    // B10 fix: uses tracked document listeners
    setupRangeHandleDrag(handle, otherHandle, activeRange, path, pathIndex, isStart) {
        let isDragging = false;
        let container = null;

        const onMouseDown = (e) => {
            e.stopPropagation();
            isDragging = true;
            container = handle.parentElement;
            document.body.style.cursor = isStart ? 'e-resize' : 'w-resize';
        };

        const onMouseMove = (e) => {
            if (!isDragging || !container) return;
            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
            const otherPercent = parseFloat(otherHandle.style.left);
            const constrainedPercent = isStart ? Math.min(percent, otherPercent - 1) : Math.max(percent, otherPercent + 1);

            handle.style.left = `${constrainedPercent}%`;
            const sp = isStart ? constrainedPercent : parseFloat(otherHandle.style.left);
            const ep = isStart ? parseFloat(otherHandle.style.left) : constrainedPercent;
            activeRange.style.left = `${sp}%`;
            activeRange.style.width = `${ep - sp}%`;

            if (isStart) path.startTime = constrainedPercent / 100;
            else path.endTime = constrainedPercent / 100;

            const valuesDisplay = container.parentElement.querySelector('div:last-child');
            if (valuesDisplay) valuesDisplay.innerHTML = `<span>Start: ${Math.round(sp)}%</span><span>End: ${Math.round(ep)}%</span>`;
        };

        const onMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = '';
                this.savePaths();
            }
        };

        handle.addEventListener('mousedown', onMouseDown);
        // B10 fix: track document listeners for cleanup
        this._addDocumentListener('mousemove', onMouseMove);
        this._addDocumentListener('mouseup', onMouseUp);
    }

    createFooter() {
        const footer = document.createElement('div');
        footer.style.cssText = `padding: 15px 20px; border-top: 1px solid #444; display: flex; justify-content: space-between; align-items: center; gap: 10px;`;

        const statsContainer = document.createElement('div');
        statsContainer.style.cssText = `color: #888; font-size: 12px;`;
        const staticCount = this.paths.filter(p => p.isSinglePoint || p.points.length === 1).length;
        const motionCount = this.paths.length - staticCount;
        statsContainer.textContent = `Total: ${this.paths.length} paths (${staticCount} static, ${motionCount} motion)`;

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `display: flex; gap: 10px;`;

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `padding: 8px 20px; background: #444; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-size: 14px;`;
        cancelBtn.onclick = () => this.close();

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save Paths';
        saveBtn.style.cssText = `padding: 8px 20px; background: #4ECDC4; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-size: 14px; font-weight: 500;`;
        saveBtn.onclick = () => { this.savePaths(); this.close(); };

        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(saveBtn);
        footer.appendChild(statsContainer);
        footer.appendChild(buttonContainer);
        this.container.appendChild(footer);
    }

    show() {
        if (!document.getElementById('fl-path-animator-styles')) {
            const style = document.createElement('style');
            style.id = 'fl-path-animator-styles';
            style.textContent = `
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideIn { from { opacity: 0; transform: scale(0.95) translateY(-20px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            `;
            document.head.appendChild(style);
        }
        document.body.appendChild(this.overlay);
        this.attachPasteListener();
        setTimeout(() => { this.container.focus(); }, 100);
    }

    close() {
        this.stopAnimation();

        document.removeEventListener('keydown', this.keydownHandler);
        document.removeEventListener('keyup', this.keyupHandler);

        // B10 fix: remove all tracked document listeners
        this._removeAllDocumentListeners();

        if (this.container) this.container.removeEventListener('paste', this.pasteHandler);
        document.removeEventListener('paste', this.pasteHandler);

        this.overlay.style.animation = 'fadeIn 0.15s ease-in reverse';
        this.container.style.animation = 'slideIn 0.15s ease-in reverse';
        setTimeout(() => {
            if (this.overlay.parentNode) document.body.removeChild(this.overlay);
        }, 150);
    }
}
