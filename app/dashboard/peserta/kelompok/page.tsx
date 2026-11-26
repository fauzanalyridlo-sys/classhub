import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import "@/app/style/peserta/typography.css";
import "@/app/style/peserta/dashboard.css";
import "@/app/style/peserta/sidebar.css";
import "@/app/style/peserta/header.css";
import "@/app/style/peserta/kelompok.css";

import PesertaKelompokView from "@/app/view/peserta/kelompok";

export const instant = false;

export default async function PesertaKelompokPage() {
  await connection();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const [profileResult, participantDivisionResult] = await Promise.all([
    supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle(),

    supabase
      .from("participant_divisions")
      .select("id, division_id")
      .eq("user_id", user.id)
      .is("ended_at", null)
      .maybeSingle()
  ]);

  const { data: profile, error: profileError } = profileResult;
  const { data: participantDivision, error: participantDivisionError } = participantDivisionResult;


  if (profileError || !profile) redirect("/");

  if (profile.role !== "PESERTA") {
    redirect(profile.role === "PIC" ? "/dashboard/pic" : "/");
  }

  // Pastikan peserta memiliki penugasan divisi yang masih aktif.


  if (participantDivisionError) {
    console.error(
      "Participant division error:",
      participantDivisionError
    );

    return (
      <PesertaKelompokView
        group={null}
        error="Gagal mengambil informasi divisi peserta."
      />
    );
  }

  if (!participantDivision) {
    return <PesertaKelompokView group={null} />;
  }

  // Pastikan divisi peserta masih aktif.
  const { data: division, error: divisionError } = await supabase
    .from("divisions")
    .select("id, name, is_active")
    .eq("id", participantDivision.division_id)
    .maybeSingle();

  if (divisionError) {
    console.error("Division error:", divisionError);

    return (
      <PesertaKelompokView
        group={null}
        error="Gagal mengambil informasi divisi."
      />
    );
  }

  if (!division || !division.is_active) {
    return <PesertaKelompokView group={null} />;
  }

  // Cari keanggotaan aktif dalam penugasan divisi tersebut.
  const { data: membership, error: membershipError } = await supabase
    .from("group_members")
    .select("group_id, division_id, participant_division_id, is_leader, joined_at")
    .eq("user_id", user.id)
    .eq("participant_division_id", participantDivision.id)
    .eq("division_id", division.id)
    .is("left_at", null)
    .maybeSingle();

  if (membershipError) {
    console.error("Group membership error:", membershipError);

    return (
      <PesertaKelompokView
        group={null}
        error="Gagal mengambil informasi keanggotaan kelompok."
      />
    );
  }

  if (!membership) {
    return <PesertaKelompokView group={null} />;
  }

  // Ambil kelompok dan anggota aktif dari divisi yang sama.
  const [groupResult, membersResult] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, division_id")
      .eq("id", membership.group_id)
      .eq("division_id", division.id)
      .is("archived_at", null)
      .maybeSingle(),

    supabase
      .from("group_members")
      .select("id, user_id, is_leader, joined_at")
      .eq("group_id", membership.group_id)
      .eq("division_id", division.id)
      .is("left_at", null)
      .order("is_leader", { ascending: false })
      .order("joined_at", { ascending: true }),
  ]);

  if (
    groupResult.error ||
    membersResult.error ||
    !groupResult.data ||
    !membersResult.data
  ) {
    console.error("Group detail error:", {
      groupError: groupResult.error,
      membersError: membersResult.error,
    });

    return (
      <PesertaKelompokView
        group={null}
        error="Gagal mengambil informasi kelompok. Silakan coba kembali."
      />
    );
  }

  // Ambil profil anggota aktif.
  const memberUserIds = membersResult.data.map(
    (member) => member.user_id
  );

  const { data: profiles, error: membersProfileError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", memberUserIds);

  if (membersProfileError || !profiles) {
    console.error("Group member profiles error:", membersProfileError);

    return (
      <PesertaKelompokView
        group={null}
        error="Gagal mengambil informasi profil anggota kelompok."
      />
    );
  }

  const groupMembers = membersResult.data.map((member) => {
    const memberProfile = profiles.find(
      (item) => item.id === member.user_id
    );

    return {
      id: member.id,
      fullName: memberProfile?.full_name ?? "Nama tidak tersedia",
      isLeader: member.is_leader,
      joinedAt: member.joined_at,
    };
  });

  return (
    <PesertaKelompokView
      group={{
        name: groupResult.data.name,
        divisionName: division.name,
        members: groupMembers,
        currentUserIsLeader: membership.is_leader,
      }}
    />
  );
}
