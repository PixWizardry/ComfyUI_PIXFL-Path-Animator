/**
 * UI Control factory functions for the Path Animator editor.
 * B16 fix: style injection checks for existing style element by ID.
 */

let _numberInputStyleInjected = false;

/**
 * Create a slider control with synchronized number input.
 * @param {object} self - The PathEditorModal instance (for calling render)
 * @param {string} label - Label text
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {number} defaultValue - Initial value
 * @param {function} onChange - Callback with new value
 * @param {string} suffix - Display suffix (e.g. '%', 'px')
 * @returns {HTMLElement}
 */
export function createSliderControl(self, label, min, max, defaultValue, onChange, suffix = '') {
    const container = document.createElement('div');
    container.style.cssText = `flex: 1; display: flex; align-items: center; gap: 12px;`;

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = `color: #fff; font-size: 13px; font-weight: 500; min-width: 120px; opacity: 0.9;`;

    const sliderContainer = document.createElement('div');
    sliderContainer.style.cssText = `flex: 1; display: flex; align-items: center; gap: 12px;`;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.value = defaultValue;
    slider.style.cssText = `flex: 1; cursor: pointer; accent-color: #4ECDC4; height: 6px;`;

    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.min = min;
    numberInput.max = max;
    numberInput.value = defaultValue;
    numberInput.style.cssText = `background: #222; color: #ddd; border: 1px solid #555; border-radius: 4px; width: 60px; text-align: center; font-size: 13px; -moz-appearance: textfield;`;
    numberInput.addEventListener('wheel', e => e.preventDefault());

    // B16 fix: only inject style once
    if (!_numberInputStyleInjected && !document.getElementById('fl-path-number-input-style')) {
        const style = document.createElement('style');
        style.id = 'fl-path-number-input-style';
        style.textContent = `input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }`;
        document.head.appendChild(style);
        _numberInputStyleInjected = true;
    }

    slider.oninput = (e) => {
        const value = parseInt(e.target.value);
        numberInput.value = value;
        onChange(value);
        self.render();
    };

    numberInput.oninput = (e) => {
        let value = parseInt(e.target.value);
        if (isNaN(value)) return;
        value = Math.max(min, Math.min(max, value));
        slider.value = value;
        onChange(value);
        self.render();
    };
    numberInput.onchange = numberInput.oninput;

    sliderContainer.appendChild(slider);
    sliderContainer.appendChild(numberInput);
    container.appendChild(labelEl);
    container.appendChild(sliderContainer);
    return container;
}

/**
 * Create a checkbox control.
 */
export function createCheckboxControl(label, isChecked, onChange) {
    const container = document.createElement('div');
    container.style.cssText = `display: flex; align-items: center; gap: 8px;`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isChecked;
    checkbox.style.cursor = 'pointer';
    checkbox.onchange = (e) => onChange(e.target.checked);

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = `color: #fff; font-size: 13px; font-weight: 500; cursor: pointer;`;

    container.appendChild(checkbox);
    container.appendChild(labelEl);
    return container;
}

/**
 * Create a color picker control.
 */
export function createColorPickerControl(label, defaultColor, onChange) {
    const container = document.createElement('div');
    container.style.cssText = `display: flex; align-items: center; gap: 8px;`;

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = `color: #fff; font-size: 13px; font-weight: 500;`;

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = defaultColor;
    colorInput.style.cssText = `cursor: pointer; background: none; border: 1px solid #555; border-radius: 4px; width: 30px; height: 30px; padding: 2px;`;
    colorInput.oninput = (e) => onChange(e.target.value);

    container.appendChild(labelEl);
    container.appendChild(colorInput);
    return container;
}
