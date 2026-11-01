import { LabRoute } from "@/components/lab/route";

// Investigation state lives in the browser (worker + local storage), so these
// views render on the client and are not expected to prerender instantly.
export const instant = false;

export default function Page() {
  return <LabRoute view="surrogate" />;
}
