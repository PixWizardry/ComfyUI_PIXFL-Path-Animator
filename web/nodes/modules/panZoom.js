/**
 * Pan & Zoom module for the Path Animator editor.
 * B8 fix: All mouse handlers use getTransformedCoords() for world-space coords.
 * B13 fix: Hit threshold divided by this.scale.
 */

export const PAN_ZOOM_DEFAULTS = {
    scale: 1.0,
    panOffsetX: 0,
    panOffsetY: 0,
    isPanning: false,
    lastMousePos: { x: 0, y: 0 },
};

/**
 * Get canvas-space coordinates from a mouse event (accounts for CSS scaling).
 */
export function getCanvasCoords(self, e) {
    const rect = self.canvas.getBoundingClientRect();
    const scaleX = self.canvas.width / rect.width;
    const scaleY = self.canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
    };
}

/**
 * Get world-space (transformed) coordinates from a mouse event.
 * B8 fix: inverse of the pan/zoom transform.
 */
export function getTransformedCoords(self, e) {
    const rawPos = getCanvasCoords(self, e);
    return {
        x: (rawPos.x - self.panOffsetX) / self.scale,
        y: (rawPos.y - self.panOffsetY) / self.scale,
    };
}

/**
 * Handle mouse wheel for zoom (Ctrl+scroll) or tool-specific actions.
 */
export function onMouseWheel(self, e) {
    e.preventDefault();

    if (e.ctrlKey) {
        // Zoom towards cursor
        const rawMousePos = getCanvasCoords(self, e);
        const zoomIntensity = 0.1;
        const scaleFactor = e.deltaY > 0 ? 1 - zoomIntensity : 1 + zoomIntensity;
        const newScale = Math.max(0.1, Math.min(10, self.scale * scaleFactor));

        self.panOffsetX = rawMousePos.x - (rawMousePos.x - self.panOffsetX) * (newScale / self.scale);
        self.panOffsetY = rawMousePos.y - (rawMousePos.y - self.panOffsetY) * (newScale / self.scale);
        self.scale = newScale;
        self.render();
    } else if (self.tool === 'zoomBox' && self.zoomBoxState && self.zoomBoxState.rect) {
        // Delegate to zoom box tool
        const { onZoomBoxWheel } = self._zoomBoxTool || {};
        if (onZoomBoxWheel) onZoomBoxWheel(self, e);
    }
}

/**
 * Start panning on middle mouse button.
 */
export function startPan(self, e) {
    self.isPanning = true;
    self.lastMousePos = getCanvasCoords(self, e);
    self.canvas.style.cursor = 'grabbing';
}

/**
 * Update pan offset during drag.
 */
export function updatePan(self, e) {
    const currentPos = getCanvasCoords(self, e);
    const dx = currentPos.x - self.lastMousePos.x;
    const dy = currentPos.y - self.lastMousePos.y;
    self.panOffsetX += dx;
    self.panOffsetY += dy;
    self.lastMousePos = currentPos;
    self.render();
}

/**
 * Stop panning.
 */
export function stopPan(self) {
    self.isPanning = false;
    self.canvas.style.cursor = 'crosshair';
}

/**
 * Reset pan and zoom to defaults.
 */
export function resetView(self) {
    self.scale = 1.0;
    self.panOffsetX = 0;
    self.panOffsetY = 0;
    self.render();
}

/**
 * Apply pan/zoom transform to the canvas context before drawing.
 */
export function applyTransform(self) {
    self.ctx.translate(self.panOffsetX, self.panOffsetY);
    self.ctx.scale(self.scale, self.scale);
}
