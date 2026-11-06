import { Box3, BufferGeometry, Mesh, Object3D } from "three";

// Keep parsing/rendering bounded on phones, independently of the ordering limit.
export const MAX_PREVIEW_TRIANGLES = 400_000;
export const MAX_PREVIEW_PARTS = 2_000;
const MAX_PREVIEW_VERTICES = MAX_PREVIEW_TRIANGLES * 3;

/** Some STL exporters supply a normal attribute filled with zero vectors. */
export function repairPreviewNormals(geometry: BufferGeometry): void {
  const normals = geometry.getAttribute("normal");
  let invalid = !normals || normals.count !== geometry.getAttribute("position")?.count;
  if (normals) {
    for (let index = 0; index < normals.count && !invalid; index++) {
      const lengthSquared = normals.getX(index) ** 2 + normals.getY(index) ** 2 + normals.getZ(index) ** 2;
      invalid = !Number.isFinite(lengthSquared) || lengthSquared < 1e-12;
    }
  }
  if (invalid) geometry.computeVertexNormals();
}

/** Validate binary counts before STLLoader allocates typed arrays from an untrusted header. */
export function validateStlPreviewSize(data: ArrayBuffer): void {
  if (data.byteLength < 84) throw new Error("Modellen är en ofullständig STL-fil och kan inte förhandsvisas.");
  const view = new DataView(data);
  const triangles = view.getUint32(80, true);
  const expectedLength = 84 + triangles * 50;
  const prefix = new TextDecoder().decode(data.slice(0, 9));
  // Binary STL headers may also start with 'solid'; exact binary length wins, as in STLLoader.
  const asciiHeader = Array.from({ length: 5 }, (_, offset) => prefix.slice(offset, offset + 5)).includes("solid");
  if (expectedLength === data.byteLength || !asciiHeader) {
    if (triangles > MAX_PREVIEW_TRIANGLES) throw new Error("Modellen är för detaljerad för förhandsvisningen. Du kan fortfarande beräkna pris och beställa.");
    if (expectedLength !== data.byteLength) throw new Error("Modellen är en ofullständig STL-fil och kan inte förhandsvisas.");
    return;
  }
  const text = new TextDecoder().decode(data);
  let vertices = 0;
  for (const _match of text.matchAll(/\bvertex\s+/gi)) {
    if (++vertices > MAX_PREVIEW_TRIANGLES * 3) throw new Error("Modellen är för detaljerad för förhandsvisningen. Du kan fortfarande beräkna pris och beställa.");
  }
}

/** OBJ can describe many triangles in a small text file. Check before allocating them. */
export function validateObjPreviewSize(text: string): void {
  let triangles = 0;
  let auxiliaryVertices = 0;
  let parts = 0;
  const sourceVertices = { v: 0, vn: 0, vt: 0 };
  const tooDetailed = () => new Error("Modellen är för detaljerad för förhandsvisningen. Du kan fortfarande beräkna pris och beställa.");
  // Match OBJLoader: CRLF first, then backslash-newline continuations, then trimStart.
  const normalized = text.replace(/\r\n/g, "\n").replace(/\\\n/g, "");
  let lineStart = 0;
  let lineCount = 0;
  while (lineStart <= normalized.length) {
    if (++lineCount > 2_000_000) throw tooDetailed();
    const lineEnd = normalized.indexOf("\n", lineStart);
    const line = normalized.slice(lineStart, lineEnd < 0 ? normalized.length : lineEnd);
    lineStart = lineEnd < 0 ? normalized.length + 1 : lineEnd + 1;
    const trimmed = line.trimStart();
    const first = trimmed.charAt(0);
    if (first === "f") {
      // OBJLoader also accepts 'f1 2 3'; do not require a space after the command.
      let faceVertices = 0;
      for (const _token of trimmed.slice(1).matchAll(/\S+/g)) {
        if (++faceVertices > MAX_PREVIEW_VERTICES) throw tooDetailed();
      }
      triangles += Math.max(0, faceVertices - 2);
      if (triangles > MAX_PREVIEW_TRIANGLES) throw tooDetailed();
    } else if (first === "l" || first === "p") {
      // Point/line records split on literal spaces, including empty entries.
      const data = trimmed.slice(1).trim();
      auxiliaryVertices++;
      if (auxiliaryVertices > MAX_PREVIEW_VERTICES) throw tooDetailed();
      for (const character of data) {
        if (character === " ") auxiliaryVertices++;
        if (auxiliaryVertices > MAX_PREVIEW_VERTICES) throw tooDetailed();
      }
    } else if (first === "v") {
      const command = trimmed.match(/^(v|vn|vt)(?=\s|$)/)?.[1];
      if (command && ++sourceVertices[command as keyof typeof sourceVertices] > MAX_PREVIEW_VERTICES) throw tooDetailed();
    } else if (first === "o" || first === "g" || /^(?:usemtl|mtllib|usemap) /.test(trimmed)) {
      if (++parts > MAX_PREVIEW_PARTS) throw tooDetailed();
    }
  }
  if (!triangles) throw new Error("Modellen innehåller inga ytor som kan visas. Punkt- och linjemodeller kan inte förhandsvisas.");
}

export function inspectPreviewModel(model: Object3D) {
  let vertices = 0;
  let triangles = 0;
  const bounds = new Box3();
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    vertices += position.count;
    triangles += (object.geometry.index?.count ?? position.count) / 3;
    for (let index = 0; index < position.count; index++) {
      if (![position.getX(index), position.getY(index), position.getZ(index)].every(Number.isFinite)) {
        throw new Error("Modellen innehåller ogiltiga koordinater och kan inte förhandsvisas.");
      }
    }
    bounds.union(new Box3().setFromObject(object));
  });
  if (!vertices || !triangles) throw new Error("Modellen innehåller inga ytor som kan visas.");
  if (triangles > MAX_PREVIEW_TRIANGLES) throw new Error("Modellen är för detaljerad för förhandsvisningen. Du kan fortfarande beräkna pris och beställa.");
  const axes = [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z];
  if (!axes.every(Number.isFinite) || bounds.isEmpty() || bounds.min.equals(bounds.max)) {
    throw new Error("Modellen saknar giltiga mått och kan inte förhandsvisas.");
  }
  return { bounds, triangles };
}
