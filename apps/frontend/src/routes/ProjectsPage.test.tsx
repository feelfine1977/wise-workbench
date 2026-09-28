import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "@/mocks/node";
import { renderApp, expectNoSeriousA11yViolations } from "@/test/utils";

it("starts at projects and creates a process project with the entered business question", async () => {
  const user = userEvent.setup();
  let saved: unknown;
  server.use(http.post("*/api/v1/projects", async ({ request }) => {
    saved = await request.json();
    return HttpResponse.json({ ...(saved as object), id: "new-project", createdAt: "2026-09-27T00:00:00Z" }, { status: 201 });
  }));
  renderApp("/");
  await screen.findByRole("heading", { name: "Your process improvement projects" });
  await user.click(screen.getByRole("button", { name: "New project" }));
  const dialog = screen.getByRole("dialog");
  expect(screen.getByRole("button", { name: "Create project & choose data" })).toBeDisabled();
  await user.type(screen.getByLabelText("Project name"), "Delivery improvement");
  await user.selectOptions(screen.getByLabelText("Process", { exact: true }), "o2c");
  await user.type(screen.getByLabelText("What do you want to improve?"), "Reduce delivery delays");
  await expectNoSeriousA11yViolations(dialog);
  await user.click(screen.getByRole("button", { name: "Create project & choose data" }));
  await waitFor(() => expect(saved).toEqual({ name: "Delivery improvement", process: "o2c", question: "Reduce delivery delays" }));
  await screen.findByRole("heading", { name: "Data and mapping" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
