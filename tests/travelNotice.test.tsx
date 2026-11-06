/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import TravelNotice from "../src/components/TravelNotice";

let mockPathname = "/bestall";
jest.mock("next/router", () => ({ useRouter: () => ({ pathname: mockPathname }) }));
const period = { id: 1, startsOn: "2026-11-01T00:00:00.000Z", returnsOn: "2026-11-10T00:00:00.000Z" };
const response = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
let hidden = false;
let fetchMock: jest.Mock;
let originalHidden: PropertyDescriptor | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  mockPathname = "/bestall";
  hidden = false;
  originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  fetchMock = jest.fn().mockResolvedValue(response({ period }));
  global.fetch = fetchMock;
});

afterEach(() => {
  jest.useRealTimers();
  if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
  else delete (document as any).hidden;
});

it("only fetches on order pages and aborts an outstanding request when leaving", async () => {
  mockPathname = "/";
  const { rerender } = render(<TravelNotice />);
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockReturnValue(new Promise(() => {}));
  mockPathname = "/lithophane";
  rerender(<TravelNotice />);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  mockPathname = "/om-kontakt";
  rerender(<TravelNotice />);
  await act(async () => {});
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("ignores malformed dates without crashing and clears the notice only on an explicit empty result", async () => {
  render(<TravelNotice />);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("10 november 2026");
  fetchMock.mockResolvedValueOnce(response({ period: { ...period, returnsOn: "invalid" } }));
  await act(async () => { jest.advanceTimersByTime(5 * 60 * 1000); });
  expect(screen.getByRole("status")).toHaveTextContent("10 november 2026");
  fetchMock.mockResolvedValueOnce(response({ period: null }));
  await act(async () => { jest.advanceTimersByTime(5 * 60 * 1000); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("skips hidden-tab polling and refreshes immediately when the page becomes visible", async () => {
  render(<TravelNotice />);
  await act(async () => {});
  hidden = true;
  await act(async () => { jest.advanceTimersByTime(5 * 60 * 1000); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  hidden = false;
  fireEvent(document, new Event("visibilitychange"));
  await act(async () => {});
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("bounds a hung request and permits the next visible-page refresh", async () => {
  fetchMock.mockReturnValueOnce(new Promise(() => {}));
  render(<TravelNotice />);
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => { jest.advanceTimersByTime(10_000); });
  expect(signal.aborted).toBe(true);
  fireEvent(document, new Event("visibilitychange"));
  await act(async () => {});
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status")).toHaveTextContent("10 november 2026");
});
