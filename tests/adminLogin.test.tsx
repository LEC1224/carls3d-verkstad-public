/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AdminLogin from "../src/pages/admin-login";

const mockReplace = jest.fn();
jest.mock("next/router", () => ({ useRouter: () => ({ query: { next: "/admin" }, replace: mockReplace }) }));
jest.mock("../src/components/Layout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock;
  mockReplace.mockReset().mockResolvedValue(true);
});
afterEach(() => { jest.useRealTimers(); });

function submitPassword() {
  fireEvent.change(screen.getByLabelText("Lösenord"), { target: { value: "local-test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Logga in" }));
}

test("aborts pending login on unmount and never redirects from a late successful response", async () => {
  let resolve!: (value: Response) => void;
  fetchMock.mockReturnValue(new Promise((done) => { resolve = done; }));
  const { unmount } = render(<AdminLogin />);
  submitPassword();
  const signal = fetchMock.mock.calls[0][1].signal;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { resolve(response({ ok: true, redirect: "/admin" })); });
  expect(mockReplace).not.toHaveBeenCalled();
});

test("recovers after a stalled login even if the transport ignores abort", async () => {
  jest.useFakeTimers();
  fetchMock.mockReturnValue(new Promise(() => {}));
  render(<AdminLogin />);
  submitPassword();
  expect(screen.getByLabelText("Lösenord")).toBeDisabled();
  await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
  expect(screen.getByRole("alert")).toHaveTextContent("tog för lång tid");
  expect(screen.getByLabelText("Lösenord")).toBeEnabled();
  expect(screen.getByRole("button", { name: "Logga in" })).toBeEnabled();
  expect(jest.getTimerCount()).toBe(0);
  fetchMock.mockResolvedValue(response({ ok: true, redirect: "/admin" }));
  fireEvent.click(screen.getByRole("button", { name: "Logga in" }));
  await act(async () => {});
  expect(mockReplace).toHaveBeenCalledWith("/admin");
});

test("keeps the login form available after rejected credentials and blocks duplicate submissions", async () => {
  let resolve!: (value: Response) => void;
  fetchMock.mockReturnValue(new Promise((done) => { resolve = done; }));
  const { container } = render(<AdminLogin />);
  submitPassword();
  fireEvent.submit(container.querySelector("form")!);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(response({ error: "Fel lösenord" }, false)); });
  expect(screen.getByRole("alert")).toHaveTextContent("Fel lösenord");
  expect(screen.getByLabelText("Lösenord")).toHaveValue("local-test-password");
  expect(screen.getByRole("button", { name: "Logga in" })).toBeEnabled();
  expect(mockReplace).not.toHaveBeenCalled();
});
