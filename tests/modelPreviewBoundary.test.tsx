/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import ModelPreview from "../src/components/ModelPreview";

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => ({ file }: { file: File }) => <div data-testid="viewer">{file.name}</div>,
}));

test("leaves the order available without rendering a large model", () => {
  const file = new File(["model"], "large.stl");
  Object.defineProperty(file, "size", { value: 20 * 1024 * 1024 + 1 });
  render(<ModelPreview file={file} />);
  expect(screen.getByRole("status")).toHaveTextContent("fortfarande beräkna pris och beställa");
  expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
});

test("renders the on-demand viewer for a supported size", () => {
  render(<ModelPreview file={new File(["model"], "part.obj")} color="#ffffff" />);
  expect(screen.getByTestId("viewer")).toHaveTextContent("part.obj");
});
