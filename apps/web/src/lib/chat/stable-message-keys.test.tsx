// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createStableKeyState, stableMessageKeys } from "./stable-message-keys";

type Message = { id: string; role: string; runId?: string; text: string };

function List({
  messages,
  state,
}: {
  messages: Message[];
  state: ReturnType<typeof createStableKeyState>;
}) {
  const keys = stableMessageKeys(messages, state);
  return (
    <div>
      {messages.map((message) => (
        <p key={keys.get(message.id)} data-gente-msg="theirs">
          {message.text}
        </p>
      ))}
    </div>
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("stable message keys", () => {
  it("keeps the same element when a streamed reply becomes the saved message", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const state = createStableKeyState();
    const user = { id: "m1", role: "user", text: "build me a landing page" };
    act(() =>
      root.render(
        <List
          state={state}
          messages={[user, { id: "progress:r1", role: "bot", runId: "r1", text: "Here is" }]}
        />,
      ),
    );
    const streaming = host.querySelectorAll("p")[1];
    act(() =>
      root.render(
        <List
          state={state}
          messages={[user, { id: "m2", role: "bot", runId: "r1", text: "Here is your page." }]}
        />,
      ),
    );
    const saved = host.querySelectorAll("p")[1];
    expect(saved).toBe(streaming);
    expect(saved?.textContent).toBe("Here is your page.");
    act(() => root.unmount());
  });

  it("gives a run's next live row a new key once one was handed on", () => {
    const state = createStableKeyState();
    stableMessageKeys([{ id: "progress:r1", role: "bot", runId: "r1" }], state);
    const after = stableMessageKeys(
      [
        { id: "m2", role: "bot", runId: "r1" },
        { id: "progress:r1", role: "bot", runId: "r1" },
      ],
      state,
    );
    expect(after.get("m2")).not.toBe(after.get("progress:r1"));
  });
});
