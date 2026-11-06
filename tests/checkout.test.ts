import { createRequestGate, formatFileSize, isValidCopies, validateModelCart } from "../src/lib/checkout";
import { MAX_FILE_SIZE, MAX_MODEL_FILES, MAX_MODEL_COPIES } from "../src/lib/validation";

describe("model checkout validation", () => {
  it("accepts the supported formats case-insensitively up to the per-file boundary", () => {
    expect(validateModelCart([{ name: "Del.STL", size: MAX_FILE_SIZE - 1024 }, { name: "Del.obj", size: 1024 }])).toBeNull();
  });

  it("rejects a disguised extension, empty model and oversized model", () => {
    expect(validateModelCart([{ name: "del.stl.exe", size: 1 }])).toContain("format");
    expect(validateModelCart([{ name: "del.obj", size: 0 }])).toContain("tom");
    expect(validateModelCart([{ name: "del.stl", size: MAX_FILE_SIZE + 1 }])).toContain("90 MB");
  });

  it("checks the complete prospective cart, including duplicated files", () => {
    const file = { name: "modell.stl", size: MAX_FILE_SIZE / 2 };
    expect(validateModelCart([file, file])).toBeNull();
    expect(validateModelCart([file, file, { ...file, size: 1 }])).toContain("90 MB");
    expect(validateModelCart(Array.from({ length: MAX_MODEL_FILES + 1 }, () => ({ ...file, size: 1 })))).toContain("högst");
  });

  it.each([NaN, Infinity, -1, 0, 1.5, MAX_MODEL_COPIES + 1])("rejects invalid copy count %s", (copies) => {
    expect(isValidCopies(copies)).toBe(false);
  });

  it("accepts the copy-count boundaries", () => {
    expect(isValidCopies(1)).toBe(true);
    expect(isValidCopies(MAX_MODEL_COPIES)).toBe(true);
  });

  it("keeps displayed sizes useful for small and large models", () => {
    expect(formatFileSize(12)).toBe("12 byte");
    expect(formatFileSize(1025)).toBe("2 kB");
    expect(formatFileSize(1024 * 1024)).toBe("1 MB");
  });
});

describe("checkout request gate", () => {
  it("discards a quote after cart edits or another quote request", () => {
    const gate = createRequestGate();
    const first = gate.invalidate();
    expect(gate.isCurrent(first)).toBe(true);
    gate.invalidate(); // changed material, quantity, delivery, or coupon
    expect(gate.isCurrent(first)).toBe(false);
    const replacement = gate.invalidate();
    expect(gate.isCurrent(replacement)).toBe(true);
    expect(gate.isCurrent(first)).toBe(false);
  });
});
