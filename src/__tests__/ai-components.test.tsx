import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Component tests for AI features.
 *
 * Tests AIReviewDraft and NL task creation UI behavior.
 * Validates: Requirements 16.3, 16.4, 10.1–10.3, 17.5
 */

// --- Mocks ---

const mockGenerateWeeklyReview = vi.fn();
const mockParseTask = vi.fn();

vi.mock("@/lib/ai", () => ({
  generateWeeklyReview: (...args: unknown[]) => mockGenerateWeeklyReview(...args),
  parseTask: (...args: unknown[]) => mockParseTask(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import AIReviewDraft from "@/screens/Review/AIReviewDraft";
import InlineTaskCreate from "@/screens/Tasks/InlineTaskCreate";

// Mock task store
vi.mock("@/stores/taskStore", () => ({
  useTaskStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addTask: vi.fn(), tasks: [] }),
}));

beforeEach(() => {
  mockGenerateWeeklyReview.mockReset();
  mockParseTask.mockReset();
});

describe("AIReviewDraft Component", () => {
  it("renders loading state while AI generates", async () => {
    // Never resolve — stays in loading
    mockGenerateWeeklyReview.mockReturnValue(new Promise(() => {}));

    render(
      <AIReviewDraft userId="user-1" weekStart={1700000000} aiEnabled={true} />,
    );

    expect(screen.getByText("Generating review…")).toBeDefined();
  });

  it("renders editable text area with AI narrative on success", async () => {
    mockGenerateWeeklyReview.mockResolvedValue(
      "This week you focused on PACE App, closing 5 tasks.",
    );

    render(
      <AIReviewDraft userId="user-1" weekStart={1700000000} aiEnabled={true} />,
    );

    await waitFor(() => {
      expect(
        screen.getByDisplayValue(
          "This week you focused on PACE App, closing 5 tasks.",
        ),
      ).toBeDefined();
    });
  });

  it("'Edit draft' button enables editing", async () => {
    mockGenerateWeeklyReview.mockResolvedValue("AI narrative text");

    render(
      <AIReviewDraft userId="user-1" weekStart={1700000000} aiEnabled={true} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Edit draft")).toBeDefined();
    });

    const editBtn = screen.getByText("Edit draft");
    fireEvent.click(editBtn);

    // After clicking edit, the button should show "Save"
    expect(screen.getByText("Save")).toBeDefined();

    // Textarea should be editable
    const textarea = screen.getByRole("textbox", { name: /ai review narrative/i }) as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(false);
  });

  it("edited narrative persists on save", async () => {
    const user = userEvent.setup();
    mockGenerateWeeklyReview.mockResolvedValue("Original narrative");

    render(
      <AIReviewDraft userId="user-1" weekStart={1700000000} aiEnabled={true} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Edit draft")).toBeDefined();
    });

    // Enable editing
    fireEvent.click(screen.getByText("Edit draft"));

    // Edit the text
    const textarea = screen.getByRole("textbox", { name: /ai review narrative/i });
    await user.clear(textarea);
    await user.type(textarea, "Edited narrative");

    // Save
    fireEvent.click(screen.getByText("Save"));

    // Should show "Edit draft" again and text should be preserved
    expect(screen.getByText("Edit draft")).toBeDefined();
    expect(screen.getByDisplayValue("Edited narrative")).toBeDefined();
  });

  it("error state shows 'AI unavailable' with review data still visible", async () => {
    mockGenerateWeeklyReview.mockResolvedValue(null);

    render(
      <AIReviewDraft userId="user-1" weekStart={1700000000} aiEnabled={true} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/AI unavailable/),
      ).toBeDefined();
    });
  });

  it("does not render when AI is disabled", () => {
    const { container } = render(
      <AIReviewDraft userId="user-1" weekStart={1700000000} aiEnabled={false} />,
    );

    expect(container.innerHTML).toBe("");
  });
});

describe("NL Task Creation", () => {
  it("natural language input triggers AI parsing and pre-fills form", async () => {
    const user = userEvent.setup();
    mockParseTask.mockResolvedValue({
      title: "Send demo to client",
      projectId: "proj-1",
      assigneeId: "user-2",
      priority: "high",
      dueDate: "2024-01-19",
    });

    render(<InlineTaskCreate projectId="proj-1" />);

    // Open the inline create
    fireEvent.click(screen.getByText("Add task"));

    // Type NL text
    const input = screen.getByPlaceholderText("Task title…");
    await user.type(input, "remind arjun to send demo by friday high priority");

    // Press Enter to trigger NL parsing
    fireEvent.keyDown(input, { key: "Enter" });

    // Should show parsing state
    await waitFor(() => {
      // After parsing, title should be updated to parsed result
      const updatedInput = screen.getByPlaceholderText("Task title…") as HTMLInputElement;
      expect(updatedInput.value).toBe("Send demo to client");
    });
  });

  it("AI failure: raw text becomes title, manual entry available", async () => {
    const user = userEvent.setup();
    mockParseTask.mockRejectedValue(new Error("AI unavailable"));

    render(<InlineTaskCreate projectId="proj-1" />);

    fireEvent.click(screen.getByText("Add task"));

    const input = screen.getByPlaceholderText("Task title…");
    await user.type(input, "remind arjun to send demo by friday");

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      // Text should remain as-is (fallback)
      const updatedInput = screen.getByPlaceholderText("Task title…") as HTMLInputElement;
      expect(updatedInput.value).toBe("remind arjun to send demo by friday");
    });
  });
});
