import { DurableObject } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";
import { Buffer } from "node:buffer";

function toHex(data) {
  return Buffer.from(data).toString("hex");
}

function createMessageId() {
  const seconds = BigInt(Math.floor(Date.now() / 1000));
  return (seconds << 32n) + 4n;
}

function createReqPqMulti(nonce) {
  const payload = Buffer.alloc(20);

  payload.writeUInt32LE(0xbe7e8ef1, 0);

  Buffer.from(nonce).copy(payload, 4);

  return payload;
}

function createMtprotoMessage(payload) {
  const body = Buffer.alloc(20 + payload.length);

  body.writeBigUInt64LE(0n, 0);
  body.writeBigUInt64LE(createMessageId(), 8);
  body.writeUInt32LE(payload.length, 16);

  Buffer.from(payload).copy(body, 20);

  return body;
}

function parseAbridgedPacket(buffer) {
  const data = Buffer.from(buffer);

  if (data.length < 1) {
    throw new Error("Empty Telegram response");
  }

  let offset = 0;
  let words;

  if (data[0] === 0x7f) {
    if (data.length < 4) {
      throw new Error("Invalid long abridged header");
    }

    words =
      data[1] |
      (data[2] << 8) |
      (data[3] << 16);

    offset = 4;
  } else {
    words = data[0];
    offset = 1;
  }

  const length = words * 4;

  if (data.length < offset + length) {
    throw new Error(
      `Incomplete packet: need ${offset + length}, got ${data.length}`
    );
  }

  return data.subarray(offset, offset + length);
}

function parseMtprotoMessage(packet) {
  if (packet.length < 20) {
    throw new Error(
      `MTProto message too short: ${packet.length}`
    );
  }

  const authKeyId = packet.readBigUInt64LE(0);
  const messageId = packet.readBigUInt64LE(8);
  const length = packet.readUInt32LE(16);

  if (packet.length < 20 + length) {
    throw new Error(
      `Invalid message length: ${length}`
    );
  }

  const body = packet.subarray(
    20,
    20 + length
  );

  return {
    authKeyId,
    messageId,
    length,
    body
  };
}

function parseResPQ(body) {
  if (body.length < 4) {
    throw new Error("resPQ body too short");
  }

  const constructor = body.readUInt32LE(0);

  // resPQ#05162463
  if (constructor !== 0x05162463) {
    throw new Error(
      `Unexpected constructor: 0x${constructor
        .toString(16)
        .padStart(8, "0")}`
    );
  }

  let offset = 4;

  const nonce = body.subarray(offset, offset + 16);
  offset += 16;

  const serverNonce =
    body.subarray(offset, offset + 16);
  offset += 16;

  const pqLength = body.readUInt8(offset);
  offset += 1;

  const pq = body.subarray(
    offset,
    offset + pqLength
  );
  offset += pqLength;

  return {
    constructor,
    nonce,
    serverNonce,
    pq,
    remaining: body.subarray(offset)
  };
}

export class TelegramSession extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/telegram-pq-test") {
      let socket = null;
      let writer = null;
      let reader = null;

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

        const nonce =
          crypto.getRandomValues(
            new Uint8Array(16)
          );

        const payload =
          createReqPqMulti(nonce);

        const message =
          createMtprotoMessage(payload);

        // Abridged transport
        await writer.write(
          new Uint8Array([0xef])
        );

        const words =
          message.length / 4;

        await writer.write(
          new Uint8Array([words])
        );

        await writer.write(
          new Uint8Array(message)
        );

        let receiveBuffer =
          Buffer.alloc(0);

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

          receiveBuffer =
            Buffer.concat([
              receiveBuffer,
              Buffer.from(value)
            ]);

          if (receiveBuffer.length < 1) {
            continue;
          }

          const packet =
            parseAbridgedPacket(
              receiveBuffer
            );

          const mtproto =
            parseMtprotoMessage(packet);

          const resPQ =
            parseResPQ(mtproto.body);

          return Response.json({
            status: "ok",
            tcp: true,
            telegram: true,
            mtproto: true,
            resPQ: true,

            constructor:
              "0x" +
              resPQ.constructor
                .toString(16)
                .padStart(8, "0"),

            nonce: toHex(resPQ.nonce),

            server_nonce:
              toHex(resPQ.serverNonce),

            pq:
              toHex(resPQ.pq),

            pq_bytes:
              resPQ.pq.length,

            auth_key_id:
              mtproto.authKeyId.toString(),

            message_id:
              mtproto.messageId.toString(),

            message_length:
              mtproto.length
          });
        }

      } catch (error) {
        return Response.json(
          {
            status: "error",
            error: String(error),
            stack:
              error?.stack || null
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
      "/telegram-pq-test"
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
