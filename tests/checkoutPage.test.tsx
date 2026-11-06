/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderPage from "../src/pages/bestall";

jest.mock("../src/components/Layout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
jest.mock("../src/components/ModelPreview", () => ({
  __esModule: true,
  default: ({ file }: { file: File }) => <div data-testid="model-preview">{file.name}</div>,
}));

const colors = [{ value: "white", label: "Vit", hex: "#ffffff" }];
const breakdown = {
  packagingGrams: 50, materialCost: 50, fileFee: 0, baseFee: 50, shipping: 60, total: 160,
  items: [{ index: 0, name: "modell.stl", material: "PLA", color: "white", copies: 1, gramsEach: 100, perGram: 0.5, materialCost: 50 }],
};
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn(async (url: string) => {
    if (url.startsWith("/api/availability")) return response(colors);
    if (url === "/api/quote") return response({ breakdown });
    throw new Error("Unexpected endpoint: " + url);
  });
  global.fetch = fetchMock;
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

async function addModel(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText("STL- eller OBJ-filer"), new File(["solid model"], "modell.stl"));
  await screen.findByRole("button", { name: "Ta bort modell.stl" });
}

async function quote(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Beräkna pris" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Skicka beställning" })).toBeEnabled());
}

async function pickupDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("radio", { name: /Hämta hos mig/ }));
  await user.type(screen.getByLabelText("Namn"), "Anna Test");
  await user.type(screen.getByLabelText("E-post"), "anna@example.test");
  await user.type(screen.getByLabelText("Telefon"), "0701234567");
}

