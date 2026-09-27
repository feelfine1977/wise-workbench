import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { QuestionControls } from "./QuestionControls";
import { expectNoSeriousA11yViolations } from "@/test/utils";

const activities = {values:["Accept request","Review request","Close request"],total:3,truncated:false};

it("uses run activities and only submits valid controls for the selected question",async()=>{
  const apply=vi.fn();const user=userEvent.setup();
  const {container}=render(<QuestionControls params={{family:"timing",source:"Accept request",target:"Close request",filter:'{"and":[]}'}} activities={activities} onApply={apply}/>);
  await user.selectOptions(screen.getByLabelText("Relationship"),"eventual");
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Explore this question"}));
  expect(apply).toHaveBeenLastCalledWith({family:"timing",source:"Accept request",target:"Close request",relation:"eventual",filter:'{"and":[]}'});
  await user.selectOptions(screen.getByLabelText("What would you like to understand?"),"repetition");
  await user.selectOptions(screen.getByLabelText("Activity"),"Review request");
  await user.click(screen.getByRole("button",{name:"Explore this question"}));
  expect(apply).toHaveBeenLastCalledWith({family:"repetition",activity:"Review request",filter:'{"and":[]}'});
  expect(screen.queryByLabelText("From activity")).not.toBeInTheDocument();
  await expectNoSeriousA11yViolations(container);
});

it("requires both activity endpoints and explains a truncated picker",async()=>{
  const apply=vi.fn();const user=userEvent.setup();
  render(<QuestionControls params={{family:"timing"}} activities={{...activities,total:103,truncated:true}} onApply={apply}/>);
  await user.click(screen.getByRole("button",{name:"Explore this question"}));
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByLabelText("From activity")).toBeRequired();
  expect(screen.getByLabelText("To activity")).toBeRequired();
  expect(screen.getByRole("status")).toHaveTextContent("3 most frequent activities out of 103");
});
