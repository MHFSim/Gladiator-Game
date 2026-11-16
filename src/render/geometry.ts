import { Mesh, Scene, Vector3, VertexData } from '@babylonjs/core';

/**
 * Kleiner Baukasten für eigene Geometrie mit harten Kanten und UVs in Metern.
 * Die Dreiecksreihenfolge wird automatisch passend zur gewünschten Normale gesetzt.
 */
export class GeoBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  vertex(p: Vector3, n: Vector3, u: number, v: number): number {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    return this.positions.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    // a-b-c-d im Kreis
    this.indices.push(a, b, c, a, c, d);
  }

  /** Dreiecke so drehen, dass die Vorderseite zur Vertex-Normale zeigt (Babylon: Kreuzprodukt = -Normale) */
  private fixWinding(): void {
    const P = this.positions;
    const N = this.normals;
    const I = this.indices;
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
      const e1x = P[b * 3] - P[a * 3];
      const e1y = P[b * 3 + 1] - P[a * 3 + 1];
      const e1z = P[b * 3 + 2] - P[a * 3 + 2];
      const e2x = P[c * 3] - P[a * 3];
      const e2y = P[c * 3 + 1] - P[a * 3 + 1];
      const e2z = P[c * 3 + 2] - P[a * 3 + 2];
      const cx = e1y * e2z - e1z * e2y;
      const cy = e1z * e2x - e1x * e2z;
      const cz = e1x * e2y - e1y * e2x;
      const nx = N[a * 3] + N[b * 3] + N[c * 3];
      const ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
      const nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
      if (cx * nx + cy * ny + cz * nz > 0) {
        I[t + 1] = c;
        I[t + 2] = b;
      }
    }
  }

  build(name: string, scene: Scene): Mesh {
    this.fixWinding();
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.uvs = this.uvs;
    vd.indices = this.indices;
    vd.applyToMesh(mesh, false);
    return mesh;
  }
}

const up = new Vector3(0, 1, 0);

/** Senkrechtes Ringband (Mauer, Stufe). inward = Normale zur Mitte */
export function ringBand(
  g: GeoBuilder,
  r: number,
  y0: number,
  y1: number,
  a0: number,
  a1: number,
  seg: number,
  inward: boolean,
  tileU: number,
  tileV: number,
  vOffset = 0,
): void {
  const base = g.positions.length / 3;
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const n = inward ? new Vector3(-c, 0, -s) : new Vector3(c, 0, s);
    const u = ((a - a0) * r) / tileU;
    g.vertex(new Vector3(c * r, y0, s * r), n, u, vOffset + 0);
    g.vertex(new Vector3(c * r, y1, s * r), n, u, vOffset + (y1 - y0) / tileV);
  }
  for (let i = 0; i < seg; i++) {
    const k = base + i * 2;
    g.quad(k, k + 2, k + 3, k + 1);
  }
}

/** Waagrechter Kreisring (Stufenauftritt, Mauerkrone). Normale nach oben (oder unten) */
export function ringFlat(
  g: GeoBuilder,
  r0: number,
  r1: number,
  y: number,
  a0: number,
  a1: number,
  seg: number,
  tile: number,
  down = false,
): void {
  const base = g.positions.length / 3;
  const n = down ? up.scale(-1) : up;
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const u = ((a - a0) * (r0 + r1) * 0.5) / tile;
    g.vertex(new Vector3(c * r0, y, s * r0), n, u, 0);
    g.vertex(new Vector3(c * r1, y, s * r1), n, u, (r1 - r0) / tile);
  }
  for (let i = 0; i < seg; i++) {
    const k = base + i * 2;
    g.quad(k, k + 2, k + 3, k + 1);
  }
}

/** Schräger Ring (Dach) von (r0,y0) nach (r1,y1) */
export function ringSlope(
  g: GeoBuilder,
  r0: number,
  y0: number,
  r1: number,
  y1: number,
  a0: number,
  a1: number,
  seg: number,
  tile: number,
): void {
  const base = g.positions.length / 3;
  const dr = r1 - r0;
  const dy = y1 - y0;
  const len = Math.hypot(dr, dy);
  // Normale senkrecht zur Schräge, nach oben zeigend
  const nr = -dy / len;
  const ny = dr / len;
  const sign = ny < 0 ? -1 : 1;
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const n = new Vector3(c * nr * sign, ny * sign, s * nr * sign);
    const u = ((a - a0) * (r0 + r1) * 0.5) / tile;
    g.vertex(new Vector3(c * r0, y0, s * r0), n, u, 0);
    g.vertex(new Vector3(c * r1, y1, s * r1), n, u, len / tile);
  }
  for (let i = 0; i < seg; i++) {
    const k = base + i * 2;
    g.quad(k, k + 2, k + 3, k + 1);
  }
}

/** Kreisscheibe (Boden), UV in Metern */
export function disc(g: GeoBuilder, r: number, y: number, rings: number, seg: number, tile: number): void {
  const n = up;
  const center = g.vertex(new Vector3(0, y, 0), n, 0, 0);
  let prev: number[] = [];
  for (let k = 1; k <= rings; k++) {
    const rr = (r * k) / rings;
    const row: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      row.push(g.vertex(new Vector3(x, y, z), n, x / tile, z / tile));
    }
    for (let i = 0; i < seg; i++) {
      if (k === 1) g.tri(center, row[i], row[i + 1]);
      else g.quad(prev[i], row[i], row[i + 1], prev[i + 1]);
    }
    prev = row;
  }
}

/** Quader mit UVs in Metern */
export function box(g: GeoBuilder, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tile: number, rotY = 0): void {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const tr = (x: number, y: number, z: number) => new Vector3(cx + x * c + z * s, cy + y, cz - x * s + z * c);
  const rn = (x: number, y: number, z: number) => new Vector3(x * c + z * s, y, -x * s + z * c);
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const faces: [Vector3, Vector3, Vector3, number, number][] = [
    [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0), sz, sy],
    [new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0), sz, sy],
    [new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0), sx, sy],
    [new Vector3(0, 0, -1), new Vector3(1, 0, 0), new Vector3(0, 1, 0), sx, sy],
    [new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1), sx, sz],
    [new Vector3(0, -1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1), sx, sz],
  ];
  for (const [n, a, b, la, lb] of faces) {
    const center = new Vector3(n.x * hx, n.y * hy, n.z * hz);
    const ha = a.multiplyByFloats(hx, hy, hz);
    const hb = b.multiplyByFloats(hx, hy, hz);
    const nn = rn(n.x, n.y, n.z);
    const corners = [
      center.subtract(ha).subtract(hb),
      center.add(ha).subtract(hb),
      center.add(ha).add(hb),
      center.subtract(ha).add(hb),
    ];
    const uvs = [
      [0, 0],
      [la / tile, 0],
      [la / tile, lb / tile],
      [0, lb / tile],
    ];
    const ids = corners.map((p, i) => g.vertex(tr(p.x, p.y, p.z), nn, uvs[i][0], uvs[i][1]));
    g.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}
