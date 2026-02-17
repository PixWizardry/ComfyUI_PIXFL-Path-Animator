/**
 * Arc Tool - generates semi-circular arc motion paths.
 */

/**
 * Generate arc (half-circle) points from arc state.
 */
export function generateArcPoints(arcState, direction = 'up', numPoints = 20) {
    const { start, end } = arcState;

    const midpoint = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
    };
    const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)) / 2;

    if (radius === 0) return [];

    const startAngle = Math.atan2(start.y - midpoint.y, start.x - midpoint.x);
    const angleStep = Math.PI / numPoints;
    const directionMultiplier = (direction === 'up') ? -1 : 1;

    const points = [];
    for (let i = 0; i <= numPoints; i++) {
        const angle = startAngle + (i * angleStep * directionMultiplier);
        points.push({
            x: midpoint.x + radius * Math.cos(angle),
            y: midpoint.y + radius * Math.sin(angle),
        });
    }
    return points;
}

/**
 * Handle arc tool mousedown.
 */
export function onArcMouseDown(self, pos) {
    self.isDrawing = true;
    self.halfCircleState = {
        start: pos,
        end: pos,
    };
    self.render();
}

/**
 * Handle arc tool mousemove.
 */
export function onArcMouseMove(self, currentPos) {
    if (!self.halfCircleState) return;
    self.halfCircleState.end = currentPos;
    self.render();
}

/**
 * Handle arc tool mouseup - finalize the arc path.
 */
export function onArcMouseUp(self) {
    if (!self.halfCircleState) return;

    const { start, end } = self.halfCircleState;
    const dist = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));

    if (dist > 10) {
        const numPoints = 20;
        const points = generateArcPoints(self.halfCircleState, self.arcDirection, numPoints);

        if (points.length > 0) {
            const newPath = {
                id: 'path_' + Date.now(),
                name: 'Arc ' + (self.paths.length + 1),
                points: points,
                color: self.currentColor,
                isSinglePoint: false,
                direction: self.arcDirection === 'up' ? 'cw' : 'ccw',
                generationParams: {
                    type: 'arc',
                    state: { ...self.halfCircleState },
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
    self.halfCircleState = null;
    self.render();
}

/**
 * Render arc preview (baseline + arc curve).
 */
export function renderArcPreview(self) {
    if (!self.halfCircleState) return;
    const { start, end } = self.halfCircleState;

    // Baseline
    self.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    self.ctx.lineWidth = 1 / self.scale;
    self.ctx.setLineDash([4 / self.scale, 4 / self.scale]);
    self.ctx.beginPath();
    self.ctx.moveTo(start.x, start.y);
    self.ctx.lineTo(end.x, end.y);
    self.ctx.stroke();

    // Arc preview
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)) / 2;

    if (radius > 0) {
        const startAngle = Math.atan2(start.y - midpoint.y, start.x - midpoint.x);
        const endAngle = startAngle + (self.arcDirection === 'up' ? -Math.PI : Math.PI);

        self.ctx.strokeStyle = self.currentColor;
        self.ctx.lineWidth = 2 / self.scale;
        self.ctx.beginPath();
        self.ctx.arc(midpoint.x, midpoint.y, radius, startAngle, endAngle, self.arcDirection === 'up');
        self.ctx.stroke();
    }
    self.ctx.setLineDash([]);
}
