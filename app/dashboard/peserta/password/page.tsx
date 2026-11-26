import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import "@/app/style/peserta/typography.css";
import "@/app/style/peserta/dashboard.css";
import "@/app/style/peserta/sidebar.css";
import "@/app/style/peserta/header.css";
import "@/app/style/peserta/password.css";

import PesertaPasswordView from "@/app/view/peserta/password";

export const instant = false;

export default async function PesertaPasswordPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile) redirect("/");

  if (profile.account_status !== "active") redirect("/");

  if (profile.role !== "PESERTA") {
    redirect(profile.role === "PIC" ? "/dashboard/pic" : "/");
  }

  return <PesertaPasswordView />;
}
