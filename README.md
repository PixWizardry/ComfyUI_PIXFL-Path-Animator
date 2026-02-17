# FL Path Animator (PRO)

A standalone ComfyUI custom node with a professional-grade visual editor for creating animated shape trajectories, orbit loops, arc sweeps, and zoom transitions — purpose-built for WAN ATI video generation.

## What's New in the PRO Version

The original FL Path Animator shipped with a basic pencil tool, static anchor points, and a simple path editor. The PRO version is a complete rewrite of the editor and a significant backend expansion. Here's what changed:

### vs. Original — At a Glance

| Feature | Original | PRO |
|---|---|---|
| Drawing tools | Pencil, Point | Pencil, Point, Orbit, Arc, Zoom Box, Eraser, Select |
| Path manipulation | None | Clone, Flip H/V, Reverse Direction, Drag Reposition |
| Canvas navigation | Fixed view | Pan (middle-click), Zoom (Ctrl+Scroll), Reset View |
| Grid & snapping | None | Configurable grid with snap-to-grid |
| Composition guides | None | 9 built-in guides + custom SVG loading |
| Canvas resizing | None | 7 resolution presets with automatic path rescaling |
| Background images | Load/paste, lost on reload | Load/paste, **persisted to ComfyUI input folder** — survives workflow switches and reloads |
| Timeline control | Per-path only | Per-path + global override from node parameters |
| Path length control | None | Override length + multiplier with delta-based scaling |
| Coordinate output | 121-point resampling | 121-point resampling + global timeline windowed sub-sampling |
| Per-path settings | Start/end time, interpolation | Start/end time, interpolation, visibility mode, motion direction, point count (orbit/arc) |
| Architecture | Single monolithic JS file | Modular JS — 8 separate modules + 3 tool-specific modules |

### New Drawing Tools

- **Orbit Tool** — Click to place a center point, drag to shape an elliptical orbit. Toggle clockwise/counter-clockwise direction. Creates a closed-loop motion path that shapes follow in a continuous orbit. Adjust point granularity after creation.
- **Arc Tool** — Click a start point, drag to an end point to generate a semi-circular arc path. Toggle arc direction (curves above or below the baseline). Useful for sweeping camera-style motions.
- **Zoom Box Tool** — Draw a rectangle, then scroll the mouse wheel to grow or shrink it. Each scroll step records the four corner positions, building four motion paths (TL, TR, BL, BR) that animate a zoom-in or zoom-out effect. Press Enter to finalize, right-click to cancel.

### New Path Manipulation

- **Clone** — Duplicate any selected path with a configurable offset (snaps to grid size when snap is enabled)
- **Flip Horizontal / Vertical** — Mirror a path around its own bounding box center
- **Reverse Direction** — Reverse the point order of a motion path (accessible from the sidebar), effectively reversing the animation direction
- **Drag Repositioning** — Select tool now supports dragging entire paths or individual control points to new positions

### New Editor Controls

- **Pan & Zoom** — Navigate large canvases with middle-click drag (pan) and Ctrl+Scroll (zoom). All tools operate correctly at any zoom level using world-space coordinate transforms. Reset View button returns to default.
- **Grid System** — Toggle a configurable grid overlay with snap-to-grid. Adjust grid size (10-200px), opacity (0-100%), and color. When snap is enabled, all drawing and dragging operations align to grid intersections.
- **Composition Guides** — 9 built-in guide overlays for precise path placement:
  - Rule of Thirds, Golden Ratio, Center Cross, Center Diagonals, Pyramid (V-Shape), L-Shapes, Harmonious Triangles, Circular, Radial
  - Load any custom SVG file as a guide overlay
  - Adjustable guide opacity and color
- **Canvas Resize** — Resize the canvas to common resolution presets (1280x720, 848x480, 1024x1024, 512x512, 720x1280, 480x848, or original image size). All path coordinates and generation parameters are automatically rescaled.
- **Path Width** — Adjustable line thickness for drawn paths (1-10)
- **Background Opacity** — Control reference image visibility (0-100%)

