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
      throw new Error("Invalid abridged header");
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

  return data.subarray(
    offset,
    offset + length
  );
}

function parseMtprotoMessage(packet) {
  if (packet.length < 20) {
    throw new Error(
      `MTProto packet too short: ${packet.length}`
    );
  }

  const authKeyId =
    packet.readBigUInt64LE(0);

  const messageId =
    packet.readBigUInt64LE(8);

  const length =
    packet.readUInt32LE(16);

  if (packet.length < 20 + length) {
    throw new Error(
      `Invalid message length: ${length}`
    );
  }

  return {
    authKeyId,
    messageId,
    length,
    body: packet.subarray(
      20,
      20 + length
    )
  };
}

function parseResPQ(body) {
  const constructor =
    body.readUInt32LE(0);

  if (constructor !== 0x05162463) {
    throw new Error(
      `Unexpected constructor: 0x${constructor
        .toString(16)
        .padStart(8, "0")}`
    );
  }

  let offset = 4;

  const nonce =
    body.subarray(offset, offset + 16);

  offset += 16;

  const serverNonce =
    body.subarray(offset, offset + 16);

  offset += 16;

  const pqLength =
    body.readUInt8(offset);

  offset += 1;

  const pq =
    body.subarray(
      offset,
      offset + pqLength
    );

  return {
    nonce,
    serverNonce,
    pq
  };
}

function bufferToBigIntLE(buffer) {
  let result = 0n;

  for (let i = buffer.length - 1; i >= 0; i--) {
    result =
      (result << 8n) |
      BigInt(buffer[i]);
  }

  return result;
}

function bigIntToBufferLE(value, length) {
  const result = Buffer.alloc(length);

  let n = value;

  for (let i = 0; i < length; i++) {
    result[i] = Number(n & 0xffn);
    n >>= 8n;
  }

  return result;
}

function gcd(a, b) {
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }

  return a;
}

function pollardRho(n) {
  if (n % 2n === 0n) {
    return 2n;
  }

  let x = 2n;
  let y = 2n;
  let d = 1n;

  const f = (v) =>
    (v * v + 1n) % n;

  let iterations = 0;

  while (d === 1n && iterations < 1000000) {
    x = f(x);
    y = f(f(y));

    d = gcd(
      x > y ? x - y : y - x,
      n
    );

    iterations++;
  }

  if (d !== 1n && d !== n) {
    return d;
  }

  throw new Error(
    "Pollard Rho failed"
  );
}

function factorPQ(pqBuffer) {
  const pq =
    bufferToBigIntLE(pqBuffer);

  if (pq <= 1n) {
    throw new Error("Invalid pq");
  }

  let factor = pollardRho(pq);

  let other = pq / factor;

  if (factor > other) {
    [factor, other] =
      [other, factor];
  }

  return {
    pq,
    p: factor,
    q: other
  };
}

export class TelegramSession extends DurableObject {
  async fetch(request) {
    const url =
      new URL(request.url);

    if (url.pathname === "/telegram-pq-factor-test") {
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

          const packet =
            parseAbridgedPacket(
              receiveBuffer
            );

          const mtproto =
            parseMtprotoMessage(
              packet
            );

          const resPQ =
            parseResPQ(
              mtproto.body
            );

          const factors =
            factorPQ(resPQ.pq);

          const pBuffer =
            bigIntToBufferLE(
              factors.p,
              4
            );

          const qBuffer =
            bigIntToBufferLE(
              factors.q,
              4
            );

          return Response.json({
            status: "ok",

            mtproto: true,
            resPQ: true,
            factorization: true,

            pq:
              toHex(resPQ.pq),

            p:
              factors.p.toString(),

            q:
              factors.q.toString(),

            p_hex:
              toHex(pBuffer),

            q_hex:
              toHex(qBuffer),

            verification:
              (
                factors.p *
                factors.q
              ).toString() ===
              factors.pq.toString()
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
      "/telegram-pq-factor-test"
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
