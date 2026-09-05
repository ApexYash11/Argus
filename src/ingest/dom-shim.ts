/**
 * Minimal DOMMatrix stub for standalone executables (`bun build --compile`).
 *
 * pdfjs-dist (via pdf-parse) evaluates `new DOMMatrix` at module load, but the
 * compiled binary has no DOM globals, so every CLI invocation crashed even
 * when no PDF was involved. Argus only uses text extraction (`getText`),
 * which never touches matrix math — an identity stub is enough to get module
 * evaluation past the top level. Canvas-dependent rendering paths remain
 * unavailable in the exe, which is fine: we never render pages.
 *
 * No-op under `bun run` (Bun/Node already define DOMMatrix there).
 */
type MatrixInit = number[] | undefined;

class DOMMatrixStub {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;

  constructor(_init?: MatrixInit | string) {}

  multiplySelf(_other?: unknown): this { return this; }
  preMultiplySelf(_other?: unknown): this { return this; }
  scaleSelf(sx?: number, sy?: number): this {
    const x = sx ?? 1;
    const y = sy ?? x;
    this.a *= x; this.d *= y;
    return this;
  }
  translateSelf(tx?: number, ty?: number): this {
    this.e += tx ?? 0; this.f += ty ?? 0;
    return this;
  }
  inverse(): DOMMatrixStub { return new DOMMatrixStub(); }
  toFloat32Array(): Float32Array { return new Float32Array([this.a, this.b, this.c, this.d, this.e, this.f]); }
}

const g = globalThis as Record<string, unknown>;
if (typeof g.DOMMatrix === "undefined") {
  g.DOMMatrix = DOMMatrixStub as unknown;
}
if (typeof g.ImageData === "undefined") {
  g.ImageData = class ImageDataStub {
    width: number; height: number; data: Uint8ClampedArray;
    constructor(width: number, height: number) {
      this.width = width; this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  } as unknown;
}
if (typeof g.Path2D === "undefined") {
  g.Path2D = class Path2DStub {
    constructor(_path?: unknown) {}
  } as unknown;
}

export {};
