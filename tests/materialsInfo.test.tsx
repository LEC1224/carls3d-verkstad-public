/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import MaterialsInfo from "../src/components/MaterialsInfo";

it("exposes expanded state and a description, closes on Escape and restores focus", () => {
  render(<MaterialsInfo material="PLA" />);
  const button = screen.getByRole("button", { name: "Info om PLA" });
  expect(button).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  const description = document.getElementById(button.getAttribute("aria-describedby")!);
  expect(description).toHaveTextContent("Snyggast finish");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(button).toHaveFocus();
  expect(description).not.toBeInTheDocument();
});

it("closes when focus moves to another control and gives each disclosure its own target", () => {
  render(<><MaterialsInfo material="PLA" /><MaterialsInfo material="PETG" /><input aria-label="Nästa fält" /></>);
  const pla = screen.getByRole("button", { name: "Info om PLA" });
  const petg = screen.getByRole("button", { name: "Info om PETG" });
  expect(pla.getAttribute("aria-controls")).not.toBe(petg.getAttribute("aria-controls"));
  fireEvent.click(pla);
  fireEvent.focusIn(screen.getByLabelText("Nästa fält"));
  expect(pla).toHaveAttribute("aria-expanded", "false");
});
