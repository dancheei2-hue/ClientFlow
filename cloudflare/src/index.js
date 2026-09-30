import { DurableObject } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";

function toHex(data) {
  return Array.from(data)
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

export class TelegramSession extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/telegram-pq-test") {
      let socket;

      try {
        socket = connect({
          hostname: "149.154.167.51",
          port: 443
        });

        await socket.opened;

        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // req_pq_multi
        const packet = new Uint8Array(40);
        const view = new DataView(packet.buffer);

        // auth_key_id = 0
        // bytes 0..7 already zero

        // message_id
        const messageId =
          (BigInt(Math.floor(Date.now() / 1000)) << 32n) + 4n;

        view.setBigUint64(8, messageId, true);

        // message length = 20
        view.setUint32(16, 20, true);

        // req_pq_multi constructor
        view.setUint32(20, 0xbe7e8ef1, true);

        // nonce
        crypto.getRandomValues(packet.subarray(24, 40));

        // Abridged transport
        await writer.write(new Uint8Array([0xef]));

        // 40 bytes / 4 = 10
        await writer.write(new Uint8Array([10]));

        await writer.write(packet);

        // Read Telegram response
        const { value, done } = await reader.read();

        if (done || !value) {
          throw new Error("Telegram closed connection after req_pq_multi");
        }

        const response = new Uint8Array(value);

        return Response.json({
          status: "ok",
          tcp: true,
          telegram_response: true,
          response_bytes: response.length,
          response_hex: toHex(response.slice(0, 80)),
          message: "Telegram answered req_pq_multi"
        });

      } catch (error) {
        return Response.json({
          status: "error",
          tcp: true,
          telegram_response: false,
          error: String(error),
          stack: error?.stack || null
        }, { status: 500 });

      } finally {
        try {
          await socket?.close();
        } catch {}
      }
    }

    return Response.json({
      status: "ok",
      component: "TelegramSession"
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        status: "ok",
        service: "ClientFlow",
        cloudflare: true
      });
    }

    if (url.pathname === "/telegram-pq-test") {
      const id = env.TELEGRAM_SESSION.idFromName("main");
      return env.TELEGRAM_SESSION.get(id).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
