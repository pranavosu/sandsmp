// WebGPU renderer for the falling sand simulation.
//
// Uses an rg8uint texture (2 bytes per cell: species + rb) so the shader
// can map fire lifetime to a color gradient and fade smoke over time.
// A uniform buffer carries theme_mode (0.0 = dark, 1.0 = light) so the
// shader can blend between two palettes on the GPU.

const SHADER_SOURCE = /* wgsl */ `
@group(0) @binding(0) var grid_tex: texture_2d<u32>;
@group(0) @binding(1) var<uniform> theme: vec4<f32>; // x = mode (0=dark, 1=light)

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
    let t_mode = theme.x; // 0.0 = dark, 1.0 = light

    // Dark palette                          Light palette
    // Empty:  #1a1a1f (dark void)           #e8e2d8 (warm parchment)
    // Sand:   #dcc872 (golden)              #c4a830 (deeper ochre)
    // Water:  #3366cc (deep blue)           #3574b8 (brighter blue)
    // Wall:   #808080 (gray)                #6e6e6e (darker gray)
    // Ghost:  #f0f0f7 (spectral white)      #b8b0c8 (lavender tint)

    var color: vec4<f32>;
    switch species {
        case 0u: {
            let dark  = vec3<f32>(0.1, 0.1, 0.12);
            let light = vec3<f32>(0.91, 0.886, 0.847);
            color = vec4<f32>(mix(dark, light, t_mode), 1.0);
        }
        case 1u: {
            let dark  = vec3<f32>(0.86, 0.78, 0.45);
            let light = vec3<f32>(0.77, 0.66, 0.19);
            color = vec4<f32>(mix(dark, light, t_mode), 1.0);
        }
        case 2u: {
            let dark  = vec3<f32>(0.2, 0.4, 0.8);
            let light = vec3<f32>(0.21, 0.455, 0.72);
            color = vec4<f32>(mix(dark, light, t_mode), 1.0);
        }
        case 3u: {
            let dark  = vec3<f32>(0.5, 0.5, 0.5);
            let light = vec3<f32>(0.43, 0.43, 0.43);
            color = vec4<f32>(mix(dark, light, t_mode), 1.0);
        }
        case 4u: {
            let t = clamp(f32(rb) / 50.0, 0.0, 1.0);
            let r = mix(0.4, 1.0, t);
            let g = mix(0.08, 0.85, t * t);
            let b = mix(0.02, 0.1, t * t * t);
            // Fire stays vivid in both themes — just slightly warmer in light
            let dark  = vec3<f32>(r, g, b);
            let light = vec3<f32>(min(r * 1.05, 1.0), g * 0.95, b * 0.8);
            color = vec4<f32>(mix(dark, light, t_mode), 1.0);
        }
        case 5u: {
            // Ghost: body = spectral white/purple, rb=2 = dark eye
            let dark_body  = vec3<f32>(0.95, 0.95, 0.97);
            let light_interior = vec3<f32>(0.97, 0.97, 0.99);
            let light_border = vec3<f32>(0.565, 0.275, 1.0);

            // rb: 0 = body, 1 = eye zone (same as body), 2 = active eye (dark)
            if (rb == 2u) {
                let dark_eye  = vec3<f32>(0.08, 0.06, 0.15);
                let light_eye = vec3<f32>(0.15, 0.08, 0.3);
                color = vec4<f32>(mix(dark_eye, light_eye, t_mode), 1.0);
            } else {
                // In light mode, check if this cell borders a non-ghost cell.
                var is_border = false;
                if (t_mode > 0.5) {
                    let n = textureLoad(grid_tex, coord + vec2<i32>(0, -1), 0).r;
                    let s = textureLoad(grid_tex, coord + vec2<i32>(0,  1), 0).r;
                    let w = textureLoad(grid_tex, coord + vec2<i32>(-1, 0), 0).r;
                    let e = textureLoad(grid_tex, coord + vec2<i32>( 1, 0), 0).r;
                    if (n != 5u || s != 5u || w != 5u || e != 5u) {
                        is_border = true;
                    }
                }
                if (is_border) {
                    color = vec4<f32>(light_border, 1.0);
                } else {
                    let body_color = mix(dark_body, light_interior, t_mode);
                    color = vec4<f32>(body_color, 1.0);
                }
            }
        }
        case 6u: {
            let t = clamp(f32(rb) / 100.0, 0.0, 1.0);
            // Dark: gray fading to dark bg. Light: gray fading to parchment bg.
            let dark_gray  = mix(0.12, 0.35, t);
            let light_gray = mix(0.78, 0.55, t);
            let gray = mix(dark_gray, light_gray, t_mode);
            color = vec4<f32>(gray, gray, gray * mix(1.08, 0.98, t_mode), 1.0);
        }
        default: { color = vec4<f32>(1.0, 0.0, 1.0, 1.0); }
    }
    return color;
}
`;

