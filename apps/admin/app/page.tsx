import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/session";

export default async function Home() {
  redirect((await getCurrentSession()) ? "/dashboard" : "/login");
}
