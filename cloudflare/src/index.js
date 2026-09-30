import { DurableObject } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";

export class TelegramSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/tcp-test") {
      try {
        const socket = connect({
          hostname: "149.154.167.50",
          port: 443
        });

        const info = await socket.opened;

        await socket.close();

        return Response.json({
          status: "ok",
          tcp: true,
          telegram: true,
          remote: info.remoteAddress
        });
      } catch (error) {
        return Response.json(
          {
            status: "error",
            tcp: false,
            telegram: false,
            error: String(error)
          },
          { status: 500 }
        );
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

    if (url.pathname === "/telegram-test") {
      const id = env.TELEGRAM_SESSION.idFromName("main");
      const stub = env.TELEGRAM_SESSION.get(id);

      return await stub.fetch(
        new Request("https://telegram-session/status")
      );
    }

    if (url.pathname === "/tcp-test") {
      const id = env.TELEGRAM_SESSION.idFromName("main");
      const stub = env.TELEGRAM_SESSION.get(id);

      return await stub.fetch(
        new Request("https://telegram-session/tcp-test")
      );
    }

    return new Response("Not found", { status: 404 });
  }
};