export class Renderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private gridTexture: GPUTexture;
  private bindGroup: GPUBindGroup;
  private gridWidth: number;
  private gridHeight: number;
  private themeBuffer: GPUBuffer;
  private themeData: Float32Array;

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    pipeline: GPURenderPipeline,
    gridTexture: GPUTexture,
    bindGroup: GPUBindGroup,
    gridWidth: number,
    gridHeight: number,
    themeBuffer: GPUBuffer,
    themeData: Float32Array,
  ) {
    this.device = device;
    this.context = context;
    this.pipeline = pipeline;
    this.gridTexture = gridTexture;
    this.bindGroup = bindGroup;
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
    this.themeBuffer = themeBuffer;
    this.themeData = themeData;
  }

  static async create(
    canvas: HTMLCanvasElement,
    gridWidth: number,
    gridHeight: number,
  ): Promise<Renderer> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("WebGPU adapter not available");
    }

    const device = await adapter.requestDevice();

    const context = canvas.getContext("webgpu");
    if (!context) {
      throw new Error("Failed to get WebGPU canvas context");
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    // rg8uint texture: r = species, g = rb (lifetime for fire/smoke color)
    const gridTexture = device.createTexture({
      size: [gridWidth, gridHeight],
      format: "rg8uint",
      usage:
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Theme uniform buffer (vec4<f32>, 16 bytes — x = mode)
    const themeData = new Float32Array([0.0, 0.0, 0.0, 0.0]);
    const themeBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(themeBuffer, 0, themeData);

    const shaderModule = device.createShaderModule({
      code: SHADER_SOURCE,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "uint" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vs",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs",
        targets: [{ format }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });

    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: gridTexture.createView(),
        },
        {
          binding: 1,
          resource: { buffer: themeBuffer },
        },
      ],
    });

    return new Renderer(
      device,
      context,
      pipeline,
      gridTexture,
      bindGroup,
      gridWidth,
      gridHeight,
      themeBuffer,
      themeData,
    );
  }

  /** Set theme mode: 0 = dark, 1 = light. Uploaded to GPU on next render. */
  setTheme(mode: number): void {
    this.themeData[0] = mode;
    this.device.queue.writeBuffer(this.themeBuffer, 0, this.themeData as unknown as Float32Array<ArrayBuffer>);
  }

  render(cellRenderData: Uint8Array): void {
    // Upload cell render data (2 bytes per cell) to GPU texture
    this.device.queue.writeTexture(
      { texture: this.gridTexture },
      cellRenderData as unknown as ArrayBuffer,
      { bytesPerRow: this.gridWidth * 2 },
      { width: this.gridWidth, height: this.gridHeight },
    );

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear" as GPULoadOp,
          storeOp: "store" as GPUStoreOp,
        },
      ],
    });

    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.draw(3); // Full-screen triangle
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  destroy(): void {
    this.gridTexture.destroy();
    this.themeBuffer.destroy();
  }
}
