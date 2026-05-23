import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();
  const guest = (await cookies()).get("maestro_guest")?.value === "1";
  redirect(session || guest ? "/library" : "/login");
}
