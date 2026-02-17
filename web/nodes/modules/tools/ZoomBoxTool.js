/**
 * Zoom Box Tool - draw a rectangle, scroll to resize, corners become motion paths.
 * B15 fix: finalize on Escape.
 */

/**
 * Get the four corner points of a rectangle.
 */
export function getRectCorners(rect) {
    return [
        { x: rect.x, y: rect.y },                     // TL
        { x: rect.x + rect.w, y: rect.y },             // TR
        { x: rect.x, y: rect.y + rect.h },             // BL
        { x: rect.x + rect.w, y: rect.y + rect.h },    // BR
    ];
}

/**
 * Handle zoom box mousedown - start drawing the rectangle.
 */
export function onZoomBoxMouseDown(self, pos) {
    if (self.zoomBoxState) finalizeZoomBox(self);
    self.isDrawing = true;
    self.zoomBoxState = {
        start: pos,
        rect: null,
        cornerPaths: [[], [], [], []],
    };
}

/**
 * Handle zoom box mousemove - update the rectangle.
 */
export function onZoomBoxMouseMove(self, currentPos) {
    if (!self.zoomBoxState) return;
    self.zoomBoxState.rect = {
        x: Math.min(self.zoomBoxState.start.x, currentPos.x),
        y: Math.min(self.zoomBoxState.start.y, currentPos.y),
        w: Math.abs(self.zoomBoxState.start.x - currentPos.x),
        h: Math.abs(self.zoomBoxState.start.y - currentPos.y),
    };
    self.render();
}

/**
 * Handle zoom box mouseup - lock the initial rectangle, enable scroll resizing.
 */
export function onZoomBoxMouseUp(self) {
    self.isDrawing = false;
    if (self.zoomBoxState && self.zoomBoxState.rect &&
        self.zoomBoxState.rect.w > 5 && self.zoomBoxState.rect.h > 5) {
        const initialPoints = getRectCorners(self.zoomBoxState.rect);
        self.zoomBoxState.cornerPaths[0].push(initialPoints[0]);
        self.zoomBoxState.cornerPaths[1].push(initialPoints[1]);
        self.zoomBoxState.cornerPaths[2].push(initialPoints[2]);
        self.zoomBoxState.cornerPaths[3].push(initialPoints[3]);
    } else {
        self.zoomBoxState = null;
    }
    self.render();
}

/**
 * Handle scroll wheel while zoom box is active - resize the box.
 */
export function onZoomBoxWheel(self, e) {
    if (!self.zoomBoxState || !self.zoomBoxState.rect) return;

    const zoomFactor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
    const rect = self.zoomBoxState.rect;
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;
    const newWidth = rect.w * zoomFactor;
    const newHeight = rect.h * zoomFactor;

    self.zoomBoxState.rect = {
        w: newWidth,
        h: newHeight,
        x: centerX - newWidth / 2,
        y: centerY - newHeight / 2,
    };

    const newPoints = getRectCorners(self.zoomBoxState.rect);
    self.zoomBoxState.cornerPaths[0].push(newPoints[0]);
    self.zoomBoxState.cornerPaths[1].push(newPoints[1]);
    self.zoomBoxState.cornerPaths[2].push(newPoints[2]);
    self.zoomBoxState.cornerPaths[3].push(newPoints[3]);

    self.render();
}

/**
 * Finalize the zoom box - create 4 motion paths from corner trajectories.
 * B15 fix: also called from Escape handler.
 */
export function finalizeZoomBox(self) {
    if (!self.zoomBoxState || self.zoomBoxState.cornerPaths[0].length < 2) {
        self.zoomBoxState = null;
        self.render();
        return;
    }

    const pathNames = ["Zoom TL", "Zoom TR", "Zoom BL", "Zoom BR"];
    self.zoomBoxState.cornerPaths.forEach((points, i) => {
        const newPath = {
            id: 'path_' + Date.now() + '_' + i,
            name: `${pathNames[i]} (${self.paths.length + 1})`,
            points: points,
            color: self.getRandomColor(),
            isSinglePoint: false,
            startTime: 0.0,
            endTime: 1.0,
            interpolation: 'linear',
            visibilityMode: 'pop',
        };
        self.paths.push(newPath);
    });

    self.zoomBoxState = null;
    self.updateSidebar();
    self.render();
}

/**
 * Render zoom box preview (rectangle + corner path trails).
 */
export function renderZoomBoxPreview(self) {
    if (!self.zoomBoxState) return;

    if (self.zoomBoxState.rect) {
        self.ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
        self.ctx.lineWidth = 2 / self.scale;
        self.ctx.setLineDash([5 / self.scale, 5 / self.scale]);
        const r = self.zoomBoxState.rect;
        self.ctx.strokeRect(r.x, r.y, r.w, r.h);
        self.ctx.setLineDash([]);
    }

    if (self.zoomBoxState.cornerPaths) {
        self.ctx.lineWidth = 2 / self.scale;
        self.ctx.lineCap = 'round';
        self.ctx.lineJoin = 'round';
        const colors = ['#ff6b6b', '#4ecdc4', '#f7dc6f', '#bb8fce'];
        self.zoomBoxState.cornerPaths.forEach((pathPoints, i) => {
            if (pathPoints.length > 1) {
                self.ctx.strokeStyle = colors[i % colors.length];
                self.ctx.beginPath();
                self.ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
                for (let j = 1; j < pathPoints.length; j++) {
                    self.ctx.lineTo(pathPoints[j].x, pathPoints[j].y);
                }
                self.ctx.stroke();
            }
        });
    }
}

/**
 * Handle right-click to finalize zoom box.
 */
export function onRightClick(self, e) {
    e.preventDefault();
    if (self.tool === 'zoomBox' && self.zoomBoxState) {
        finalizeZoomBox(self);
        const selectToolButton = self.container.querySelector('button[data-tool="select"]');
        if (selectToolButton) selectToolButton.click();
    }
}
