import { DurableObject } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";
import { AuthKeyExchange } from "@mtproto2/mtproto";
import { TELEGRAM_RSA_KEYS } from "@mtproto2/crypto";

function toHex(data) {
  return Array.from(new Uint8Array(data))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export class TelegramSession extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/mtproto-auth-test") {
      let socket = null;
      let writer = null;
      let reader = null;

      const debug = {
        sent_packets: [],
        received_packets: [],
      };

      try {
        socket = connect({
          hostname: "149.154.167.51",
          port: 443,
        });

        await socket.opened;

        writer = socket.writable.getWriter();
        reader = socket.readable.getReader();

        let firstPacket = true;
        let buffer = new Uint8Array(0);

        const send = async (data) => {
          const payload = new Uint8Array(data);

          debug.sent_packets.push({
            bytes: payload.length,
            hex: toHex(payload).slice(0, 200),
          });

          if (firstPacket) {
            await writer.write(new Uint8Array([0xef]));
            firstPacket = false;
          }

          const words = payload.length / 4;

          if (!Number.isInteger(words)) {
            throw new Error(
              `MTProto packet length is not divisible by 4: ${payload.length}`
            );
          }

          if (words < 127) {
            await writer.write(new Uint8Array([words]));
          } else {
            await writer.write(
              new Uint8Array([
                0x7f,
                words & 0xff,
                (words >> 8) & 0xff,
                (words >> 16) & 0xff,
              ])
            );
          }

          await writer.write(payload);

          while (true) {
            const { value, done } = await reader.read();

            if (done) {
              throw new Error("Telegram closed TCP connection");
            }

            if (!value) {
              continue;
            }

            const incoming = new Uint8Array(value);

            debug.received_packets.push({
              bytes: incoming.length,
              hex: toHex(incoming).slice(0, 200),
            });

            const merged = new Uint8Array(
              buffer.length + incoming.length
            );

            merged.set(buffer);
            merged.set(incoming, buffer.length);

            buffer = merged;

            if (buffer.length < 1) {
              continue;
            }

            let lengthBytes;
            let packetLength;

            if (buffer[0] === 0x7f) {
              if (buffer.length < 4) {
                continue;
              }

              packetLength =
                buffer[1] |
                (buffer[2] << 8) |
                (buffer[3] << 16);

              lengthBytes = 4;
            } else {
              packetLength = buffer[0];
              lengthBytes = 1;
            }

            const totalLength =
              lengthBytes + packetLength * 4;

            if (buffer.length < totalLength) {
              continue;
            }

            const packet = buffer.slice(
              lengthBytes,
              totalLength
            );

            buffer = buffer.slice(totalLength);

            return packet;
          }
        };

        const exchange = new AuthKeyExchange({
          send,
          rsaKeys: TELEGRAM_RSA_KEYS,
          dcId: 2,
        });

        const result = await exchange.execute();

        return Response.json({
          status: "ok",
          handshake: true,
          authKey: true,
          result: {
            authKeyId: result?.authKeyId
              ? toHex(result.authKeyId)
              : null,
            serverSalt: result?.serverSalt
              ? String(result.serverSalt)
              : null,
            timeOffset: result?.timeOffset ?? null,
          },
          debug,
        });

      } catch (error) {
        return Response.json(
          {
            status: "error",
            handshake: false,
            error: String(error),
            stack: error?.stack || null,
            debug,
          },
          { status: 500 }
        );

      } finally {
        try {
          reader?.releaseLock();
        } catch {}

        try {
          writer?.releaseLock();
        } catch {}

        try {
          await socket?.close();
        } catch {}
      }
    }

    return Response.json({
      status: "ok",
      component: "TelegramSession",
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
        cloudflare: true,
      });
    }

    if (url.pathname === "/mtproto-auth-test") {
      const id = env.TELEGRAM_SESSION.idFromName("main");

      return env.TELEGRAM_SESSION
        .get(id)
        .fetch(request);
    }

    return new Response("Not found", {
      status: 404,
    });
  },
};
