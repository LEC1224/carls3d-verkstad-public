/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Admin from "../src/pages/admin";

const mockReplace = jest.fn();
jest.mock("next/router", () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock("../src/components/Layout", () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }));

const makeOrder = (id: number) => ({
  id, orderNumber: `TEST-${String(id).padStart(3, "0")}`, createdAt: "2026-11-06T12:00:00Z",
  name: `Kund ${id}`, email: `kund${id}@example.test`, type: "standard", price: 100,
  status: "Ny", deliveryMethod: "shipping", files: ["token model.stl"], city: "Uppsala",
});

function response(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

let orders: ReturnType<typeof makeOrder>[];
let fetchMock: jest.Mock;

function getResponse(input: string) {
  return Promise.resolve(response(input === "/api/orders" ? orders : []));
}

beforeEach(() => {
  orders = [makeOrder(1)];
  fetchMock = jest.fn(getResponse);
  global.fetch = fetchMock;
  mockReplace.mockReset();
});

it("shows a failed load with a working retry and keeps writes disabled until data arrives", async () => {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  render(<Admin />);
  expect(screen.getByText("Laddar bortresor…")).toBeVisible();
  expect(screen.getByText("Laddar rabattkoder…")).toBeVisible();
  expect(screen.getByText("Laddar färgtillgänglighet…")).toBeVisible();
  expect(screen.queryByRole("button", { name: "PLA Vit" })).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Kontrollera anslutningen");
  expect(screen.getByText("Bortresorna kunde inte hämtas.")).toBeVisible();
  expect(screen.getByText("Rabattkoderna kunde inte hämtas.")).toBeVisible();
  expect(screen.getByText("Färgtillgängligheten kunde inte hämtas.")).toBeVisible();
  expect(screen.queryByText("Inga bortresor registrerade.")).not.toBeInTheDocument();
  expect(screen.queryByText("Inga rabattkoder ännu.")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "PLA Vit" })).not.toBeInTheDocument();
  expect(screen.queryByText("0 av 0 ordrar matchar")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Lägg till" })).toBeDisabled();
  const refresh = screen.getByRole("button", { name: "Uppdatera" });
  expect(refresh).toBeEnabled();

  fetchMock.mockImplementation(getResponse);
  fireEvent.click(refresh);
  expect(await screen.findByText("TEST-001")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Lägg till" })).toBeEnabled();
  expect(screen.getByText("Inga bortresor registrerade.")).toBeVisible();
  expect(screen.getByText("Inga rabattkoder ännu.")).toBeVisible();
  expect(screen.getByRole("button", { name: "PLA Vit" })).toHaveAttribute("aria-pressed", "true");
});

it("blocks repeated actions, reports an HTTP error, and allows a successful retry", async () => {
  let resolveMutation: (value: Response) => void;
  const pendingResponse = new Promise<Response>((resolve) => { resolveMutation = resolve; });
  fetchMock.mockImplementation((url, options) => options?.method === "PATCH" ? pendingResponse : getResponse(url));
  render(<Admin />);
  const complete = await screen.findByRole("button", { name: "Markera order TEST-001 som klar" });
  fireEvent.click(complete);
  expect(complete).toBeDisabled();
  fireEvent.click(complete);
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(1);

  await act(async () => resolveMutation(response({ error: "Ordern kunde inte sparas." }, 500)));
  expect(await screen.findByRole("alert")).toHaveTextContent("Ordern kunde inte sparas.");
  expect(complete).toBeEnabled();
  expect(screen.getByText("Ny", { exact: true })).toBeVisible();

  fetchMock.mockImplementation((url, options) => {
    if (options?.method === "PATCH") {
      orders = [{ ...orders[0], status: "Klar" }];
      return Promise.resolve(response({ ok: true }));
    }
    return getResponse(url);
  });
  fireEvent.click(complete);
  await waitFor(() => expect(screen.getByText("Klar", { exact: true })).toBeVisible());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Markera order TEST-001 som klar" })).not.toBeInTheDocument();
});

it("paginates orders and resets to the first page when filtering", async () => {
  orders = Array.from({ length: 26 }, (_, index) => makeOrder(index + 1));
  orders[25] = { ...orders[25], name: "Åsa Öberg", deliveryMethod: "pickup", type: "lithophane" };
  render(<Admin />);
  await screen.findByText("TEST-001");
  const list = screen.getByRole("region", { name: "Orderlista" });
  expect(within(list).queryByText("TEST-026")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Nästa sida" }));
  expect(within(list).getByText("TEST-026")).toBeVisible();
  expect(within(list).queryByText("TEST-001")).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Sök order"), { target: { value: "ASA" } });
  expect(within(list).getByText("TEST-026")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Nästa sida" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Leverans", { selector: "select" }), { target: { value: "shipping" } });
  expect(within(list).getByText(/Inga ordrar matchar/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Rensa filter" }));
  expect(within(list).getByText("TEST-001")).toBeVisible();
});

it("stays on the clamped page after deleting the final row and later receiving more orders", async () => {
  orders = Array.from({ length: 51 }, (_, index) => makeOrder(index + 1));
  const confirmation = jest.spyOn(window, "confirm").mockReturnValue(true);
  fetchMock.mockImplementation((url, options) => {
    if (options?.method === "DELETE") {
      orders = orders.filter((order) => order.id !== 51);
      return Promise.resolve(response({ ok: true }));
    }
    return getResponse(url);
  });
  try {
    render(<Admin />);
    await screen.findByText("TEST-001");
    fireEvent.click(screen.getByRole("button", { name: "Nästa sida" }));
    fireEvent.click(screen.getByRole("button", { name: "Nästa sida" }));
    expect(screen.getByText("Sida 3 av 3")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Radera order TEST-051" }));
    expect(await screen.findByText("Sida 2 av 2")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Uppdatera" })).toBeEnabled());

    orders = [...orders, makeOrder(52)];
    fireEvent.click(screen.getByRole("button", { name: "Uppdatera" }));
    expect(await screen.findByText("Sida 2 av 3")).toBeVisible();
    expect(screen.getByText("TEST-026")).toBeVisible();
    expect(screen.queryByText("TEST-052")).not.toBeInTheDocument();
  } finally {
    confirmation.mockRestore();
  }
});

it("keeps the last loaded orders visible when a refresh fails", async () => {
  render(<Admin />);
  await screen.findByText("TEST-001");
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  fireEvent.click(screen.getByRole("button", { name: "Uppdatera" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Senast hämtade uppgifter visas");
  expect(screen.getByText("TEST-001")).toBeVisible();
});

it("redirects an expired session to login instead of accepting failed actions", async () => {
  fetchMock.mockResolvedValue(response({ error: "Unauthorized" }, 401));
  render(<Admin />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/admin-login?next=%2Fadmin"));
});

it.each([200, 401])("ignores a delayed write response with status %i after unmount", async (status) => {
  let resolveWrite: (value: Response) => void;
  const write = new Promise<Response>((resolve) => { resolveWrite = resolve; });
  fetchMock.mockImplementation((url, options) => options?.method === "PATCH" ? write : getResponse(url));
  const { unmount } = render(<StrictMode><Admin /></StrictMode>);
  fireEvent.click(await screen.findByRole("button", { name: "Markera order TEST-001 som klar" }));
  const callCount = fetchMock.mock.calls.length;
  unmount();

  await act(async () => resolveWrite(response(status === 401 ? { error: "Unauthorized" } : { ok: true }, status)));
  expect(mockReplace).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(callCount);
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(1);
});

it.each([200, 401])("ignores a delayed write response body with status %i after unmount", async (status) => {
  let resolveBody: (value: unknown) => void;
  const body = new Promise((resolve) => { resolveBody = resolve; });
  const json = jest.fn(() => body);
  fetchMock.mockImplementation((url, options) => options?.method === "PATCH"
    ? Promise.resolve({ ok: status === 200, status, json })
    : getResponse(url));
  const { unmount } = render(<StrictMode><Admin /></StrictMode>);
  fireEvent.click(await screen.findByRole("button", { name: "Markera order TEST-001 som klar" }));
  await waitFor(() => expect(json).toHaveBeenCalled());
  const callCount = fetchMock.mock.calls.length;
  unmount();

  await act(async () => resolveBody(status === 401 ? { error: "Unauthorized" } : { ok: true }));
  expect(mockReplace).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(callCount);
});

it("keeps the selected product filter available after deleting its last order", async () => {
  orders = [{ ...makeOrder(1), type: "lithophane" }];
  const confirmation = jest.spyOn(window, "confirm").mockReturnValue(true);
  fetchMock.mockImplementation((url, options) => {
    if (options?.method === "DELETE") {
      orders = [];
      return Promise.resolve(response({ ok: true }));
    }
    return getResponse(url);
  });
  render(<Admin />);
  await screen.findByText("TEST-001");
  fireEvent.change(screen.getByLabelText("Produkt"), { target: { value: "lithophane" } });
  fireEvent.click(screen.getByRole("button", { name: "Radera order TEST-001" }));
  await waitFor(() => expect(screen.queryByText("TEST-001")).not.toBeInTheDocument());
  expect(screen.getByLabelText("Produkt")).toHaveValue("lithophane");
  expect(screen.getByRole("option", { name: "Lithophane-lampa" })).toBeInTheDocument();
  confirmation.mockRestore();
});

it("releases reload and logout when one read endpoint stalls, then permits recovery", async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockImplementation((url) => url === "/api/admin/coupons" ? new Promise(() => {}) : getResponse(url));
    render(<Admin />);
    expect(screen.getByRole("button", { name: "Uppdaterar…" })).toBeDisabled();
    await act(async () => { jest.advanceTimersByTime(15_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Hämtningen tog för lång tid");
    expect(screen.getByRole("button", { name: "Logga ut" })).toBeEnabled();
    const refresh = screen.getByRole("button", { name: "Uppdatera" });
    expect(refresh).toBeEnabled();
    const couponCall = fetchMock.mock.calls.find(([url]) => url === "/api/admin/coupons");
    expect(couponCall[1].signal.aborted).toBe(true);
    fetchMock.mockImplementation(getResponse);
    fireEvent.click(refresh);
    await act(async () => {});
    expect(screen.getByText("TEST-001")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});
