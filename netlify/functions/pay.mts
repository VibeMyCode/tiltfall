// /api/pay → api/pay.ts.
import { POST } from "../../api/pay.js";

export default async (req: Request): Promise<Response> => {
  if (req.method === "POST") return POST(req);
  return new Response("Method Not Allowed", { status: 405 });
};

export const config = { path: "/api/pay" };
