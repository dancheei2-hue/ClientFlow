import { DurableObject } from "cloudflare:workers";
import { MTProtoConnection } from "@mtproto2/mtproto";

export class TelegramSession extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/mtproto-test") {
      try {
        const conn = new MTProtoConnection({
          dcId: 2,
          transport: "abridged",
          testMode: false
        });

        return Response.json({
          status: "ok",
          mtproto: true,
          library: "loaded",
          connection: "created"
        });
      } catch (error) {
        return Response.json({
          status: "error",
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

    if (url.pathname === "/mtproto-test") {
      const id = env.TELEGRAM_SESSION.idFromName("main");
      return env.TELEGRAM_SESSION.get(id).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
