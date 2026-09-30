import { DurableObject } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";
import { AuthKeyExchange } from "@mtproto2/mtproto";
import { TELEGRAM_RSA_KEYS } from "@mtproto2/crypto";

export class TelegramSession extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/mtproto-auth-test") {
      let socket;

      try {
        socket = connect({
          hostname: "149.154.167.51",
          port: 443
        });

        await socket.opened;

        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        let firstPacket = true;
        let buffer = new Uint8Array(0);

        const send = async (data) => {
          const packet = new Uint8Array(data);

          // Abridged transport
          if (firstPacket) {
            await writer.write(new Uint8Array([0xef]));
            firstPacket = false;
          }

          const words = packet.length / 4;

          if (words < 127) {
            await writer.write(new Uint8Array([words]));
          } else {
            await writer.write(
              new Uint8Array([
                0x7f,
                words & 0xff,
                (words >> 8) & 0xff,
                (words >> 16) & 0xff
              ])
            );
          }

          await writer.write(packet);

          while (true) {
            const { value, done } = await reader.read();

            if (done) {
              throw new Error("Telegram closed TCP connection");
            }

            const incoming = new Uint8Array(value);

            const merged = new Uint8Array(
              buffer.length + incoming.length
            );

            merged.set(buffer);
            merged.set(incoming, buffer.length);
            buffer = merged;

            if (buffer.length < 1) {
              continue;
            }

            let lengthBytes = 1;
            let length;

            if (buffer[0] === 0x7f) {
              if (buffer.length < 4) {
                continue;
              }

              length =
                buffer[1] |
                (buffer[2] << 8) |
                (buffer[3] << 16);

              lengthBytes = 4;
            } else {
              length = buffer[0];
            }

            const total = lengthBytes + length * 4;

            if (buffer.length < total) {
              continue;
            }

            const payload = buffer.slice(lengthBytes, total);
            buffer = buffer.slice(total);

            return payload;
          }
        };

        const exchange = new AuthKeyExchange({
          send,
          rsaKeys: TELEGRAM_RSA_KEYS,
          dcId: 2
        });

        const result = await exchange.execute();

        return Response.json({
          status: "ok",
          mtproto: true,
          handshake: true,
          authKey: true,
          authKeyId: Buffer.from(result.authKeyId).toString("hex"),
          serverSalt: String(result.serverSalt),
          timeOffset: result.timeOffset
        });

      } catch (error) {
        return Response.json({
          status: "error",
          mtproto: false,
          handshake: false,
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

    if (url.pathname === "/mtproto-auth-test") {
      const id = env.TELEGRAM_SESSION.idFromName("main");
      return env.TELEGRAM_SESSION.get(id).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
