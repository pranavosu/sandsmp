@group(0) @binding(0) var grid_tex: texture_2d<u32>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32(i32(vid & 1u) * 4 - 1);
    let y = f32(i32(vid >> 1u) * 4 - 1);
    out.position = vec4<f32>(x, y, 0.0, 1.0);
    out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let coord = vec2<i32>(in.uv * vec2<f32>(256.0, 256.0));
    let texel = textureLoad(grid_tex, coord, 0);
    let species = texel.r;
    let rb = texel.g;

    var color: vec4<f32>;
    switch species {
        case 0u: { color = vec4<f32>(0.1, 0.1, 0.12, 1.0); }   // Empty: dark
        case 1u: {
            // Per-grain variation. Base: earth yellow sRGB(225,169,95)
            let grain = f32(rb) / 255.0;
            let base  = vec3<f32>(0.882, 0.663, 0.373);
            let warm  = vec3<f32>(0.78, 0.55, 0.28);
            let pale  = vec3<f32>(0.95, 0.76, 0.47);
            var col: vec3<f32>;
            if (grain < 0.33) {
                col = mix(warm, base, grain * 3.0);
            } else if (grain < 0.66) {
                col = mix(base, pale, (grain - 0.33) * 3.0);
            } else {
                col = mix(pale, warm, (grain - 0.66) * 3.0);
            }
            let brightness = 0.95 + 0.1 * fract(grain * 7.3);
            color = vec4<f32>(col * brightness, 1.0);
        }
        case 2u: {
            let fx = f32(coord.x);
            let fy = f32(coord.y);
            let drop = fract(sin(fx * 12.9898 + fy * 78.233) * 43758.5453);
            let base   = vec3<f32>(0.2, 0.4, 0.8);
            let deep   = vec3<f32>(0.12, 0.3, 0.72);
            let bright = vec3<f32>(0.28, 0.5, 0.88);
            var col: vec3<f32>;
            if (drop < 0.33) {
                col = mix(deep, base, drop * 3.0);
            } else if (drop < 0.66) {
                col = mix(base, bright, (drop - 0.33) * 3.0);
            } else {
                col = mix(bright, deep, (drop - 0.66) * 3.0);
            }
            color = vec4<f32>(col, 1.0);
        }
        case 3u: { color = vec4<f32>(0.5, 0.5, 0.5, 1.0); }     // Wall: gray
        case 4u: {
            // Fire: dark red → red → orange → yellow based on remaining lifetime (rb).
            let t = clamp(f32(rb) / 50.0, 0.0, 1.0);
            let r = mix(0.4, 1.0, t);
            let g = mix(0.08, 0.85, t * t);
            let b = mix(0.02, 0.1, t * t * t);
            color = vec4<f32>(r, g, b, 1.0);
        }
        case 5u: {
            // Ghost: body = spectral white, rb=2 = dark eye
            if (rb == 2u) {
                color = vec4<f32>(0.08, 0.06, 0.15, 1.0);
            } else {
                color = vec4<f32>(0.95, 0.95, 0.97, 1.0);
            }
        }
        case 6u: {
            // Smoke: subtle gray that fades toward background as rb decreases.
            let t = clamp(f32(rb) / 100.0, 0.0, 1.0);
            let gray = mix(0.12, 0.35, t);
            color = vec4<f32>(gray, gray, gray * 1.08, 1.0);
        }
        default: { color = vec4<f32>(1.0, 0.0, 1.0, 1.0); }     // Magenta error
    }
    return color;
}
