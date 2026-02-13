// WebGPU renderer for the falling sand simulation.
//
// Uses an rg8uint texture (2 bytes per cell: species + rb) so the shader
// can map fire lifetime to a color gradient and fade smoke over time.

const SHADER_SOURCE = /* wgsl */ `
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
        case 1u: { color = vec4<f32>(0.86, 0.78, 0.45, 1.0); }  // Sand: tan
        case 2u: { color = vec4<f32>(0.2, 0.4, 0.8, 1.0); }     // Water: blue
        case 3u: { color = vec4<f32>(0.5, 0.5, 0.5, 1.0); }     // Wall: gray
        case 4u: {
            // Fire: dark red → red → orange → yellow based on remaining lifetime (rb).
            // rb ~0 = dying (dark red), rb ~50 = fresh (yellow-white).
            let t = clamp(f32(rb) / 50.0, 0.0, 1.0);
            let r = mix(0.4, 1.0, t);
            let g = mix(0.08, 0.85, t * t);
            let b = mix(0.02, 0.1, t * t * t);
            color = vec4<f32>(r, g, b, 1.0);
        }
        case 5u: { color = vec4<f32>(0.95, 0.95, 0.97, 1.0); }  // Ghost: white
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
`;

export class Renderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private gridTexture: GPUTexture;
  private bindGroup: GPUBindGroup;
  private gridWidth: number;
  private gridHeight: number;

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    pipeline: GPURenderPipeline,
    gridTexture: GPUTexture,
    bindGroup: GPUBindGroup,
    gridWidth: number,
    gridHeight: number,
  ) {
    this.device = device;
    this.context = context;
    this.pipeline = pipeline;
    this.gridTexture = gridTexture;
    this.bindGroup = bindGroup;
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
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
    context.configure({ device, format, alphaMode: "premultiplied" });

    // rg8uint texture: r = species, g = rb (lifetime for fire/smoke color)
    const gridTexture = device.createTexture({
      size: [gridWidth, gridHeight],
      format: "rg8uint",
      usage:
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

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
    );
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
  }
}
