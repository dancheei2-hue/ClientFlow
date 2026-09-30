import { connect } from "cloudflare:sockets";
import { Buffer } from "node:buffer";

const DC_ID = 2;
const DC_HOST = "149.154.167.51";
const DC_PORT = 443;

const PQ_CONSTRUCTOR = 0xbe7e8ef1;
const RES_PQ_CONSTRUCTOR = 0x05162463;

function hex(buffer) {
  return Buffer.from(buffer).toString("hex");
}

function randomBytes(length) {
  const b = new Uint8Array(length);
  crypto.getRandomValues(b);
  return Buffer.from(b);
}

function bufferToBigIntBE(buffer) {
  let result = 0n;

  for (const byte of buffer) {
    result = (result << 8n) | BigInt(byte);
  }

  return result;
}

function bigIntToBufferBE(value, length) {
  const result = Buffer.alloc(length);
  let n = value;

  for (let i = length - 1; i >= 0; i--) {
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

function abs(a) {
  return a < 0n ? -a : a;
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  base %= modulus;

  while (exponent > 0n) {
    if (exponent & 1n) {
      result = (result * base) % modulus;
    }

    base = (base * base) % modulus;
    exponent >>= 1n;
  }

  return result;
}

function isPrime(n) {
  if (n < 2n) return false;

  const smallPrimes = [
    2n, 3n, 5n, 7n, 11n, 13n, 17n,
    19n, 23n, 29n, 31n, 37n
  ];

  for (const p of smallPrimes) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }

  let d = n - 1n;
  let s = 0;

  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }

  // Deterministic enough for the 64-bit number we receive from Telegram.
  const bases = [
    2n,
    325n,
    9375n,
    28178n,
    450775n,
    9780504n,
    1795265022n
  ];

  for (let a of bases) {
    if (a % n === 0n) continue;

    let x = modPow(a, d, n);

    if (x === 1n || x === n - 1n) {
      continue;
    }

    let composite = true;

    for (let r = 1; r < s; r++) {
      x = (x * x) % n;

      if (x === n - 1n) {
        composite = false;
        break;
      }
    }

    if (composite) {
      return false;
    }
  }

  return true;
}

function randomBigInt(max) {
  if (max <= 1n) return 0n;

  const bits = max.toString(2).length;
  const bytes = Math.ceil(bits / 8);

  while (true) {
    const buf = randomBytes(bytes);

    let value = 0n;

    for (const byte of buf) {
      value = (value << 8n) | BigInt(byte);
    }

    value %= max;

    if (value > 0n) {
      return value;
    }
  }
}

/*
 * Brent's variant of Pollard Rho.
 *
 * It is substantially more reliable here than the simple
 * Floyd implementation.
 */
function pollardRho(n) {
  if (n % 2n === 0n) return 2n;
  if (n % 3n === 0n) return 3n;
  if (n % 5n === 0n) return 5n;

  for (let attempt = 0; attempt < 80; attempt++) {
    const y0 = 1n + randomBigInt(n - 1n);
    const c = 1n + randomBigInt(n - 1n);

    let y = y0;
    let r = 1n;
    let q = 1n;

    let g = 1n;
    let x = 0n;
    let ys = 0n;

    let iterations = 0;

    while (g === 1n && iterations < 2_000_000) {
      x = y;

      for (let i = 0n; i < r; i++) {
        y = (y * y + c) % n;
      }

      let k = 0n;

      while (k < r && g === 1n) {
        ys = y;

        const limit = r - k < 128n ? r - k : 128n;

        for (let i = 0n; i < limit; i++) {
          y = (y * y + c) % n;

          const diff = abs(x - y);

          q = (q * diff) % n;

          if (q === 0n) {
            g = n;
            break;
          }
        }

        g = gcd(q, n);

        k += limit;
        iterations++;
      }

      r <<= 1n;

      if (r > 4_000_000n) {
        break;
      }
    }

    if (g === n) {
      do {
        ys = (ys * ys + c) % n;

        g = gcd(abs(x - ys), n);
      } while (g === 1n);
    }

    if (g > 1n && g < n) {
      return g;
    }
  }

  throw new Error("Pollard Rho failed after 80 attempts");
}

function factorPQ(n) {
  if (n < 2n) {
    throw new Error("Invalid pq");
  }

  if (isPrime(n)) {
    return [n];
  }

  const divisor = pollardRho(n);

  const left = factorPQ(divisor);
  const right = factorPQ(n / divisor);

  return [...left, ...right].sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
}

function readUInt32LE(buffer, offset) {
  return Buffer.from(buffer).readUInt32LE(offset);
}

function readUInt64LE(buffer, offset) {
  return Buffer.from(buffer).readBigUInt64LE(offset);
}

function parseResPQ(buffer) {
  const data = Buffer.from(buffer);

  if (data.length < 4) {
    throw new Error("Telegram response is too short");
  }

  const constructor = readUInt32LE(data, 0);

  if (constructor !== RES_PQ_CONSTRUCTOR) {
    throw new Error(
      `Unexpected constructor: 0x${constructor
        .toString(16)
        .padStart(8, "0")}`
    );
  }

  let offset = 4;

  const nonce = data.subarray(offset, offset + 16);
  offset += 16;

  const serverNonce = data.subarray(offset, offset + 16);
  offset += 16;

  const pqLength = data[offset];
  offset += 1;

  const pq = data.subarray(offset, offset + pqLength);
  offset += pqLength;

  return {
    constructor,
    nonce,
    serverNonce,
    pq,
    offset
  };
}

function writeInt64LE(value) {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(value));
  return b;
}

function makeReqPqMulti(nonce) {
  const body = Buffer.alloc(4 + 16);

  body.writeUInt32LE(PQ_CONSTRUCTOR, 0);
  nonce.copy(body, 4);

  return body;
}

