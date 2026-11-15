// GSK Three Rockets v7 · Cloudflare Worker + Durable Object realtime relay
// - Static files (LED page, phone page, assets) come from ./public
// - /ws (or /<anything>/ws) upgrades to a WebSocket handled by one Durable Object per room
// - Phones -> LED only. LED -> everyone (or one phone when the message has `to`).
// - The latest LED "view" is kept, so a phone that connects late sees the current screen at once.

import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws" || url.pathname.endsWith("/ws")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const room = (url.searchParams.get("room") || "main").slice(0, 40);
      const stub = env.ROOM.get(env.ROOM.idFromName(room));
      return stub.fetch(request);
    }
    if (url.pathname === "/health") return new Response("ok");
    // Old links under /rockets/... keep working.
    if (url.pathname.startsWith("/rockets/") || url.pathname === "/rockets") {
      const u = new URL(request.url);
      u.pathname = url.pathname.replace(/^\/rockets/, "") || "/";
      return env.ASSETS.fetch(new Request(u, request));
    }
    return env.ASSETS.fetch(request);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lastView = null;
    ctx.blockConcurrencyWhile(async () => {
      this.lastView = (await ctx.storage.get("lastView")) || null;
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "led" ? "led" : "phone";
    const id = (url.searchParams.get("id") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const tags = [role];
    if (id) tags.push("id:" + id);
    this.ctx.acceptWebSocket(server, tags);
    if (role === "phone" && this.lastView) {
      try { server.send(this.lastView); } catch (e) {}
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  sendTo(sockets, data, except) {
    for (const ws of sockets) {
      if (ws === except) continue;
      try { ws.send(data); } catch (e) {}
    }
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > 4000) return;
    if (data === "ping") { try { ws.send("pong"); } catch (e) {} return; }
    const tags = this.ctx.getTags(ws);
    if (tags.includes("led")) {
      let m;
      try { m = JSON.parse(data); } catch (e) { return; }
      if (m && m.to) {
        this.sendTo(this.ctx.getWebSockets("id:" + m.to), data);
        return;
      }
      if (m && m.t === "view") {
        this.lastView = data;
        this.ctx.storage.put("lastView", data);
      }
      if (m && m.t === "reset") {
        this.lastView = null;
        this.ctx.storage.delete("lastView");
      }
      this.sendTo(this.ctx.getWebSockets("phone"), data);
      this.sendTo(this.ctx.getWebSockets("led"), data, ws);
    } else {
      this.sendTo(this.ctx.getWebSockets("led"), data);
    }
  }

  async webSocketClose(ws, code) {
    try { ws.close(code, "bye"); } catch (e) {}
  }

  async webSocketError(ws) {
    try { ws.close(1011, "error"); } catch (e) {}
  }
}
