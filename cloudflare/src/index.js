import { DurableObject } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";
import { Buffer } from "node:buffer";

import { AuthKeyExchange } from "@mtproto2/mtproto";
import { TELEGRAM_RSA_KEYS } from "@mtproto2/crypto";

function toHex(data) {
  return Buffer.from(data)
    .toString("hex");
}

function createMessageId() {
  const seconds = BigInt(
    Math.floor(Date.now() / 1000)
  );

  return (seconds << 32n) + 4n;
}

function createMtprotoMessage(payload) {
  const body = Buffer.alloc(20 + payload.length);

  // auth_key_id = 0
  body.writeBigUInt64LE(0n, 0);

  // msg_id
  body.writeBigUInt64LE(
    createMessageId(),
    8
  );

  // message_data_length
  body.writeUInt32LE(
    payload.length,
    16
  );

  // payload
  Buffer.from(payload).copy(
    body,
    20
  );

  return body;
}

export class TelegramSession extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/mtproto-auth-test") {
      let socket = null;
      let writer = null;
      let reader = null;

      const debug = {
        sent: [],
        received: []
      };

      try {
        socket = connect({
          hostname: "149.154.167.51",
          port: 443
        });

        await socket.opened;

        writer =
          socket.writable.getWriter();

        reader =
          socket.readable.getReader();

        let firstPacket = true;
        let receiveBuffer = Buffer.alloc(0);

        const send = async (payload) => {
          const rawPayload =
            Buffer.from(payload);

          debug.sent.push({
            raw_bytes: rawPayload.length,
            raw_hex: toHex(rawPayload)
              .slice(0, 240)
          });

          const message =
            createMtprotoMessage(
              rawPayload
            );

          debug.sent.push({
            mtproto_bytes: message.length,
            mtproto_hex: toHex(message)
              .slice(0, 300)
          });

          // Abridged transport
          if (firstPacket) {
            await writer.write(
              new Uint8Array([0xef])
            );

            firstPacket = false;
          }

          const words =
            message.length / 4;

          if (!Number.isInteger(words)) {
            throw new Error(
              `Invalid MTProto message length: ${message.length}`
            );
          }

          if (words < 127) {
            await writer.write(
              new Uint8Array([words])
            );
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

          await writer.write(
            new Uint8Array(message)
          );

          while (true) {
            const {
              value,
              done
            } = await reader.read();

            if (done) {
              throw new Error(
                "Telegram closed TCP connection"
              );
            }

            if (!value) {
              continue;
            }

            const incoming =
              Buffer.from(value);

            debug.received.push({
              bytes: incoming.length,
              hex: toHex(incoming)
                .slice(0, 300)
            });

            receiveBuffer = Buffer.concat([
              receiveBuffer,
              incoming
            ]);

            if (receiveBuffer.length < 1) {
              continue;
            }

            let lengthBytes;
            let packetWords;

            if (
              receiveBuffer[0] === 0x7f
            ) {
              if (
                receiveBuffer.length < 4
              ) {
                continue;
              }

              packetWords =
                receiveBuffer[1] |
                (receiveBuffer[2] << 8) |
                (receiveBuffer[3] << 16);

              lengthBytes = 4;
            } else {
              packetWords =
                receiveBuffer[0];

              lengthBytes = 1;
            }

            const packetBytes =
              packetWords * 4;

            const totalBytes =
              lengthBytes + packetBytes;

            if (
              receiveBuffer.length <
              totalBytes
            ) {
              continue;
            }

            const packet =
              receiveBuffer.subarray(
                lengthBytes,
                totalBytes
              );

            receiveBuffer =
              receiveBuffer.subarray(
                totalBytes
              );

            // IMPORTANT:
            // AuthKeyExchange/TLReader expects Buffer,
            // not Uint8Array.
            return Buffer.from(packet);
          }
        };

        const exchange =
          new AuthKeyExchange({
            send,
            rsaKeys:
              TELEGRAM_RSA_KEYS,
            dcId: 2
          });

        const result =
          await exchange.execute();

        return Response.json({
          status: "ok",
          handshake: true,
          authKey: true,

          result: {
            authKeyId:
              result?.authKeyId
                ? toHex(result.authKeyId)
                : null,

            serverSalt:
              result?.serverSalt
                ? String(result.serverSalt)
                : null,

            timeOffset:
              result?.timeOffset ?? null
          },

          debug
        });

      } catch (error) {
        return Response.json(
          {
            status: "error",
            handshake: false,
            authKey: false,

            error: String(error),

            stack:
              error?.stack || null,

            debug
          },
          {
            status: 500
          }
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
      component: "TelegramSession"
    });
  }
}

export default {
  async fetch(request, env) {
    const url =
      new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        status: "ok",
        service: "ClientFlow",
        cloudflare: true
      });
    }

    if (
      url.pathname ===
      "/mtproto-auth-test"
    ) {
      const id =
        env.TELEGRAM_SESSION
          .idFromName("main");

      return env.TELEGRAM_SESSION
        .get(id)
        .fetch(request);
    }

    return new Response(
      "Not found",
      {
        status: 404
      }
    );
  }
};
