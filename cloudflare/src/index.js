import { DurableObject } from "cloudflare:workers";

export class TelegramSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    return Response.json({
      status: "ok",
      component: "TelegramSession",
      message: "Durable Object работает"
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

    return new Response("Not found", { status: 404 });
  }
};
