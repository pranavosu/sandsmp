// Shader source inlined to avoid bundler configuration for .wgsl imports.
// Canonical source: app/_lib/shaders/grid.wgsl
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
    let species = textureLoad(grid_tex, coord, 0).r;

    var color: vec4<f32>;
    switch species {
        case 0u: { color = vec4<f32>(0.1, 0.1, 0.12, 1.0); }
        case 1u: { color = vec4<f32>(0.86, 0.78, 0.45, 1.0); }
        case 2u: { color = vec4<f32>(0.2, 0.4, 0.8, 1.0); }
        case 3u: { color = vec4<f32>(0.5, 0.5, 0.5, 1.0); }
        case 4u: { color = vec4<f32>(0.9, 0.4, 0.1, 1.0); }
        case 5u: { color = vec4<f32>(0.95, 0.95, 0.97, 1.0); }
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

    // r8uint texture for species data
    const gridTexture = device.createTexture({
      size: [gridWidth, gridHeight],
      format: "r8uint",
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

  render(speciesData: Uint8Array): void {
    // Upload species data to GPU texture
    this.device.queue.writeTexture(
      { texture: this.gridTexture },
      speciesData as unknown as ArrayBuffer,
      { bytesPerRow: this.gridWidth },
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
