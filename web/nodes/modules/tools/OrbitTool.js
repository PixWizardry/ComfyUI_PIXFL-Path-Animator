/**
 * Orbit Tool - generates elliptical motion paths.
 * B11 fix: guard against undefined endPoint on rapid click.
 */

/**
 * Generate ellipse points from orbit state.
 * B11 fix: returns empty array if endPoint is undefined.
 */
export function generateEllipsePoints(orbitState, direction = 'cw', numPoints = 20) {
    const { center, rx, ry, endPoint } = orbitState;

    // B11 fix: guard against rapid click without mousemove
    if (!endPoint) return [];
    if (rx === 0 && ry === 0) return [];

    const startAngle = Math.atan2(endPoint.y - center.y, endPoint.x - center.x);
    const angleStep = (2 * Math.PI) / numPoints;
    const directionMultiplier = (direction === 'cw') ? 1 : -1;

    const points = [];
    for (let i = 0; i < numPoints; i++) {
        const angle = startAngle + (i * angleStep * directionMultiplier);
        points.push({
            x: center.x + rx * Math.cos(angle),
            y: center.y + ry * Math.sin(angle),
        });
    }
    // Close the loop
    points.push(points[0]);
    return points;
}

/**
 * Handle orbit tool mousedown - sets the orbit center.
 */
export function onOrbitMouseDown(self, pos) {
    self.isDrawing = true;
    self.orbitState = {
        center: pos,
        rx: 0,
        ry: 0,
    };
    self.render();
}

/**
 * Handle orbit tool mousemove - updates radii.
 */
export function onOrbitMouseMove(self, currentPos) {
    if (!self.orbitState) return;
    self.orbitState.rx = Math.abs(currentPos.x - self.orbitState.center.x);
    self.orbitState.ry = Math.abs(currentPos.y - self.orbitState.center.y);
    self.orbitState.endPoint = currentPos;
    self.render();
}

/**
 * Handle orbit tool mouseup - finalize the orbit path.
 */
export function onOrbitMouseUp(self) {
    if (!self.orbitState) return;

    if (self.orbitState.rx > 5 || self.orbitState.ry > 5) {
        const numPoints = 20;
        const points = generateEllipsePoints(self.orbitState, self.orbitDirection, numPoints);

        if (points.length > 0) {
            const newPath = {
                id: 'path_' + Date.now(),
                name: 'Orbit ' + (self.paths.length + 1),
                points: points,
                color: self.currentColor,
                isSinglePoint: false,
                direction: self.orbitDirection,
                generationParams: {
                    type: 'orbit',
                    state: { ...self.orbitState },
                    numPoints: numPoints,
                },
                startTime: 0.0,
                endTime: 1.0,
                interpolation: 'linear',
                visibilityMode: 'pop',
            };
            self.paths.push(newPath);
            self.selectedPathIndex = self.paths.length - 1;
            self.currentColor = self.getRandomColor();
            self.updateSidebar();
        }
    }
    self.orbitState = null;
    self.render();
}

/**
 * Render orbit preview (center point + ellipse outline).
 */
export function renderOrbitPreview(self) {
    if (!self.orbitState) return;
    const { center, rx, ry } = self.orbitState;

    // Center point
    self.ctx.fillStyle = self.currentColor;
    self.ctx.beginPath();
    self.ctx.arc(center.x, center.y, 5 / self.scale, 0, 2 * Math.PI);
    self.ctx.fill();

    // Preview ellipse
    if (rx > 0 || ry > 0) {
        self.ctx.strokeStyle = self.currentColor;
        self.ctx.lineWidth = 2 / self.scale;
        self.ctx.setLineDash([6 / self.scale, 3 / self.scale]);
        self.ctx.beginPath();
        self.ctx.ellipse(center.x, center.y, rx, ry, 0, 0, 2 * Math.PI);
        self.ctx.stroke();
        self.ctx.setLineDash([]);
    }
}
