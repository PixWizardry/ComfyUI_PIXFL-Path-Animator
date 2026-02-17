/**
 * Composition guide overlays module.
 * B12 fix: loadSVG stores guide select reference on self.guideSelectElement.
 */

export const GUIDE_DEFAULTS = {
    guideLayer: {
        type: 'none',
        svgImage: null,
        opacity: 0.5,
        color: '#FFD700',
    },
};

export const GUIDE_TYPES = [
    { value: 'none', text: 'None' },
    { value: 'rule-of-thirds', text: 'Rule of Thirds' },
    { value: 'golden-ratio', text: 'Golden Ratio' },
    { value: 'center-cross', text: 'Center Cross' },
    { value: 'diagonals', text: 'Center Diagonals (X)' },
    { value: 'pyramid', text: 'Pyramid (V-Shape)' },
    { value: 'l-shape', text: 'L-Shapes' },
    { value: 'harmonious-triangles', text: 'Harmonious Triangles' },
    { value: 'circular', text: 'Circular' },
    { value: 'radial', text: 'Radial' },
];

/**
 * Render the guide layer on the canvas.
 */
export function renderGuideLayer(self) {
    if (self.guideLayer.type === 'none') return;

    self.ctx.save();
    self.ctx.globalAlpha = self.guideLayer.opacity;

    if (self.guideLayer.type === 'svg' && self.guideLayer.svgImage) {
        self.ctx.drawImage(self.guideLayer.svgImage, 0, 0, self.canvas.width, self.canvas.height);
    } else if (self.guideLayer.type !== 'svg') {
        self.ctx.strokeStyle = self.guideLayer.color;
        self.ctx.lineWidth = 1 / self.scale;
        self.ctx.beginPath();
        drawCompositionGuide(self, self.guideLayer.type);
        self.ctx.stroke();
    }

    self.ctx.restore();
}

function drawCompositionGuide(self, type) {
    const w = self.canvas.width;
    const h = self.canvas.height;

    switch (type) {
        case 'rule-of-thirds':
            self.ctx.moveTo(w / 3, 0); self.ctx.lineTo(w / 3, h);
            self.ctx.moveTo(w * 2 / 3, 0); self.ctx.lineTo(w * 2 / 3, h);
            self.ctx.moveTo(0, h / 3); self.ctx.lineTo(w, h / 3);
            self.ctx.moveTo(0, h * 2 / 3); self.ctx.lineTo(w, h * 2 / 3);
            break;

        case 'golden-ratio': {
            const phi = 1.618;
            self.ctx.moveTo(w / phi, 0); self.ctx.lineTo(w / phi, h);
            self.ctx.moveTo(w - (w / phi), 0); self.ctx.lineTo(w - (w / phi), h);
            self.ctx.moveTo(0, h / phi); self.ctx.lineTo(w, h / phi);
            self.ctx.moveTo(0, h - (h / phi)); self.ctx.lineTo(w, h - (h / phi));
            break;
        }

        case 'center-cross':
            self.ctx.moveTo(w / 2, 0); self.ctx.lineTo(w / 2, h);
            self.ctx.moveTo(0, h / 2); self.ctx.lineTo(w, h / 2);
            break;

        case 'diagonals':
            self.ctx.moveTo(0, 0); self.ctx.lineTo(w, h);
            self.ctx.moveTo(w, 0); self.ctx.lineTo(0, h);
            break;

        case 'pyramid':
            self.ctx.moveTo(0, h); self.ctx.lineTo(w / 2, 0);
            self.ctx.moveTo(w / 2, 0); self.ctx.lineTo(w, h);
            self.ctx.moveTo(0, 0); self.ctx.lineTo(w / 2, h);
            self.ctx.moveTo(w / 2, h); self.ctx.lineTo(w, 0);
            break;

        case 'l-shape': {
            const tw = w / 3, th = h / 3;
            self.ctx.moveTo(tw, 0); self.ctx.lineTo(tw, th); self.ctx.lineTo(0, th);
            self.ctx.moveTo(w - tw, 0); self.ctx.lineTo(w - tw, th); self.ctx.lineTo(w, th);
            self.ctx.moveTo(tw, h); self.ctx.lineTo(tw, h - th); self.ctx.lineTo(0, h - th);
            self.ctx.moveTo(w - tw, h); self.ctx.lineTo(w - tw, h - th); self.ctx.lineTo(w, h - th);
            break;
        }

        case 'harmonious-triangles': {
            const mx = w / 2, my = h / 2;
            self.ctx.moveTo(0, h); self.ctx.lineTo(w, 0);
            self.ctx.moveTo(0, 0); self.ctx.lineTo(mx, my);
            self.ctx.moveTo(w, h); self.ctx.lineTo(mx, my);
            break;
        }

        case 'circular': {
            const cx = w / 2, cy = h / 2;
            const maxR = Math.min(cx, cy);
            for (const frac of [0.25, 0.5, 0.75]) {
                self.ctx.moveTo(cx + maxR * frac, cy);
                self.ctx.arc(cx, cy, maxR * frac, 0, Math.PI * 2);
            }
            break;
        }

        case 'radial': {
            const rcx = w / 2, rcy = h / 2;
            for (let i = 0; i < 8; i++) {
                const angle = (Math.PI / 4) * i;
                self.ctx.moveTo(rcx, rcy);
                self.ctx.lineTo(rcx + w * Math.cos(angle), rcy + h * Math.sin(angle));
            }
            break;
        }
    }
}

/**
 * Load an SVG file as a guide overlay.
 * B12 fix: uses self.guideSelectElement instead of querySelector('select').
 */
export function loadSVG(self) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/svg+xml';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    self.guideLayer.svgImage = img;
                    self.guideLayer.type = 'svg';
                    // B12 fix: use stored reference
                    if (self.guideSelectElement) self.guideSelectElement.value = 'none';
                    self.render();
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
}
