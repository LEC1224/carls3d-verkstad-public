import { MAX_FILE_SIZE, MAX_MODEL_FILES, MAX_TOTAL_MODEL_SIZE, MAX_MODEL_COPIES } from "./validation";

type ModelFile = Pick<File, "name" | "size">;

/** Validate the prospective cart before asking the browser to upload anything. */
export function validateModelCart(files: readonly ModelFile[]): string | null {
  if (files.length > MAX_MODEL_FILES) {
    return `Du kan lägga till högst ${MAX_MODEL_FILES} filer i en beställning. Kontakta info@carls3d.se för större beställningar.`;
  }
  for (const file of files) {
    if (!/\.(stl|obj)$/i.test(file.name)) {
      return `”${file.name}” har ett format som inte stöds. Välj en STL- eller OBJ-fil.`;
    }
    if (file.size === 0) return `”${file.name}” är tom. Välj en fil som innehåller en 3D-modell.`;
    if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_FILE_SIZE) {
      return `”${file.name}” är för stor (max 90 MB per fil). Kontakta info@carls3d.se för hjälp.`;
    }
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_MODEL_SIZE) {
    return "Filerna får tillsammans vara högst 90 MB. Kontakta info@carls3d.se för större beställningar.";
  }
  return null;
}

export function isValidCopies(copies: number): boolean {
  return Number.isInteger(copies) && copies >= 1 && copies <= MAX_MODEL_COPIES;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} byte`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} MB`;
}

/** Requests can finish after the user edits the cart; only the latest one may publish. */
export function createRequestGate() {
  let revision = 0;
  return {
    invalidate: () => ++revision,
    isCurrent: (requestRevision: number) => requestRevision === revision,
  };
}
