import { Socket } from "socket.io";
import { ServerContext } from "./context.ts";
import { vlog } from "./vlog.ts";

export function registerVideoHandlers(socket: Socket, ctx: ServerContext): void {
  socket.on("get-video-devices", () => {
    socket.emit("video-devices-list", ctx.videoDeviceList);
  });

  socket.on("video-devices-update", (devices: { id: string; label: string }[]) => {
    vlog(`[VIDEO] Device list updated by source (${devices.length} devices):`, devices.map(d => d.label));
    ctx.videoDeviceList = devices;
    ctx.io.emit("video-devices-list", ctx.videoDeviceList);
  });

  socket.on("update-video-settings", (settings: { device?: string; videoWidth?: number; videoHeight?: number; framerate?: string }) => {
    vlog("[VIDEO] Updating video settings:", settings);
    ctx.videoSettings = { ...ctx.videoSettings, ...settings };
    ctx.saveSettings();
    ctx.io.emit("video-settings-updated", ctx.videoSettings);
  });

  socket.on("request-video-start", () => {
    vlog(`[VIDEO] Start requested by socket=${socket.id}`);
    ctx.videoAutoStart = true;
    ctx.saveSettings();
    ctx.io.emit("video-start-requested");
  });

  socket.on("request-video-stop", () => {
    vlog(`[VIDEO] Stop requested by socket=${socket.id}`);
    ctx.videoAutoStart = false;
    ctx.saveSettings();
    ctx.io.emit("video-stop-requested");
  });

  socket.on("video-source-start", (config: { device: string; videoWidth: number; videoHeight: number; framerate: string }) => {
    vlog(`[VIDEO] Source started: socket=${socket.id}`, config);
    ctx.videoSourceSocketId = socket.id;
    ctx.lastKeyframe = null;
    ctx.videoSettings = { ...ctx.videoSettings, ...config };
    ctx.videoStatus = "streaming";
    ctx.videoAutoStart = true;
    ctx.saveSettings();
    ctx.io.emit("video-source-status", {
      status: "streaming",
      videoWidth: config.videoWidth,
      videoHeight: config.videoHeight,
      framerate: config.framerate,
    });
  });

  let videoFrameRelayCount = 0;
  socket.on("video-frame", (chunk: { data: Buffer; type: string; timestamp: number; description?: Buffer }) => {
    if (socket.id !== ctx.videoSourceSocketId) return;
    if (chunk.type === "key") {
      ctx.lastKeyframe = chunk;
    }
    videoFrameRelayCount++;
    if (chunk.type === "key" || videoFrameRelayCount <= 5) {
      vlog(`[VIDEO] Relaying frame #${videoFrameRelayCount} type=${chunk.type} dataBytes=${chunk.data.byteLength} connectedClients=${ctx.io.engine.clientsCount}`);
    }
    socket.broadcast.emit("video-frame", chunk);
  });

  socket.on("video-source-stop", () => {
    if (socket.id !== ctx.videoSourceSocketId) return;
    vlog("[VIDEO] Source stopped.");
    ctx.videoSourceSocketId = null;
    ctx.lastKeyframe = null;
    ctx.videoStatus = "stopped";
    ctx.videoAutoStart = false;
    ctx.saveSettings();
    ctx.io.emit("video-source-status", { status: "stopped" });
  });
}
