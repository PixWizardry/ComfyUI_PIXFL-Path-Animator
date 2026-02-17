/**
 * Clone, flip, and reverse path operations.
 */

/**
 * Clone the currently selected path with an offset.
 */
export function cloneSelectedPath(self) {
    if (self.selectedPathIndex === -1) {
        alert("Please select a path to clone.");
        return;
    }
    const originalPath = self.paths[self.selectedPathIndex];
    const newPath = JSON.parse(JSON.stringify(originalPath));

    const offset = self.snapToGrid ? self.gridSize : 20;
    newPath.points.forEach(p => {
        p.x += offset;
        p.y += offset;
    });

    newPath.id = 'path_' + Date.now();
    newPath.name = originalPath.name + " (Copy)";
    newPath.color = self.getRandomColor();

    self.paths.push(newPath);
    self.selectedPathIndex = self.paths.length - 1;
    self.updateSidebar();
    self.render();
}

/**
 * Flip the selected path horizontally or vertically around its bounding box center.
 */
export function flipSelectedPath(self, isHorizontal) {
    if (self.selectedPathIndex === -1) {
        alert("Please select a path to flip.");
        return;
    }
    const path = self.paths[self.selectedPathIndex];
    if (path.points.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    path.points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });

    const centerX = minX + (maxX - minX) / 2;
    const centerY = minY + (maxY - minY) / 2;

    path.points.forEach(p => {
        if (isHorizontal) {
            p.x = 2 * centerX - p.x;
        } else {
            p.y = 2 * centerY - p.y;
        }
    });

    self.render();
}

/**
 * Reverse the point order of a path (changes motion direction).
 */
export function reversePathPoints(path) {
    if (path && path.points && path.points.length > 1) {
        path.points.reverse();
    }
}
