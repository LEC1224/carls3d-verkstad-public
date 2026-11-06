export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
export const MAX_MODEL_FILES = 20;
export const MAX_TOTAL_MODEL_SIZE = 200 * 1024 * 1024;
export const MAX_MODEL_COPIES = 999;
export const SUPPORTED_MATERIALS = ["PLA", "PETG", "ABS", "ASA", "TPU"] as const;
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
export const LITHOPHANE_IMAGE_COUNT = 4;
export const MAX_TORCH_QUANTITY = 999;
export const MAX_DIMENSION = 256; // mm

export function validateFile(file: File): string | null {
  if (!/\.(stl|obj)$/i.test(file.name)) return "Välj en STL- eller OBJ-fil.";
  if (file.size === 0) return "Filen är tom. Välj en fil som innehåller en 3D-modell.";
  if (file.size > MAX_FILE_SIZE) {
    return "Filen är för stor (max 100 MB). Kontakta info@carls3d.se.";
  }
  return null;
}

export function validateDimensions(width: number, height: number, depth: number): string | null {
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || depth > MAX_DIMENSION) {
    return "Modellen är för stor för BambuLab P1S. Kontakta info@carls3d.se.";
  }
  return null;
}