### Persistent Background Images

Background images now survive workflow switches and ComfyUI restarts. When you load or paste an image:
1. The image displays immediately on the canvas
2. It uploads to `ComfyUI/input/fl_path_animator/` via the ComfyUI upload API
3. The filename is saved in the `paths_data` JSON alongside your paths
4. When you reopen the editor — even after switching workflows or restarting — the image is fetched back from the server automatically

The in-memory cache is kept as a fast path so repeated opens during the same session are instant.

### New Backend Parameters

Four new optional node parameters give you control over timing and path geometry without reopening the editor:

- **`start_time_percent`** (0-100%) — Global timeline start. Overrides all per-path start times.
- **`end_time_percent`** (0-100%) — Global timeline end. Overrides all per-path end times.
- **`override_path_length`** (-1 to 8192) — Force all motion paths to a specific pixel length. Set to -1 or 0 to disable.
- **`path_length_multiplier`** (0.01-100.0) — Scale all path lengths by a factor, applied after the override.

Path length scaling uses **delta-based scaling** — inter-segment deltas are scaled uniformly, preserving the curve's shape rather than distorting it radially from the first point.

When the global timeline override is active, the WAN ATI coordinate output is also windowed: the 121-point resampled path is sub-sampled to the specified time range and re-resampled back to 121 points, so the coordinate output always matches the visible animation window.

### Enhanced Per-Path Sidebar

When a path is selected, the sidebar now exposes:
- **Timeline Range** — Drag start/end handles on a visual slider
- **Interpolation** — Linear, Ease In, Ease Out, Ease In-Out
- **Visibility Mode** — *Pop* (appear/disappear at timeline boundaries) or *Static* (always visible, holds position before/after)
- **Motion Direction** — Clockwise or counter-clockwise (reverses point order on toggle)
- **Point Count** — For orbit and arc paths, adjust the number of generated points (granularity) after creation, re-generating the path shape in real-time

---

## Installation

1. Clone or download this repository into your ComfyUI custom_nodes folder:

2. Restart ComfyUI

## Usage

### Basic Workflow

1. Add the **"FL Path Animator"** node to your workflow
2. Click **"Edit Paths"** to open the editor
3. Draw paths using the toolbar tools (pencil, orbit, arc, zoom box, point)
4. Load a background reference image with the image button or **Ctrl+V**
5. Use grid, guides, and canvas resize to align paths precisely
6. Configure per-path timeline, interpolation, and visibility in the sidebar
7. Press **ESC** to save and close
8. Set shape properties and optional timeline/length overrides on the node
9. Connect outputs to your workflow

### Keyboard Shortcuts

| Key | Action |
|---|---|
| **ESC** | Save paths and close editor |
| **Enter** | Finalize zoom box |
| **SHIFT (hold)** | Constrain pencil to straight lines (H/V/45°) |
| **Ctrl+V** | Paste background image from clipboard |
| **Middle-Click + Drag** | Pan the canvas |
| **Ctrl+Scroll** | Zoom in/out |
| **Right-Click** | Finalize zoom box and switch to select tool |

### Node Parameters

