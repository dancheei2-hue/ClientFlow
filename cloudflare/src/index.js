import { DurableObject } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";
import { MTProtoConnection } from "@mtproto2/mtproto";

export class TelegramSession extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/mtproto-connect-test") {
      try {
        const socket = connect({
          hostname: "149.154.167.50",
          port: 443
        });

        await socket.opened;

        const conn = new MTProtoConnection({
          dcId: 2,
          transport: "abridged",
          testMode: false
        });

        return Response.json({
          status: "ok",
          tcp: true,
          mtproto: true,
          connection: "created",
          telegram_dc: 2
        });

      } catch (error) {
        return Response.json({
          status: "error",
          tcp: false,
          mtproto: false,
          error: String(error),
          stack: error?.stack || null
        }, { status: 500 });
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

    if (url.pathname === "/mtproto-connect-test") {
      const id = env.TELEGRAM_SESSION.idFromName("main");
      return env.TELEGRAM_SESSION.get(id).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
