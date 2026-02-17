import torch
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import math
import json
import logging

logger = logging.getLogger("FL_PathAnimator")

def pil2tensor(image):
    """Convert PIL Image to tensor"""
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)

def tensor2pil(tensor):
    """Convert tensor to PIL Image"""
    return Image.fromarray(np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

def parse_color(color):
    """Parse color string to RGB tuple"""
    if isinstance(color, str):
        if ',' in color:
            return tuple(int(c.strip()) for c in color.split(','))
        else:
            from PIL import ImageColor
            try:
                return ImageColor.getrgb(color)
            except:
                return (255, 255, 255)
    return color

def apply_interpolation(t, interpolation_type='linear'):
    """Apply interpolation easing function to parameter t (0.0 to 1.0)"""
    if interpolation_type == 'ease-in':
        return t * t
    elif interpolation_type == 'ease-out':
        return t * (2 - t)
    elif interpolation_type == 'ease-in-out':
        if t < 0.5:
            return 2 * t * t
        else:
            return -1 + (4 - 2 * t) * t
    else:
        return t

class FL_PathAnimator:

    RETURN_TYPES = ("IMAGE", "MASK", "STRING",)
    RETURN_NAMES = ("image", "mask", "coordinates",)
    FUNCTION = "animate_paths"
    CATEGORY = "🎨 FL Path Animator"
    DESCRIPTION = """
Creates animated shapes that follow user-drawn paths.
Open the path editor to draw trajectories on a reference image, then shapes will follow these paths over time.
Outputs WAN ATI-compatible coordinate strings with proper 121-point resampling for stable video generation.
"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "frame_width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 1}),
                "frame_height": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 1}),
                "frame_count": ("INT", {"default": 30, "min": 1, "max": 500, "step": 1}),
                "shape": ([
                    'circle',
                    'square',
                    'triangle',
                    'hexagon',
                    'star',
                ], {"default": 'circle'}),
                "shape_size": ("INT", {"default": 20, "min": 2, "max": 500, "step": 1}),
                "shape_color": ("STRING", {"default": 'white'}),
                "bg_color": ("STRING", {"default": 'black'}),
            },
            "optional": {
                "blur_radius": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 50.0, "step": 0.1}),
                "trail_length": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "rotation_speed": ("FLOAT", {"default": 0.0, "min": -360.0, "max": 360.0, "step": 1.0}),
                "border_width": ("INT", {"default": 0, "min": 0, "max": 20, "step": 1}),
                "border_color": ("STRING", {"default": 'white'}),
                "paths_data": ("STRING", {"default": '{"paths": [], "canvas_size": {"width": 512, "height": 512}}', "multiline": True}),
                # New optional parameters (ported from fork, renamed for clarity)
                "start_time_percent": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 0.1, "display": "number"}),
                "end_time_percent": ("FLOAT", {"default": 100.0, "min": 0.0, "max": 100.0, "step": 0.1, "display": "number"}),
                "override_path_length": ("INT", {"default": -1, "min": -1, "max": 8192, "step": 1, "display": "number"}),
                "path_length_multiplier": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 100.0, "step": 0.1, "display": "number"}),
            }
        }

    def draw_shape(self, draw, shape, center_x, center_y, size, rotation, fill_color, border_width=0, border_color='white'):
        """Draw a shape at the specified location"""
        half_size = size / 2

        if shape == 'circle':
            bbox = [center_x - half_size, center_y - half_size,
                   center_x + half_size, center_y + half_size]
            if border_width > 0:
                draw.ellipse(bbox, fill=fill_color, outline=border_color, width=border_width)
            else:
                draw.ellipse(bbox, fill=fill_color)

        elif shape == 'square':
            bbox = [center_x - half_size, center_y - half_size,
                   center_x + half_size, center_y + half_size]
            if border_width > 0:
                draw.rectangle(bbox, fill=fill_color, outline=border_color, width=border_width)
            else:
                draw.rectangle(bbox, fill=fill_color)

        elif shape == 'triangle':
            points = [
                (center_x, center_y - half_size),
                (center_x - half_size, center_y + half_size),
                (center_x + half_size, center_y + half_size),
            ]
            if rotation != 0:
                points = self.rotate_points(points, center_x, center_y, rotation)
            if border_width > 0:
                draw.polygon(points, fill=fill_color, outline=border_color, width=border_width)
            else:
                draw.polygon(points, fill=fill_color)

        elif shape == 'hexagon':
            points = []
            for i in range(6):
                angle = math.radians(60 * i + rotation)
                x = center_x + half_size * math.cos(angle)
                y = center_y + half_size * math.sin(angle)
                points.append((x, y))
            if border_width > 0:
                draw.polygon(points, fill=fill_color, outline=border_color, width=border_width)
            else:
                draw.polygon(points, fill=fill_color)

        elif shape == 'star':
            points = []
            for i in range(10):
                angle = math.radians(36 * i + rotation)
                r = half_size if i % 2 == 0 else half_size * 0.4
                x = center_x + r * math.cos(angle - math.pi / 2)
                y = center_y + r * math.sin(angle - math.pi / 2)
                points.append((x, y))
            if border_width > 0:
                draw.polygon(points, fill=fill_color, outline=border_color, width=border_width)
            else:
                draw.polygon(points, fill=fill_color)

    def rotate_points(self, points, cx, cy, angle):
        """Rotate points around a center"""
        rad = math.radians(angle)
        cos_a = math.cos(rad)
        sin_a = math.sin(rad)
        rotated = []
        for x, y in points:
            x -= cx
            y -= cy
            new_x = x * cos_a - y * sin_a + cx
            new_y = x * sin_a + y * cos_a + cy
            rotated.append((new_x, new_y))
        return rotated

    def resample_path_uniform(self, points, num_samples=121):
        """
        Resample path to exactly num_samples points with even arc-length spacing.
        This matches KJNodes "path" sampling method and is CRITICAL for WAN ATI stability.

        Args:
            points: List of {x, y} dicts representing the path
            num_samples: Number of points to resample to (default 121 for WAN ATI)

        Returns:
            List of {x, y} dicts with exactly num_samples points evenly distributed along the arc
        """
        if len(points) == 0:
            return []

        # SOLUTION 1: Support static single points
        if len(points) == 1:
            # Single point - repeat for all samples (creates static anchor)
            return [{'x': points[0]['x'], 'y': points[0]['y']} for _ in range(num_samples)]

        # Calculate cumulative arc lengths along the path
        cumulative_lengths = [0.0]
        for i in range(len(points) - 1):
            dx = points[i + 1]['x'] - points[i]['x']
            dy = points[i + 1]['y'] - points[i]['y']
            length = math.sqrt(dx * dx + dy * dy)
            cumulative_lengths.append(cumulative_lengths[-1] + length)

        total_length = cumulative_lengths[-1]

        # Handle zero-length path (all points are the same)
        if total_length == 0:
            return [{'x': points[0]['x'], 'y': points[0]['y']} for _ in range(num_samples)]

        # Resample at even intervals along the arc
        resampled = []
        for i in range(num_samples):
            # Calculate target distance along path
            if num_samples == 1:
                target_length = 0
            else:
                target_length = (i / (num_samples - 1)) * total_length

            # Find segment containing target length
            for j in range(len(cumulative_lengths) - 1):
                if cumulative_lengths[j] <= target_length <= cumulative_lengths[j + 1]:
                    # Interpolate within this segment
                    seg_length = cumulative_lengths[j + 1] - cumulative_lengths[j]
                    if seg_length > 0:
                        t = (target_length - cumulative_lengths[j]) / seg_length
                    else:
                        t = 0

                    x = points[j]['x'] + t * (points[j + 1]['x'] - points[j]['x'])
                    y = points[j]['y'] + t * (points[j + 1]['y'] - points[j]['y'])
                    resampled.append({'x': x, 'y': y})
                    break
            else:
                # Fallback to last point (shouldn't happen with correct logic)
                resampled.append({'x': points[-1]['x'], 'y': points[-1]['y']})

        return resampled

    def get_path_arc_length(self, points):
        """Calculate the total arc length of a path."""
        if len(points) < 2:
            return 0.0
        total_length = 0.0
        for i in range(len(points) - 1):
            dx = points[i + 1]['x'] - points[i]['x']
            dy = points[i + 1]['y'] - points[i]['y']
            total_length += math.sqrt(dx * dx + dy * dy)
        return total_length

    def interpolate_path(self, points, t):
        """
        Interpolate position along a path at time t (0.0 to 1.0)
        Returns (x, y) coordinates

        NOTE: This is used for visualization/animation only.
        For WAN ATI output, use resample_path_uniform() instead.
        """
        if len(points) == 0:
            return (0, 0)

        # Support static single points
        if len(points) == 1:
            return (points[0]['x'], points[0]['y'])

        # Calculate total path length
        total_length = 0
        segment_lengths = []
        for i in range(len(points) - 1):
            dx = points[i + 1]['x'] - points[i]['x']
            dy = points[i + 1]['y'] - points[i]['y']
            length = math.sqrt(dx * dx + dy * dy)
            segment_lengths.append(length)
            total_length += length

        if total_length == 0:
            return (points[0]['x'], points[0]['y'])

        # Find target distance along path
        target_distance = t * total_length

        # Find which segment contains target distance
        current_distance = 0
        for i, seg_length in enumerate(segment_lengths):
            if current_distance + seg_length >= target_distance:
                # Interpolate within this segment
                segment_t = (target_distance - current_distance) / seg_length if seg_length > 0 else 0
                x = points[i]['x'] + (points[i + 1]['x'] - points[i]['x']) * segment_t
                y = points[i]['y'] + (points[i + 1]['y'] - points[i]['y']) * segment_t
                return (x, y)
            current_distance += seg_length

        # Return last point if we've gone past the end
        return (points[-1]['x'], points[-1]['y'])

    def animate_paths(self, frame_width, frame_height, frame_count, shape, shape_size,
                     shape_color, bg_color, blur_radius=0.0, trail_length=0.0,
                     rotation_speed=0.0, border_width=0, border_color='white',
                     paths_data='{"paths": [], "canvas_size": {"width": 512, "height": 512}}',
                     start_time_percent=0.0, end_time_percent=100.0,
                     override_path_length=-1, path_length_multiplier=1.0):

        # Parse colors
        shape_color = parse_color(shape_color)
        bg_color = parse_color(bg_color)
        border_color = parse_color(border_color)

        # Parse paths data
        try:
            paths_obj = json.loads(paths_data)
            paths = paths_obj.get('paths', [])
            canvas_size = paths_obj.get('canvas_size', {'width': frame_width, 'height': frame_height})
        except json.JSONDecodeError:
            logger.warning("Invalid JSON in paths_data, using empty paths")
            paths = []
            canvas_size = {'width': frame_width, 'height': frame_height}

        # Calculate scaling factors to transform from canvas coordinates to frame coordinates
        canvas_width = canvas_size.get('width', frame_width)
        canvas_height = canvas_size.get('height', frame_height)
        scale_x = frame_width / canvas_width if canvas_width > 0 else 1.0
        scale_y = frame_height / canvas_height if canvas_height > 0 else 1.0

        # Scale all path coordinates
        scaled_paths = []
        for path in paths:
            scaled_path = path.copy()
            scaled_points = []
            for point in path.get('points', []):
                scaled_points.append({
                    'x': point['x'] * scale_x,
                    'y': point['y'] * scale_y
                })
            scaled_path['points'] = scaled_points

            # Preserve isSinglePoint flag if it exists
            if 'isSinglePoint' in path:
                scaled_path['isSinglePoint'] = path['isSinglePoint']

            scaled_paths.append(scaled_path)

        # --- Path length scaling (B1 fix: delta-based, not radial) ---
        # B7 fix: treat override_path_length=0 as disabled (same as -1)
        effective_override = override_path_length if override_path_length > 0 else -1

        for path in scaled_paths:
            points = path.get('points', [])
            is_motion_path = len(points) > 1 and not path.get('isSinglePoint', False)

            if not is_motion_path:
                continue

            original_length = self.get_path_arc_length(points)
            if original_length <= 0:
                continue

            # Determine the base length
            if effective_override > 0:
                base_length = float(effective_override)
            else:
                base_length = original_length

            # Apply path_length_multiplier
            target_length = base_length * path_length_multiplier

            if abs(target_length - original_length) < 1e-6:
                continue

            # B1 fix: delta-based scaling instead of radial scaling from points[0].
            # Scale inter-segment deltas uniformly to preserve curve shape.
            scale_factor = target_length / original_length
            logger.info(f"Scaling path '{path.get('name', 'Untitled')}' "
                        f"from {original_length:.1f}px to {target_length:.1f}px "
                        f"(factor: {scale_factor:.2f}x)")

            new_points = [{'x': points[0]['x'], 'y': points[0]['y']}]
            for i in range(1, len(points)):
                dx = points[i]['x'] - points[i - 1]['x']
                dy = points[i]['y'] - points[i - 1]['y']
                new_points.append({
                    'x': new_points[-1]['x'] + dx * scale_factor,
                    'y': new_points[-1]['y'] + dy * scale_factor,
                })
            path['points'] = new_points

        # --- Global timeline override ---
        # B4 fix: swap start/end if inverted, clamp both to [0.0, 1.0]
        use_global_timeline = (start_time_percent != 0.0 or end_time_percent != 100.0)
        if use_global_timeline:
            global_start_time = max(0.0, min(1.0, start_time_percent / 100.0))
            global_end_time = max(0.0, min(1.0, end_time_percent / 100.0))
            # B4 fix: swap if inverted
            if global_start_time > global_end_time:
                global_start_time, global_end_time = global_end_time, global_start_time
            # B4 fix: ensure nonzero duration
            if global_start_time == global_end_time:
                global_end_time = min(1.0, global_start_time + 0.01)
            # B6 fix: log warning
            logger.info(f"Global timeline override: {global_start_time*100:.1f}% to {global_end_time*100:.1f}%")

        images_list = []
        masks_list = []
        previous_output = None

        for frame in range(frame_count):
            # Create blank image with bg_color
            image = Image.new("RGB", (frame_width, frame_height), bg_color)
            draw = ImageDraw.Draw(image)

            # Calculate global time (0.0 to 1.0)
            global_t = frame / max(frame_count - 1, 1)

            # Draw each path's shape
            for path_idx, path in enumerate(scaled_paths):
                points = path.get('points', [])
                if len(points) == 0:
                    continue

                # Get timeline parameters
                if use_global_timeline:
                    # B6 fix: log when overriding per-path timing
                    start_time = global_start_time
                    end_time = global_end_time
                else:
                    start_time = path.get('startTime', 0.0)
                    end_time = path.get('endTime', 1.0)

                interpolation = path.get('interpolation', 'linear')
                visibility_mode = path.get('visibilityMode', 'pop')

                # Determine if shape should be visible and animated
                is_in_timeline = start_time <= global_t <= end_time

                # Skip rendering based on visibility mode
                if visibility_mode == 'pop' and not is_in_timeline:
                    # Pop mode: don't render outside timeline
                    continue

                # Calculate local time and position
                if is_in_timeline and end_time > start_time:
                    # Animate within timeline
                    local_t = (global_t - start_time) / (end_time - start_time)
                    eased_t = apply_interpolation(local_t, interpolation)
                    x, y = self.interpolate_path(points, eased_t)
                    # Calculate rotation based on local time
                    current_rotation = rotation_speed * eased_t * 360.0
                elif visibility_mode == 'static':
                    # B3 fix: keep upstream's fallback render at start position
                    if global_t < start_time:
                        x, y = self.interpolate_path(points, 0.0)
                        current_rotation = 0.0
                    else:
                        x, y = self.interpolate_path(points, 1.0)
                        current_rotation = rotation_speed * 360.0
                else:
                    # B3 fix: fallback to start position (don't skip)
                    x, y = self.interpolate_path(points, 0.0)
                    current_rotation = 0.0

                # Draw the shape
                self.draw_shape(draw, shape, x, y, shape_size, current_rotation,
                              shape_color, border_width, border_color)

            # Apply blur
            if blur_radius > 0:
                image = image.filter(ImageFilter.GaussianBlur(blur_radius))

            # Convert to tensor
            image_tensor = pil2tensor(image)

            # B2 fix: keep upstream's trail normalization (smooth glow, not hard-clamp)
            if trail_length > 0 and previous_output is not None:
                image_tensor = image_tensor + trail_length * previous_output
                max_val = image_tensor.max()
                if max_val > 0:
                    image_tensor = image_tensor / max_val

            previous_output = image_tensor.clone()

            # Clamp values
            image_tensor = torch.clamp(image_tensor, 0.0, 1.0)

            # Extract mask from red channel
            mask = image_tensor[:, :, :, 0]

            images_list.append(image_tensor)
            masks_list.append(mask)

        # Concatenate all frames
        out_images = torch.cat(images_list, dim=0)
        out_masks = torch.cat(masks_list, dim=0)

        # Generate WAN ATI-compatible coordinate string
        # B5 fix: subsample coords to respect global timeline window
        coord_tracks = []
        for path in scaled_paths:
            points = path.get('points', [])

            # Resample to exactly 121 points for WAN ATI compatibility
            resampled_points = self.resample_path_uniform(points, num_samples=121)

            if use_global_timeline and len(points) > 1 and not path.get('isSinglePoint', False):
                # B5 fix: subsample the 121 points to only the global timeline window
                # Map the global timeline percentage to indices
                start_idx = int(round(global_start_time * 120))
                end_idx = int(round(global_end_time * 120))
                if end_idx <= start_idx:
                    end_idx = start_idx + 1

                # Extract the windowed portion and re-resample to 121 points
                windowed = resampled_points[start_idx:end_idx + 1]
                if len(windowed) >= 2:
                    resampled_points = self.resample_path_uniform(windowed, num_samples=121)

            track_coords = [
                {"x": int(round(p["x"])), "y": int(round(p["y"]))}
                for p in resampled_points
            ]

            coord_tracks.append(track_coords)

        # Output as list of tracks (each track is a list of 121 {x, y} points)
        coord_string = json.dumps(coord_tracks)

        logger.info(f"Generated {len(coord_tracks)} tracks with 121 points each for WAN ATI")

        return (out_images, out_masks, coord_string)
