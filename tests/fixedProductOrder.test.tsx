/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FixedProductOrderForm from "../src/components/FixedProductOrderForm";

const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve: resolve! };
}
const fetchMock = jest.fn();

beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
  URL.createObjectURL = jest.fn(() => "blob:test-image");
  URL.revokeObjectURL = jest.fn();
});

async function fillPickup() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("radio", { name: /Hämta hos mig/ }));
  await user.type(screen.getByLabelText("Namn", { exact: true }), "Testkund");
  await user.type(screen.getByLabelText("E-post", { exact: true }), "test@example.invalid");
  await user.type(screen.getByLabelText("Telefon", { exact: true }), "0700000000");
  return user;
}

it("uses pickup pricing and retains the server's order confirmation after submission", async () => {
  fetchMock.mockResolvedValue(response({ success: true, orderNumber: "SP-TEST-1", price: 440 }));
  render(<FixedProductOrderForm product="minecraft-torch" />);
  const user = await fillPickup();
  await user.clear(screen.getByLabelText("Antal facklor"));
  await user.type(screen.getByLabelText("Antal facklor"), "2");
  expect(screen.queryByLabelText("Adress", { exact: true })).not.toBeInTheDocument();
  expect(screen.getByText("440 kr")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Skicka beställning" }));
  expect(await screen.findByText("SP-TEST-1")).toBeInTheDocument();
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body).toMatchObject({ quantity: 2, deliveryMethod: "pickup", name: "Testkund" });
  expect(screen.queryByRole("button", { name: "Skicka beställning" })).not.toBeInTheDocument();
});

it("locks the form immediately and sends only one request for repeated submissions", async () => {
  const pending = deferred<Response>();
  fetchMock.mockReturnValue(pending.promise);
  const { container } = render(<FixedProductOrderForm product="minecraft-torch" />);
  await fillPickup();
  fireEvent.submit(container.querySelector("form")!);
  fireEvent.submit(container.querySelector("form")!);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Antal facklor")).toBeDisabled();
  await act(async () => pending.resolve(response({ success: true, orderNumber: "SP-TEST-2", price: 240 })));
  expect(screen.getByText("SP-TEST-2")).toBeInTheDocument();
});

it("does not display a stale coupon price after the delivery method changes", async () => {
  const pending = deferred<Response>();
  fetchMock.mockReturnValue(pending.promise);
  render(<FixedProductOrderForm product="minecraft-torch" />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Rabattkod (valfritt)"), "TEST");
  await user.click(screen.getByRole("button", { name: "Tillämpa" }));
  await user.click(screen.getByRole("radio", { name: /Hämta hos mig/ }));
  await act(async () => pending.resolve(response({ price: 150, coupon: { code: "TEST" } })));
  expect(screen.getByText("240 kr")).toBeInTheDocument();
  expect(screen.queryByText("150 kr")).not.toBeInTheDocument();
  expect(screen.queryByText(/Rabattkod TEST tillämpad/)).not.toBeInTheDocument();
});

it("requires applying the typed coupon before sending an order", async () => {
  render(<FixedProductOrderForm product="minecraft-torch" />);
  const user = await fillPickup();
  await user.type(screen.getByLabelText("Rabattkod (valfritt)"), "UNCHECKED");
  await user.click(screen.getByRole("button", { name: "Skicka beställning" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Tillämpa rabattkoden");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("unblocks checkout when a coupon is removed during a pending check", async () => {
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response({ success: true, orderNumber: "SP-NO-COUPON", price: 240 }));
  render(<FixedProductOrderForm product="minecraft-torch" />);
  const user = await fillPickup();
  await user.type(screen.getByLabelText("Rabattkod (valfritt)"), "WAIT");
  await user.click(screen.getByRole("button", { name: "Tillämpa" }));
  expect(screen.getByRole("button", { name: "Skicka beställning" })).toBeDisabled();
  await user.clear(screen.getByLabelText("Rabattkod (valfritt)"));
  expect(screen.getByRole("button", { name: "Skicka beställning" })).toBeEnabled();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await user.click(screen.getByRole("button", { name: "Skicka beställning" }));
  expect(await screen.findByText("SP-NO-COUPON")).toBeInTheDocument();
  await act(async () => pending.resolve(response({ price: 100, coupon: { code: "WAIT" } })));
  expect(screen.getByText("240 kr")).toBeInTheDocument();
});

it("preserves entered details on network failure and warns against duplicate retries", async () => {
  fetchMock.mockRejectedValue(new TypeError("Network disconnected"));
  render(<FixedProductOrderForm product="minecraft-torch" />);
  const user = await fillPickup();
  await user.click(screen.getByRole("button", { name: "Skicka beställning" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("innan du skickar igen");
  expect(screen.getByLabelText("Namn", { exact: true })).toHaveValue("Testkund");
  expect(screen.getByRole("button", { name: "Skicka beställning" })).toBeEnabled();
});

it("collects four lamp photos across selections and releases preview URLs", async () => {
  fetchMock.mockResolvedValue(response({ success: true, orderNumber: "SP-LAMP", price: 440 }));
  const { unmount } = render(<FixedProductOrderForm product="lithophane" />);
  const user = await fillPickup();
  const files = [1, 2, 3, 4].map((number) => new File(["photo"], `photo-${number}.jpg`, { type: "image/jpeg" }));
  await user.upload(screen.getByLabelText("Dina fyra bilder"), files.slice(0, 2));
  expect(screen.getByText("2 av 4 bilder valda")).toBeInTheDocument();
  await user.upload(screen.getByLabelText("Dina fyra bilder"), files.slice(2));
  expect(screen.getByText("4 av 4 bilder valda")).toBeInTheDocument();
  expect(screen.getByLabelText("Dina fyra bilder")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Skicka beställning" }));
  expect(await screen.findByText("SP-LAMP")).toBeInTheDocument();
  const body = fetchMock.mock.calls[0][1].body as FormData;
  expect(body.getAll("images")).toHaveLength(4);
  expect(body.get("deliveryMethod")).toBe("pickup");
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(6);
});

it("keeps selected photos when a new file is invalid", async () => {
  render(<FixedProductOrderForm product="lithophane" />);
  const user = userEvent.setup({ applyAccept: false });
  await user.upload(screen.getByLabelText("Dina fyra bilder"), new File(["photo"], "good.jpg", { type: "image/jpeg" }));
  await user.upload(screen.getByLabelText("Dina fyra bilder"), new File(["text"], "notes.txt", { type: "text/plain" }));
  expect(screen.getByRole("alert")).toHaveTextContent("JPG-, PNG- eller WebP");
  expect(screen.getByText("1 av 4 bilder valda")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("reports server validation errors without showing a success confirmation", async () => {
  fetchMock.mockResolvedValue(response({ error: "Rabattkoden är inte giltig." }, false));
  render(<FixedProductOrderForm product="minecraft-torch" />);
  const user = await fillPickup();
  await user.click(screen.getByRole("button", { name: "Skicka beställning" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Rabattkoden är inte giltig."));
  expect(screen.queryByText("Tack! Din beställning har skickats.")).not.toBeInTheDocument();
});
