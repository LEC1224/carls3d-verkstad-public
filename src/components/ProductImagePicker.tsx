import { useEffect, useState } from "react";
import { PRODUCT_IMAGE_ACCEPT, PRODUCT_IMAGE_COUNT, validateProductImages } from "../lib/productUploads";

export default function ProductImagePicker({ images, onChange, onError }: {
  images: File[];
  onChange: (images: File[]) => void;
  onError: (error: string) => void;
}) {
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = images.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [images]);

  return (
    <div>
      <label htmlFor="product-images" className="mb-1 block font-medium">Dina fyra bilder</label>
      <p id="product-images-help" className="mb-3 text-sm text-gray-600">JPG, PNG eller WebP, högst 20 MB per bild. Du kan lägga till bilder i flera omgångar. Bilder som inte är kvadratiska beskärs av oss.</p>
      <input
        id="product-images"
        type="file"
        accept={PRODUCT_IMAGE_ACCEPT}
        multiple
        disabled={images.length === PRODUCT_IMAGE_COUNT}
        aria-describedby="product-images-help product-images-count"
        className="w-full min-w-0 rounded-xl border bg-white px-3 py-2 text-sm"
        onChange={(event) => {
          const selected = Array.from(event.target.files || []);
          if (!selected.length) return;
          const next = [...images, ...selected];
          const error = validateProductImages(next);
          onError(error || "");
          if (!error) onChange(next);
          event.target.value = "";
        }}
      />
      <p id="product-images-count" className="mt-2 text-sm text-gray-600" role="status">{images.length} av {PRODUCT_IMAGE_COUNT} bilder valda</p>
      {images.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {images.map((file, index) => (
            <li key={`${file.name}-${file.lastModified}-${index}`} className="min-w-0 rounded-xl border bg-gray-50 p-2">
              {previews[index] && <img src={previews[index]} alt={`Förhandsvisning av ${file.name}`} className="aspect-square w-full rounded-lg object-cover" />}
              <p className="mt-2 truncate text-xs" title={file.name}>{file.name}</p>
              <button type="button" className="mt-1 min-h-10 w-full rounded-lg border bg-white px-2 py-1 text-sm hover:bg-gray-100" aria-label={`Ta bort bild ${index + 1}: ${file.name}`} onClick={() => { onChange(images.filter((_, i) => i !== index)); onError(""); }}>Ta bort</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
