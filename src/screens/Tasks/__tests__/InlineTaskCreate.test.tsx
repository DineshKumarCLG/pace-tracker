import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InlineTaskCreate from "../InlineTaskCreate";
import { useTaskStore } from "@/stores/taskStore";

describe("InlineTaskCreate", () => {
  beforeEach(() => {
    useTaskStore.setState({ tasks: [], activeTaskId: null });
  });

  it("renders the '+ Add task' button initially", () => {
    render(<InlineTaskCreate projectId="proj-1" />);
    expect(screen.getByText("Add task")).toBeDefined();
  });

  it("shows inline input row when '+ Add task' is clicked", async () => {
    const user = userEvent.setup();
    render(<InlineTaskCreate projectId="proj-1" />);

    await user.click(screen.getByText("Add task"));

    expect(screen.getByPlaceholderText("Task title…")).toBeDefined();
  });

  it("auto-focuses the title input when opened", async () => {
    const user = userEvent.setup();
    render(<InlineTaskCreate projectId="proj-1" />);

    await user.click(screen.getByText("Add task"));

    const input = screen.getByPlaceholderText("Task title…");
    expect(document.activeElement).toBe(input);
  });

  it("creates a task on Enter with a non-empty title", async () => {
    const user = userEvent.setup();
    render(<InlineTaskCreate projectId="proj-1" />);

    await user.click(screen.getByText("Add task"));
    await user.type(screen.getByPlaceholderText("Task title…"), "New test task{Enter}");

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("New test task");
    expect(tasks[0].projectId).toBe("proj-1");
    expect(tasks[0].status).toBe("open");
    expect(tasks[0].priority).toBe("medium");
  });

  it("does NOT create a task on Enter with empty title", async () => {
    const user = userEvent.setup();
    render(<InlineTaskCreate projectId="proj-1" />);

    await user.click(screen.getByText("Add task"));
    await user.type(screen.getByPlaceholderText("Task title…"), "{Enter}");

    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it("does NOT create a task on Enter with whitespace-only title", async () => {
    const user = userEvent.setup();
    render(<InlineTaskCreate projectId="proj-1" />);

    await user.click(screen.getByText("Add task"));
    await user.type(screen.getByPlaceholderText("Task title…"), "   {Enter}");

    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it("hides the inline row on Escape", async () => {
    const user = userEvent.setup();
    render(<InlineTaskCreate projectId="proj-1" />);

    await user.click(screen.getByText("Add task"));
    expect(screen.getByPlaceholderText("Task title…")).toBeDefined();

    await user.keyboard("{Escape}");

    expect(screen.queryByPlaceholderText("Task title…")).toBeNull();
    expect(screen.getByText("Add task")).toBeDefined();
  });

  it("clears the input after creating a task (ready for next entry)", async () => {
    const user = userEvent.setup();
    render(<InlineTaskCreate projectId="proj-1" />);

    await user.click(screen.getByText("Add task"));
    const input = screen.getByPlaceholderText("Task title…") as HTMLInputElement;
    await user.type(input, "First task{Enter}");

    expect(input.value).toBe("");
    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });

  it("allows changing priority before creating", async () => {
    const user = userEvent.setup();
    render(<InlineTaskCreate projectId="proj-1" />);

    await user.click(screen.getByText("Add task"));

    // Open priority dropdown
    await user.click(screen.getByText("Med"));

    // Select high priority
    await user.click(screen.getByText("High"));

    await user.type(screen.getByPlaceholderText("Task title…"), "Urgent task{Enter}");

    const tasks = useTaskStore.getState().tasks;
    expect(tasks[0].priority).toBe("high");
  });

  it("falls back to default project when projectId is null", async () => {
    const user = userEvent.setup();
    render(<InlineTaskCreate projectId={null} />);

    await user.click(screen.getByText("Add task"));
    await user.type(screen.getByPlaceholderText("Task title…"), "Unassigned task{Enter}");

    const tasks = useTaskStore.getState().tasks;
    expect(tasks[0].projectId).toBe("proj-1");
  });
});
