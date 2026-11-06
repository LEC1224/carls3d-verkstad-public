/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from "three";
import ThreeDViewer from "../src/components/ThreeDViewer";

const mockRenderers: any[] = [];
const mockControls: any[] = [];
const mockMaterials: any[] = [];
const mockObservers: any[] = [];
const mockParseStl = jest.fn();
let mockRenderFailure = false;

jest.mock("three", () => {
  const actual = jest.requireActual("three");
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      setPixelRatio = jest.fn();
      setSize = jest.fn();
      render = jest.fn(() => { if (mockRenderFailure) throw new Error("Renderer failed"); });
      dispose = jest.fn();
      forceContextLoss = jest.fn();
      constructor() { mockRenderers.push(this); }
    },
    MeshStandardMaterial: function (options: unknown) {
      const material = new actual.MeshStandardMaterial(options);
      jest.spyOn(material, "dispose");
      mockMaterials.push(material);
      return material;
    },
  };
});
jest.mock("three/examples/jsm/loaders/STLLoader", () => ({
  STLLoader: class { parse(data: ArrayBuffer) { return mockParseStl(data); } },
}));
jest.mock("three/examples/jsm/loaders/OBJLoader", () => ({ OBJLoader: class {} }));
jest.mock("three/examples/jsm/controls/OrbitControls", () => {
  const { Vector3 } = jest.requireActual("three");
  return { OrbitControls: class {
    target = new Vector3();
    addEventListener = jest.fn();
    update = jest.fn();
    dispose = jest.fn();
    constructor() { mockControls.push(this); }
  } };
});

function fileWithData(data = new ArrayBuffer(134)) {
  if (data.byteLength === 134) new DataView(data).setUint32(80, 1, true);
  const file = new File(["model"], "model.stl");
  Object.defineProperty(file, "arrayBuffer", { value: jest.fn(async () => data) });
  return file;
}

beforeEach(() => {
  mockRenderers.length = 0;
  mockControls.length = 0;
  mockMaterials.length = 0;
  mockObservers.length = 0;
  mockRenderFailure = false;
  mockParseStl.mockReset();
  // jsdom lacks these APIs; the viewer's geometry and lifecycle remain real.
  const { TextDecoder, TextEncoder } = require("util");
  global.TextDecoder = TextDecoder;
  global.TextEncoder = TextEncoder;
  global.ResizeObserver = jest.fn().mockImplementation((callback) => {
    const observer = { observe: jest.fn(), disconnect: jest.fn(), callback };
    mockObservers.push(observer);
    return observer;
  });
  mockParseStl.mockImplementation(() => new BoxGeometry(10, 20, 30));
});

test("disposes the scene, renderer, controls, observer and canvas exactly once on unmount", async () => {
  const geometry = new BoxGeometry(10, 20, 30);
  const dispose = jest.spyOn(geometry, "dispose");
  mockParseStl.mockReturnValue(geometry);
  const { container, unmount } = render(<ThreeDViewer file={fileWithData()} />);
  await act(async () => {});
  expect(container.querySelector("canvas")).toBeInTheDocument();
  unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(mockMaterials[0].dispose).toHaveBeenCalledTimes(1);
  expect(mockControls[0].dispose).toHaveBeenCalledTimes(1);
  expect(mockObservers[0].disconnect).toHaveBeenCalledTimes(1);
  expect(mockRenderers[0].dispose).toHaveBeenCalledTimes(1);
  expect(mockRenderers[0].forceContextLoss).toHaveBeenCalledTimes(1);
  expect(mockRenderers[0].domElement.isConnected).toBe(false);
});

test("releases resources immediately after context loss while keeping a usable error message", async () => {
  const geometry = new BoxGeometry(10, 20, 30);
  const dispose = jest.spyOn(geometry, "dispose");
  mockParseStl.mockReturnValue(geometry);
  const file = fileWithData();
  const { container, rerender, unmount } = render(<ThreeDViewer file={file} />);
  await act(async () => {});
  const canvas = container.querySelector("canvas")!;
  const event = new Event("webglcontextlost", { cancelable: true });
  fireEvent(canvas, event);
  expect(event.defaultPrevented).toBe(true);
  expect(screen.getByRole("status")).toHaveTextContent("Stäng och öppna förhandsvisningen");
  expect(container.querySelector("canvas")).not.toBeInTheDocument();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(mockObservers[0].disconnect).toHaveBeenCalledTimes(1);
  const calls = mockRenderers[0].render.mock.calls.length;
  const keyEvent = new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true });
  canvas.dispatchEvent(keyEvent);
  expect(keyEvent.defaultPrevented).toBe(false);
  mockObservers[0].callback();
  expect(mockRenderers[0].render).toHaveBeenCalledTimes(calls);
  rerender(<ThreeDViewer file={file} color="#ff0000" />);
  expect(mockRenderers[0].render).toHaveBeenCalledTimes(calls);
  unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(mockRenderers[0].dispose).toHaveBeenCalledTimes(1);
});

test("releases parsed geometry after validation fails, before creating a renderer", async () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([NaN, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const dispose = jest.spyOn(geometry, "dispose");
  mockParseStl.mockReturnValue(geometry);
  const { unmount } = render(<ThreeDViewer file={fileWithData()} />);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("ogiltiga koordinater");
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(mockRenderers).toHaveLength(0);
  unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test("catches rendering failure and tears down resources even after initialization", async () => {
  const geometry = new BoxGeometry();
  const dispose = jest.spyOn(geometry, "dispose");
  mockParseStl.mockReturnValue(geometry);
  const { unmount } = render(<ThreeDViewer file={fileWithData()} />);
  await act(async () => {});
  mockRenderFailure = true;
  fireEvent.click(screen.getByRole("button", { name: "Zooma in" }));
  expect(screen.getByRole("status")).toHaveTextContent("3D-visningen avbröts");
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(mockRenderers[0].dispose).toHaveBeenCalledTimes(1);
  unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test("cleans up when the initial render fails and never enables viewer controls", async () => {
  mockRenderFailure = true;
  const geometry = new BoxGeometry();
  const dispose = jest.spyOn(geometry, "dispose");
  mockParseStl.mockReturnValue(geometry);
  const { container, unmount } = render(<ThreeDViewer file={fileWithData()} />);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("3D-visningen avbröts");
  expect(screen.queryByRole("button", { name: "Zooma in" })).not.toBeInTheDocument();
  expect(container.querySelector("canvas")).not.toBeInTheDocument();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(mockObservers[0].disconnect).toHaveBeenCalledTimes(1);
  unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test("does not parse or allocate a scene when the component unmounts during file reading", async () => {
  let resolve!: (data: ArrayBuffer) => void;
  const file = new File(["model"], "model.stl");
  Object.defineProperty(file, "arrayBuffer", { value: () => new Promise((done) => { resolve = done; }) });
  const { unmount } = render(<ThreeDViewer file={file} />);
  unmount();
  await act(async () => { resolve(new ArrayBuffer(134)); });
  expect(mockParseStl).not.toHaveBeenCalled();
  expect(mockRenderers).toHaveLength(0);
});

test("rejects a malicious binary count without invoking the STL loader", async () => {
  const data = new ArrayBuffer(84);
  new DataView(data).setUint32(80, 0xffffffff, true);
  render(<ThreeDViewer file={fileWithData(data)} />);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("för detaljerad");
  expect(mockParseStl).not.toHaveBeenCalled();
  expect(mockRenderers).toHaveLength(0);
});