#### Required
| Parameter | Description |
|---|---|
| `frame_width` / `frame_height` | Output frame dimensions |
| `frame_count` | Number of frames to generate (1-500) |
| `shape` | Shape type: circle, square, triangle, hexagon, star |
| `shape_size` | Shape size in pixels (2-500) |
| `shape_color` | Hex (#FFFFFF), RGB (255,255,255), or color name |
| `bg_color` | Background color |

#### Optional
| Parameter | Default | Description |
|---|---|---|
| `blur_radius` | 0.0 | Gaussian blur strength (0-50) |
| `trail_length` | 0.0 | Motion trail glow effect (0.0-1.0) |
| `rotation_speed` | 0.0 | Shape rotation over time (-360 to 360) |
| `border_width` | 0 | Shape border thickness (0-20) |
| `border_color` | white | Shape border color |
| `start_time_percent` | 0.0 | Global timeline start override (0-100%) |
| `end_time_percent` | 100.0 | Global timeline end override (0-100%) |
| `override_path_length` | -1 | Force path pixel length (-1 = disabled) |
| `path_length_multiplier` | 1.0 | Scale all path lengths (0.01-100.0) |

### Outputs

| Output | Description |
|---|---|
| **IMAGE** | Batch of rendered frames — shapes following their paths |
| **MASK** | Alpha masks extracted from the red channel |
| **STRING** | WAN ATI-compatible coordinate JSON (121 points per track) |

## Drawing Tools Reference

### Pencil
Draw freehand motion paths. Hold **SHIFT** for straight-line constraint. Points are spaced at minimum 3px intervals (scaled by zoom level) for smooth results.

### Orbit
Click to set center, drag outward to define an ellipse. The orbit direction button toggles CW/CCW. Creates a closed-loop path. After creation, adjust point count in the sidebar to control smoothness (default: 20 points).

### Arc
Click start point, drag to end point. The arc direction button toggles above/below the baseline. Creates a semi-circular motion path. Point count adjustable after creation (default: 20 points).

### Zoom Box
Draw a rectangle by click-dragging. After releasing, scroll the mouse wheel to resize the box — each scroll step records a new corner position. This builds 4 motion paths (one per corner: TL, TR, BL, BR) that together create a zoom-in or zoom-out animation. **Enter** or **right-click** to finalize. **ESC** also finalizes before closing.

### Point
Click to place a static anchor. Static anchors generate shapes that don't move — repeated as 121 identical coordinates for WAN ATI stability.

### Eraser
Click on any path to delete it instantly.

### Select
Click a path to select it. Selected paths show neon green highlights with numbered control points. Drag entire paths or individual points to reposition. Access the full per-path configuration panel in the sidebar.

### Lock Perimeter
Prompts for a count, then distributes that many static anchor points evenly around the canvas border. Essential for WAN ATI edge stabilization.

## WAN ATI Integration

The coordinate output is formatted for WAN (Warp and Noise) ATI video generation:

- Each path is resampled to exactly **121 points** using arc-length parameterization
- Constant-speed motion prevents jitter and warping in generated video
- Static points are repeated 121 times for stable anchors
- Output format: `[[{"x": int, "y": int}, ...121 pts...], ...]` — one track per path
- Global timeline windowing sub-samples and re-resamples to maintain 121-point consistency

## Technical Details

- **Modular Architecture** — Frontend split into dedicated modules: icons, UI controls, pan/zoom, grid, guides, canvas resize, clone/flip, and 3 tool modules (orbit, arc, zoom box)
- **World-Space Coordinates** — All tools use transformed coordinates, ensuring correct behavior at any pan/zoom level
- **Delta-Based Path Scaling** — Path length adjustments scale inter-segment deltas uniformly, preserving curve shape
- **Tracked Listener Cleanup** — All document-level event listeners are tracked and removed on modal close to prevent memory leaks
- **Background Persistence** — Images uploaded to ComfyUI's input folder via the native upload API; filenames stored in paths_data JSON
- **Arc-Length Resampling** — Paths resampled with cumulative arc-length parameterization for even point distribution

## Requirements

- Python 3.8+
- PIL (Pillow)
- NumPy
- PyTorch
- ComfyUI

## License

MIT License - See LICENSE file for details

## Credits

Created by Machine Delusions for the Fill-Nodes pack.
Extracted as standalone node for easier distribution.

## Support

For issues, feature requests, or questions:
- GitHub Issues: https://github.com/machinedelusions/ComfyUI_FL-Path-Animator/issues