function makePlainMtprotoPacket(body) {
  /*
   * MTProto unencrypted message:
   *
   * auth_key_id   int64 = 0
   * msg_id        int64
   * msg_len       int32
   * body
   */

  const msgId = BigInt(Date.now()) * 1000000n;

  const packet = Buffer.alloc(8 + 8 + 4 + body.length);

  let offset = 0;

  packet.writeBigUInt64LE(0n, offset);
  offset += 8;

  packet.writeBigUInt64LE(msgId, offset);
  offset += 8;

  packet.writeUInt32LE(body.length, offset);
  offset += 4;

  body.copy(packet, offset);

  return packet;
}

function makeAbridgedPacket(payload) {
  const length = payload.length;

  if (length % 4 !== 0) {
    throw new Error(
      `MTProto payload must be divisible by 4, got ${length}`
    );
  }

  const words = length / 4;

  let header;

  if (words < 127) {
    header = Buffer.from([words]);
  } else {
    header = Buffer.from([
      0x7f,
      words & 0xff,
      (words >> 8) & 0xff,
      (words >> 16) & 0xff
    ]);
  }

  return Buffer.concat([header, payload]);
}

async function readExactly(reader, length) {
  const chunks = [];
  let total = 0;

  while (total < length) {
    const { value, done } = await reader.read();

    if (done) {
      throw new Error("Telegram socket closed while reading");
    }

    if (!value || value.length === 0) {
      continue;
    }

    chunks.push(Buffer.from(value));
    total += value.length;
  }

  if (total === length) {
    return Buffer.concat(chunks);
  }

  const result = Buffer.alloc(length);

  let offset = 0;

  for (const chunk of chunks) {
    const take = Math.min(chunk.length, length - offset);

    chunk.copy(result, offset, 0, take);

    offset += take;

    if (offset >= length) break;
  }

  return result;
}

async function readAbridgedPacket(reader) {
  const first = await readExactly(reader, 1);

  let words;

  if (first[0] === 0x7f) {
    const ext = await readExactly(reader, 3);

    words =
      ext[0] |
      (ext[1] << 8) |
      (ext[2] << 16);
  } else {
    words = first[0];
  }

  if (words <= 0) {
    throw new Error(`Invalid Telegram packet length: ${words}`);
  }

  const bytes = words * 4;

  return readExactly(reader, bytes);
}

async function telegramReqPq() {
  const socket = connect({
    hostname: DC_HOST,
    port: DC_PORT
  });

  await socket.opened;

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  try {
    const nonce = randomBytes(16);

    const body = makeReqPqMulti(nonce);

    const packet = makePlainMtprotoPacket(body);

    const framed = makeAbridgedPacket(packet);

    await writer.write(framed);

    const response = await readAbridgedPacket(reader);

    const parsed = parseResPQ(response);

    if (!parsed.nonce.equals(nonce)) {
      throw new Error("Telegram nonce mismatch");
    }

    return parsed;
  } finally {
    try {
      reader.releaseLock();
    } catch {}

    try {
      writer.releaseLock();
    } catch {}

    try {
      await socket.close();
    } catch {}
  }
}

export class TelegramSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/telegram-pq-factor-test") {
      try {
        const parsed = await telegramReqPq();

        const pqHex = hex(parsed.pq);

        /*
         * IMPORTANT:
         *
         * Telegram's `bytes` value is interpreted as a
         * big-endian integer here.
         */
        const pq = bufferToBigIntBE(parsed.pq);

        const factors = factorPQ(pq);

        const product = factors.reduce(
          (a, b) => a * b,
          1n
        );

        const verification = product === pq;

        return Response.json({
          status: verification ? "ok" : "error",

          telegram: true,
          mtproto: true,

          constructor:
            "0x" +
            parsed.constructor
              .toString(16)
              .padStart(8, "0"),

          pq_hex: pqHex,
          pq_decimal: pq.toString(),

          factors: factors.map(x => x.toString()),

          factors_hex: factors.map(
            x => "0x" + x.toString(16)
          ),

          verification,

          p: factors[0]
            ? factors[0].toString()
            : null,

          q: factors[1]
            ? factors[1].toString()
            : null,

          p_hex: factors[0]
            ? "0x" + factors[0].toString(16)
            : null,

          q_hex: factors[1]
            ? "0x" + factors[1].toString(16)
            : null
        });
      } catch (error) {
        return Response.json(
          {
            status: "error",
            error: String(error?.stack || error)
          },
          {
            status: 500
          }
        );
      }
    }

    if (url.pathname === "/telegram-test") {
      return Response.json({
        status: "ok",
        durable_object: true,
        message: "TelegramSession is running"
      });
    }

    if (url.pathname === "/tcp-test") {
      try {
        const socket = connect({
          hostname: DC_HOST,
          port: DC_PORT
        });

        await socket.opened;

        try {
          return Response.json({
            status: "ok",
            tcp: true,
            telegram: true,
            remote: `${DC_HOST}:${DC_PORT}`
          });
        } finally {
          try {
            await socket.close();
          } catch {}
        }
      } catch (error) {
        return Response.json(
          {
            status: "error",
            tcp: false,
            error: String(error?.stack || error)
          },
          {
            status: 500
          }
        );
      }
    }

    return new Response("Not found", {
      status: 404
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/telegram-")) {
      const id =
        env.TELEGRAM_SESSION.idFromName("main");

      const stub =
        env.TELEGRAM_SESSION.get(id);

      return stub.fetch(request);
    }

    if (url.pathname === "/") {
      return Response.json({
        status: "ok",
        service: "ClientFlow",
        telegram: true,
        worker: true
      });
    }

    return new Response("Not found", {
      status: 404
    });
  }
};
