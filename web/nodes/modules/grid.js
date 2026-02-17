/**
 * Grid rendering and snap-to-grid module.
 * B14 fix: Grid draws across visible world-space bounds (computed from inverse transform).
 */

export const GRID_DEFAULTS = {
    showGrid: true,
    snapToGrid: false,
    gridSize: 50,
    gridColor: '#808080',
    gridOpacity: 50, // 0-100
};

/**
 * Draw grid lines across the visible world-space area.
 * B14 fix: computes visible bounds from inverse transform so grid doesn't disappear when panned.
 */
export function drawGrid(self) {
    if (!self.showGrid || self.gridSize <= 0) return;

    const hex = self.gridColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const opacity = self.gridOpacity / 100;

    self.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
    self.ctx.lineWidth = 1 / self.scale; // Keep line width consistent regardless of zoom

    // B14 fix: compute visible world-space bounds
    const visibleLeft = -self.panOffsetX / self.scale;
    const visibleTop = -self.panOffsetY / self.scale;
    const visibleRight = (self.canvas.width - self.panOffsetX) / self.scale;
    const visibleBottom = (self.canvas.height - self.panOffsetY) / self.scale;

    // Snap to grid boundaries
    const startX = Math.floor(visibleLeft / self.gridSize) * self.gridSize;
    const startY = Math.floor(visibleTop / self.gridSize) * self.gridSize;
    const endX = Math.ceil(visibleRight / self.gridSize) * self.gridSize;
    const endY = Math.ceil(visibleBottom / self.gridSize) * self.gridSize;

    self.ctx.beginPath();
    for (let x = startX; x <= endX; x += self.gridSize) {
        self.ctx.moveTo(x + 0.5 / self.scale, visibleTop);
        self.ctx.lineTo(x + 0.5 / self.scale, visibleBottom);
    }
    for (let y = startY; y <= endY; y += self.gridSize) {
        self.ctx.moveTo(visibleLeft, y + 0.5 / self.scale);
        self.ctx.lineTo(visibleRight, y + 0.5 / self.scale);
    }
    self.ctx.stroke();
}

/**
 * Snap coordinates to the nearest grid point if snap is enabled.
 */
export function getSnappedCoords(self, pos) {
    if (!self.snapToGrid || self.gridSize <= 0) {
        return pos;
    }
    return {
        x: Math.round(pos.x / self.gridSize) * self.gridSize,
        y: Math.round(pos.y / self.gridSize) * self.gridSize,
    };
}
