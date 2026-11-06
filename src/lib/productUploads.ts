import { MAX_IMAGE_SIZE, LITHOPHANE_IMAGE_COUNT } from "./validation";

export const MAX_PRODUCT_IMAGE_BYTES = MAX_IMAGE_SIZE;
export const PRODUCT_IMAGE_COUNT = LITHOPHANE_IMAGE_COUNT;
export const PRODUCT_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";

export function validateProductImages(files: Array<{ name: string; size: number }>): string | null {
  if (files.length > PRODUCT_IMAGE_COUNT) return "Välj högst 4 bilder. Ta bort en bild innan du lägger till en ny.";
  for (const file of files) {
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) return `${file.name}: välj en JPG-, PNG- eller WebP-bild.`;
    if (!file.size) return `${file.name}: bilden är tom. Välj en annan fil.`;
    if (file.size > MAX_PRODUCT_IMAGE_BYTES) return `${file.name}: bilden är för stor (max 20 MB per bild).`;
  }
  return null;
}
