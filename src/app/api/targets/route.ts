import { listSpecs } from "@/server/targets";

export function GET() {
  return Response.json({ targets: listSpecs() });
}
