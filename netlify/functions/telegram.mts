// /api/telegram → api/telegram.ts, the bot webhook.
import { POST } from "../../api/telegram.js";

export default async (req: Request): Promise<Response> => {
  if (req.method === "POST") return POST(req);
  return new Response("Method Not Allowed", { status: 405 });
};

export const config = { path: "/api/telegram" };
