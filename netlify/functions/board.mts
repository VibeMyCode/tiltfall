// /api/board → api/board.ts. Netlify routes every method to one function, so
// the method dispatch that Vercel did by export name happens here.
import { DELETE, GET, POST } from "../../api/board.js";

export default async (req: Request): Promise<Response> => {
  if (req.method === "GET") return GET();
  if (req.method === "POST") return POST(req);
  if (req.method === "DELETE") return DELETE(req);
  return new Response("Method Not Allowed", { status: 405 });
};

export const config = { path: "/api/board" };
