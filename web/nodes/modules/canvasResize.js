/**
 * Canvas resize module with path rescaling.
 * B9 fix: scales all path coordinates by newSize/oldSize.
 */

export const RESOLUTION_PRESETS = [
    { text: 'Original Image Size', value: 'original' },
    { text: '16:9 - 1280x720 (HD)', value: '1280,720' },
    { text: '16:9 - 848x480 (Wide)', value: '848,480' },
    { text: '1:1 - 1024x1024 (Square)', value: '1024,1024' },
    { text: '1:1 - 512x512 (Square)', value: '512,512' },
    { text: '9:16 - 720x1280 (Portrait)', value: '720,1280' },
    { text: '9:16 - 480x848 (Portrait)', value: '480,848' },
];

/**
 * Resize the canvas and background image, rescaling all paths.
 * B9 fix: all path coordinates are scaled by newSize/oldSize.
 */
export function resizeCanvasAndImage(self) {
    const sourceImage = self.originalBackgroundImage || self.backgroundImage;
    if (!sourceImage) {
        alert("Please load a background image first before resizing.");
        return;
    }

    const selectedValue = self.resolutionSelect.value;
    let targetWidth, targetHeight;

    if (selectedValue === 'original') {
        targetWidth = sourceImage.naturalWidth;
        targetHeight = sourceImage.naturalHeight;
    } else {
        [targetWidth, targetHeight] = selectedValue.split(',').map(Number);
    }

    if (!targetWidth || !targetHeight) {
        console.error("Invalid resolution selected:", selectedValue);
        return;
    }

    // B9 fix: compute scale factors before resizing
    const oldWidth = self.canvas.width;
    const oldHeight = self.canvas.height;
    const scaleX = targetWidth / oldWidth;
    const scaleY = targetHeight / oldHeight;

    console.log(`FL_PathAnimator: Resizing canvas ${oldWidth}x${oldHeight} -> ${targetWidth}x${targetHeight}`);

    // B9 fix: rescale all path coordinates
    for (const path of self.paths) {
        for (const point of path.points) {
            point.x *= scaleX;
            point.y *= scaleY;
        }
        // Also rescale stored generation params if present
        if (path.generationParams && path.generationParams.state) {
            const state = path.generationParams.state;
            if (state.center) {
                state.center.x *= scaleX;
                state.center.y *= scaleY;
            }
            if (state.rx !== undefined) state.rx *= scaleX;
            if (state.ry !== undefined) state.ry *= scaleY;
            if (state.start) {
                state.start.x *= scaleX;
                state.start.y *= scaleY;
            }
            if (state.end) {
                state.end.x *= scaleX;
                state.end.y *= scaleY;
            }
            if (state.endPoint) {
                state.endPoint.x *= scaleX;
                state.endPoint.y *= scaleY;
            }
        }
    }

    // Resize background image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = targetWidth;
    tempCanvas.height = targetHeight;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(sourceImage, 0, 0, targetWidth, targetHeight);
    const resizedImageDataUrl = tempCanvas.toDataURL('image/png');

    const resizedImage = new Image();
    resizedImage.onload = () => {
        self.backgroundImage = resizedImage;
        self.canvas.width = targetWidth;
        self.canvas.height = targetHeight;

        self.scale = 1.0;
        self.panOffsetX = 0;
        self.panOffsetY = 0;
        self.render();
        console.log("FL_PathAnimator: Canvas and background resized successfully.");
    };
    resizedImage.onerror = () => {
        console.error("Failed to load the resized image data.");
    };
    resizedImage.src = resizedImageDataUrl;
}
