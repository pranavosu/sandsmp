@group(0) @binding(0) var grid_tex: texture_2d<u32>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VertexOutput {
    // Full-screen triangle from vertex index (3 vertices, no vertex buffer)
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
    let species = textureLoad(grid_tex, coord, 0).r;

    // Color lookup table (Empty, Sand, Water, Wall, Fire)
    var color: vec4<f32>;
    switch species {
        case 0u: { color = vec4<f32>(0.1, 0.1, 0.12, 1.0); }   // Empty: dark
        case 1u: { color = vec4<f32>(0.86, 0.78, 0.45, 1.0); }  // Sand: tan
        case 2u: { color = vec4<f32>(0.2, 0.4, 0.8, 1.0); }     // Water: blue
        case 3u: { color = vec4<f32>(0.5, 0.5, 0.5, 1.0); }     // Wall: gray
        case 4u: { color = vec4<f32>(0.9, 0.4, 0.1, 1.0); }     // Fire: orange
        default: { color = vec4<f32>(1.0, 0.0, 1.0, 1.0); }     // Magenta error
    }
    return color;
}
