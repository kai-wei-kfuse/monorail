// 等高线计算（UI风格规范 §9.2）：3D 柏林噪声叠 3 层 + marching squares。纯计算，不碰 DOM，方便测。

const PERM = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  let s = 20261026;
  for (let i = 255; i > 0; i--) { s = s * 16807 % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + t * (b - a);
const grad = (h: number, x: number, y: number, z: number) => {
  h &= 15;
  const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
};

/** 经典 3D 柏林噪声，输出约在 [-1, 1]。 */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), P = PERM;
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  x -= xi; y -= yi; z -= zi;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z), u), lerp(grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1), u), lerp(grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1), u), v), w);
}

export const TOPO = { scale: 1 / 300, drift: .35, step: .088, boldEvery: 5, idleSpeed: .045, runSpeed: .075, fps: 25 } as const;

/** 网格点上的高度场：3 层噪声，x 方向随时间漂移。 */
export function field(nx: number, ny: number, cell: number, t: number, out = new Float32Array(nx * ny)): Float32Array {
  const s = TOPO.scale, drift = t * TOPO.drift;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = i * cell * s + drift, y = j * cell * s;
    out[j * nx + i] = noise3(x, y, t) + .45 * noise3(x * 2.03 + 17.3, y * 2.03 + 4.1, t * 1.3) + .2 * noise3(x * 4.1 + 3.7, y * 4.1 + 9.2, t * 1.7);
  }
  return out;
}

// 等高线穿过格子的哪两条边（0 上 1 右 2 下 3 左），按四角是否高于等高线查表：左上 8 · 右上 4 · 右下 2 · 左下 1
const MS = [[], [3, 2], [2, 1], [3, 1], [0, 1], [0, 1, 3, 2], [0, 2], [3, 0], [3, 0], [0, 2], [3, 0, 2, 1], [0, 1], [3, 1], [2, 1], [3, 2], []];

/** 求等值线线段。返回扁平坐标 [x1, y1, x2, y2, …]；bold 是每第 5 条的计曲线。 */
export function contours(F: Float32Array, nx: number, ny: number, cell: number): { thin: number[]; bold: number[] } {
  const thin: number[] = [], bold: number[] = [], step = TOPO.step;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = F[j * nx + i], b = F[j * nx + i + 1], c = F[(j + 1) * nx + i + 1], d = F[(j + 1) * nx + i];
    const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d), x0 = i * cell, y0 = j * cell;
    for (let k = Math.ceil(lo / step); k * step < hi; k++) {
      const lv = k * step, seg = MS[(+(a > lv) << 3) | (+(b > lv) << 2) | (+(c > lv) << 1) | +(d > lv)];
      const out = k % TOPO.boldEvery === 0 ? bold : thin;
      for (const e of seg) {
        out.push(
          e === 0 ? x0 + cell * (lv - a) / (b - a) : e === 1 ? x0 + cell : e === 2 ? x0 + cell * (lv - d) / (c - d) : x0,
          e === 0 ? y0 : e === 1 ? y0 + cell * (lv - b) / (c - b) : e === 2 ? y0 + cell : y0 + cell * (lv - a) / (d - a));
      }
    }
  }
  return { thin, bold };
}
