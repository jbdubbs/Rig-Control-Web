import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ChangePasswordModal from "./ChangePasswordModal";

function makeFakeSocket() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  return {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emit: vi.fn(),
    __emitServerEvent(event: string, data: unknown) {
      listeners.get(event)?.forEach((h) => h(data));
    },
  } as any;
}

function fillAndSubmit(container: HTMLElement, values: [string, string, string]) {
  const inputs = container.querySelectorAll('input[type="password"]');
  fireEvent.change(inputs[0], { target: { value: values[0] } });
  fireEvent.change(inputs[1], { target: { value: values[1] } });
  fireEvent.change(inputs[2], { target: { value: values[2] } });
  fireEvent.click(screen.getByRole("button", { name: /save password/i }));
}

describe("ChangePasswordModal", () => {
  it("registers a single auth:op-result listener and removes it on unmount", () => {
    const socket = makeFakeSocket();
    const onSuccess = vi.fn();
    const { unmount } = render(
      <ChangePasswordModal socket={socket} callsign="N0CALL" forced={true} onSuccess={onSuccess} />
    );

    expect(socket.on).toHaveBeenCalledTimes(1);
    expect(socket.on).toHaveBeenCalledWith("auth:op-result", expect.any(Function));
    const handler = socket.on.mock.calls[0][1];

    unmount();

    expect(socket.off).toHaveBeenCalledWith("auth:op-result", handler);
  });

  it("calls onSuccess when the server confirms the password change", () => {
    const socket = makeFakeSocket();
    const onSuccess = vi.fn();
    const { container } = render(
      <ChangePasswordModal socket={socket} callsign="N0CALL" forced={true} onSuccess={onSuccess} />
    );

    fillAndSubmit(container, ["oldpass1", "newpass1", "newpass1"]);

    expect(socket.emit).toHaveBeenCalledWith("auth:change-password", {
      currentPassword: "oldpass1",
      newPassword: "newpass1",
    });

    act(() => socket.__emitServerEvent("auth:op-result", { ok: true }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("shows the server error and does not call onSuccess on failure", () => {
    const socket = makeFakeSocket();
    const onSuccess = vi.fn();
    const { container } = render(
      <ChangePasswordModal socket={socket} callsign="N0CALL" forced={true} onSuccess={onSuccess} />
    );

    fillAndSubmit(container, ["oldpass1", "newpass1", "newpass1"]);
    act(() => socket.__emitServerEvent("auth:op-result", { ok: false, error: "Incorrect current password" }));

    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByText("Incorrect current password")).toBeInTheDocument();
  });

  it("does not stack a second listener across multiple submits", () => {
    const socket = makeFakeSocket();
    const onSuccess = vi.fn();
    const { container } = render(
      <ChangePasswordModal socket={socket} callsign="N0CALL" forced={true} onSuccess={onSuccess} />
    );

    fillAndSubmit(container, ["oldpass1", "newpass1", "newpass1"]);
    act(() => socket.__emitServerEvent("auth:op-result", { ok: false, error: "nope" }));
    fillAndSubmit(container, ["oldpass1", "newpass2", "newpass2"]);

    // A single listener registered for the component's lifetime, regardless of submit count.
    expect(socket.on).toHaveBeenCalledTimes(1);
  });

  it("does not throw when a late response arrives after unmount", () => {
    const socket = makeFakeSocket();
    const onSuccess = vi.fn();
    const { container, unmount } = render(
      <ChangePasswordModal socket={socket} callsign="N0CALL" forced={true} onSuccess={onSuccess} />
    );

    fillAndSubmit(container, ["oldpass1", "newpass1", "newpass1"]);
    unmount();

    expect(() => socket.__emitServerEvent("auth:op-result", { ok: true })).not.toThrow();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
