import { DurableObject } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";
import {
  AuthKeyExchange
} from "@mtproto2/mtproto";
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

        const tcp = await socket.opened;

        return Response.json({
          status: "ok",
          tcp: true,
          mtproto: true,
          dc: 2,
          remote: tcp.remoteAddress,
          message: "Cloudflare TCP connection ready"
        });

      } catch (error) {
        return Response.json({
          status: "error",
          tcp: false,
          error: String(error),
          stack: error?.stack || null
        }, { status: 500 });
      } finally {
        if (socket) {
          try {
            await socket.close();
          } catch {}
        }
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
