import { MAX_PRODUCT_IMAGE_BYTES, validateProductImages } from "../src/lib/productUploads";

describe("lamp image validation", () => {
  it("accepts common image extensions case insensitively", () => {
    expect(validateProductImages(["photo.JPG", "photo.jpeg", "photo.png", "photo.webp"].map((name) => ({ name, size: 100 })))).toBeNull();
  });
  it("rejects empty files, excessive size and unsupported formats", () => {
    expect(validateProductImages([{ name: "empty.jpg", size: 0 }])).toContain("tom");
    expect(validateProductImages([{ name: "large.jpg", size: MAX_PRODUCT_IMAGE_BYTES + 1 }])).toContain("20 MB");
    expect(validateProductImages([{ name: "image.svg", size: 100 }])).toContain("JPG");
  });
  it("limits the complete selection while accepting a partial selection", () => {
    const file = { name: "photo.jpg", size: 100 };
    expect(validateProductImages([file])).toBeNull();
    expect(validateProductImages(Array(5).fill(file))).toContain("högst 4");
  });
});
