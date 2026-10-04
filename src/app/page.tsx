import { Desk } from "@/components/desk/Desk";

// The Desk is live data. Never prerender it, and read the inbox address from env on the server.
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Desk
      initialInbox={process.env.FEWER_INBOX?.trim() || null}
      ownerName={process.env.FEWER_OWNER_NAME?.trim() || "you"}
    />
  );
}