test("rejects unsupported and empty files without uploading them", async () => {
  render(<OrderPage />);
  const input = screen.getByLabelText("STL- eller OBJ-filer");
  fireEvent.change(input, { target: { files: [new File(["not a model"], "modell.exe")] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("format som inte stöds");
  fireEvent.change(input, { target: { files: [new File([], "modell.stl")] } });
  expect(screen.getByRole("alert")).toHaveTextContent("är tom");
  await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(5));
  expect(fetchMock.mock.calls.every(([url]) => url.startsWith("/api/availability"))).toBe(true);
});

test("does not offer unavailable colors when the inventory request fails", async () => {
  fetchMock.mockRejectedValue(new Error("Offline"));
  const user = userEvent.setup();
  render(<OrderPage />);
  await user.upload(screen.getByLabelText("STL- eller OBJ-filer"), new File(["model"], "modell.stl"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Kunde inte hämta tillgängliga färger");
  expect(screen.queryByRole("button", { name: "Ta bort modell.stl" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Beräkna pris" })).toBeDisabled();
});

test("ignores a stale quote after edits, even if the aborted fetch still resolves", async () => {
  const oldQuote = deferred<Response>();
  const user = userEvent.setup();
  render(<OrderPage />);
  await addModel(user);
  fetchMock.mockImplementation((url: string) => url === "/api/quote" ? oldQuote.promise : Promise.resolve(response(colors)));
  await user.click(screen.getByRole("button", { name: "Beräkna pris" }));
  const quoteCall = fetchMock.mock.calls.find(([url]) => url === "/api/quote");
  fireEvent.change(screen.getByLabelText("Kopior"), { target: { value: "2" } });
  expect(quoteCall?.[1].signal.aborted).toBe(true);
  await act(async () => { oldQuote.resolve(response({ breakdown })); });
  expect(screen.queryByText("160 kr")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Skicka beställning" })).toBeDisabled();
  fetchMock.mockResolvedValue(response({ breakdown: { ...breakdown, total: 210 } }));
  await quote(user);
  expect(screen.getByText("210 kr")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: /Hämta hos mig/ }));
  expect(screen.getByRole("button", { name: "Skicka beställning" })).toBeDisabled();
  expect(screen.queryByText("210 kr")).not.toBeInTheDocument();
});

test("shows network errors without losing the model and can recalculate", async () => {
  const user = userEvent.setup();
  render(<OrderPage />);
  await addModel(user);
  fetchMock.mockRejectedValueOnce(new Error("Offline"));
  await user.click(screen.getByRole("button", { name: "Beräkna pris" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Prisberäkningen kunde inte slutföras");
  expect(screen.getByRole("button", { name: "Ta bort modell.stl" })).toBeInTheDocument();
  await quote(user);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("requires valid whole-number copies and invalidates a price after coupon edits", async () => {
  const user = userEvent.setup();
  render(<OrderPage />);
  await addModel(user);
  fireEvent.change(screen.getByLabelText("Kopior"), { target: { value: "1.5" } });
  await user.click(screen.getByRole("button", { name: "Beräkna pris" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("helt antal kopior");
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/quote")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Kopior"), { target: { value: "1" } });
  await quote(user);
  await user.type(screen.getByLabelText("Rabattkod (valfritt)"), "SOMMAR");
  expect(screen.getByRole("button", { name: "Skicka beställning" })).toBeDisabled();
});

test("retains the previous material when the new material has no available colors", async () => {
  const user = userEvent.setup();
  render(<OrderPage />);
  await addModel(user);
  await quote(user);
  jest.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
  fetchMock.mockResolvedValueOnce(response([]));
  await user.selectOptions(screen.getByLabelText("Material"), "ASA");
  expect(await screen.findByRole("alert")).toHaveTextContent("Inga färger är tillgängliga för ASA");
  expect(screen.getByLabelText("Material")).toHaveValue("PLA");
  expect(screen.getByRole("button", { name: "Skicka beställning" })).toBeDisabled();
});

test("blocks duplicate submission and retains an accessible confirmation with the order number", async () => {
  const order = deferred<Response>();
  const user = userEvent.setup();
  render(<OrderPage />);
  await addModel(user);
  await pickupDetails(user);
  expect(screen.queryByLabelText("Adress")).not.toBeInTheDocument();
  await quote(user);
  fetchMock.mockImplementation((url: string) => url === "/api/order" ? order.promise : Promise.resolve(response(colors)));
  const form = screen.getByRole("form", { name: "Beställ 3D-utskrift" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/order")).toHaveLength(1);
  expect(screen.getByLabelText("Namn")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Ta bort modell.stl" })).toBeDisabled();
  await act(async () => { order.resolve(response({ success: true, orderNumber: "SP-2026-000123-ANNA", breakdown })); });
  expect(await screen.findByText("SP-2026-000123-ANNA")).toBeInTheDocument();
  expect(screen.getByText("Tack! Din beställning har skickats.").closest('[role="status"]')).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Ta bort modell.stl" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Namn")).toHaveValue("");
  expect(screen.getByText("anna@example.test")).toBeInTheDocument();
});

test("preserves customer details after an uncertain order failure", async () => {
  const user = userEvent.setup();
  render(<OrderPage />);
  await addModel(user);
  await pickupDetails(user);
  await quote(user);
  fetchMock.mockRejectedValueOnce(new Error("Connection closed"));
  await user.click(screen.getByRole("button", { name: "Skicka beställning" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("innan du skickar igen");
  expect(screen.getByLabelText("Namn")).toHaveValue("Anna Test");
  expect(screen.getByLabelText("E-post")).toHaveValue("anna@example.test");
  expect(screen.getByRole("button", { name: "Ta bort modell.stl" })).toBeInTheDocument();
  expect(screen.queryByText("Tack! Din beställning har skickats.")).not.toBeInTheDocument();
});

test("opens only one model preview at a time and removes it with its cart item", async () => {
  const user = userEvent.setup();
  render(<OrderPage />);
  await addModel(user);
  await user.click(screen.getByRole("button", { name: "Duplicera modell.stl" }));
  expect(screen.queryByTestId("model-preview")).not.toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "Visa modell i 3D" })[0]);
  expect(screen.getAllByTestId("model-preview")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Visa modell i 3D" }));
  expect(screen.getAllByTestId("model-preview")).toHaveLength(1);
  await user.click(screen.getAllByRole("button", { name: "Ta bort modell.stl" })[1]);
  expect(screen.queryByTestId("model-preview")).not.toBeInTheDocument();
});

test("refreshes expired inventory without losing files and requires a replacement color", async () => {
  const user = userEvent.setup();
  render(<OrderPage />);
  await addModel(user);
  fetchMock.mockResolvedValueOnce(response({
    error: "Den valda färgen är inte längre tillgänglig för PLA. Välj en annan färg.",
    code: "COLOR_UNAVAILABLE",
  }, false));
  fetchMock.mockResolvedValueOnce(response([{ value: "red", label: "Röd", hex: "#ff0000" }]));
  await user.click(screen.getByRole("button", { name: "Beräkna pris" }));
  await waitFor(() => expect(screen.getByLabelText("Färg")).toHaveValue(""));
  expect(screen.getByRole("button", { name: "Ta bort modell.stl" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Vit" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Beräkna pris" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Välj en tillgänglig färg");
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/quote")).toHaveLength(1);
  await user.selectOptions(screen.getByLabelText("Färg"), "red");
  await quote(user);
});

test("recovers the file picker after an availability deadline and allows a retry", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  fetchMock.mockImplementation(() => new Promise(() => {}));
  render(<OrderPage />);
  const input = screen.getByLabelText("STL- eller OBJ-filer");
  await user.upload(input, new File(["model"], "modell.stl"));
  expect(input).toBeDisabled();
  await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
  expect(screen.getByRole("alert")).toHaveTextContent("tog för lång tid att hämta färgerna");
  expect(input).toBeEnabled();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  fetchMock.mockResolvedValue(response(colors));
  await addModel(user);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("removing an item with a stalled material lookup immediately releases the remaining cart", async () => {
  const pending = deferred<Response>();
  const user = userEvent.setup();
  render(<OrderPage />);
  await addModel(user);
  await user.click(screen.getByRole("button", { name: "Duplicera modell.stl" }));
  jest.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
  fetchMock.mockReturnValueOnce(pending.promise);
  await user.selectOptions(screen.getAllByLabelText("Material")[0], "ASA");
  expect(screen.getByRole("button", { name: "Beräkna pris" })).toBeDisabled();
  await user.click(screen.getAllByRole("button", { name: "Ta bort modell.stl" })[0]);
  expect(screen.getByRole("button", { name: "Beräkna pris" })).toBeEnabled();
  await act(async () => { pending.resolve(response([])); });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("recovers quote controls after a stalled quote without discarding the model", async () => {
  const user = userEvent.setup();
  render(<OrderPage />);
  await addModel(user);
  jest.useFakeTimers();
  const timerUser = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  fetchMock.mockImplementation(() => new Promise(() => {}));
  await timerUser.click(screen.getByRole("button", { name: "Beräkna pris" }));
  await act(async () => { await jest.advanceTimersByTimeAsync(90_000); });
  expect(screen.getByRole("alert")).toHaveTextContent("Prisberäkningen tog för lång tid");
  expect(screen.getByRole("button", { name: "Beräkna pris" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Ta bort modell.stl" })).toBeInTheDocument();
});

test("preserves sold-out material selection and functional-purpose metadata", async () => {
  fetchMock.mockImplementation(async (url: string) => url === "/api/quote" ? response({ breakdown }) : response(url.endsWith("=PLA") ? [] : colors));
  const user = userEvent.setup();
  render(<OrderPage />);
  await waitFor(() => expect(screen.getByLabelText("Standardmaterial")).toHaveValue("PETG"));
  expect(screen.getByRole("option", { name: "PLA (slut)" })).toBeDisabled();
  await addModel(user);
  await user.selectOptions(screen.getByLabelText("Användning"), "functional");
  await quote(user);
  const form = fetchMock.mock.calls.find(([url]) => url === "/api/quote")![1].body as FormData;
  expect(JSON.parse(String(form.get("itemsMeta")))[0]).toMatchObject({ material: "PETG", purpose: "functional" });
});
