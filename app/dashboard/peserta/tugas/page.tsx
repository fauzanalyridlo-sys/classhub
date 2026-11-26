import "@/app/style/peserta/typography.css";
import "@/app/style/peserta/dashboard.css";
import "@/app/style/peserta/sidebar.css";
import "@/app/style/peserta/header.css";
import "@/app/style/peserta/tugas.css";
import "@/app/style/peserta/popup-detail-tugas.css";

import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import PesertaTugasView, {
  type TaskItem,
} from "@/app/view/peserta/tugas";

export const instant = false;

export default async function PesertaTugasPage() {
  await connection();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const [profileResult, participantDivisionResult] = await Promise.all([
    supabase
    .from("profiles")
    .select("role")
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



  if (participantDivisionError) {
    console.error("Task participant division error:", participantDivisionError);

    return (
      <PesertaTugasView
        tasks={[]}
        hasGroup={false}
        error="Gagal mengambil informasi divisi peserta."
      />
    );
  }

  if (!participantDivision) {
    return <PesertaTugasView tasks={[]} hasGroup={false} />;
  }

  const { data: division, error: divisionError } = await supabase
    .from("divisions")
    .select("id, is_active")
    .eq("id", participantDivision.division_id)
    .maybeSingle();

  if (divisionError) {
    console.error("Task division error:", divisionError);

    return (
      <PesertaTugasView
        tasks={[]}
        hasGroup={false}
        error="Gagal memeriksa status divisi peserta."
      />
    );
  }

  if (!division || !division.is_active) {
    return <PesertaTugasView tasks={[]} hasGroup={false} />;
  }

  // Ambil daftar tugas dan keanggotaan secara bersamaan.
  const [assignmentsResult, membershipResult] = await Promise.all([
    supabase
      .from("assignments")
      .select("id, title, module, description, deadline")
      .eq("division_id", division.id)
      .order("deadline", { ascending: true }),

    supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id)
      .eq("participant_division_id", participantDivision.id)
      .eq("division_id", division.id)
      .is("left_at", null)
      .maybeSingle(),
  ]);

  if (assignmentsResult.error || !assignmentsResult.data) {
    console.error("Task assignments error:", assignmentsResult.error);

    return (
      <PesertaTugasView
        tasks={[]}
        hasGroup={false}
        error="Gagal mengambil daftar tugas divisi."
      />
    );
  }

  if (membershipResult.error) {
    console.error("Task membership error:", membershipResult.error);

    return (
      <PesertaTugasView
        tasks={[]}
        hasGroup={false}
        error="Gagal mengambil informasi kelompok peserta."
      />
    );
  }

  const assignments = assignmentsResult.data;
  const membership = membershipResult.data;

  let hasGroup = false;
  let submissionStatusByAssignment = new Map<number, "submitted" | "late">();

  if (membership) {
    const { data: group, error: groupError } = await supabase
      .from("groups")
      .select("id")
      .eq("id", membership.group_id)
      .eq("division_id", division.id)
      .is("archived_at", null)
      .maybeSingle();

    if (groupError) {
      console.error("Task group error:", groupError);

      return (
        <PesertaTugasView
          tasks={[]}
          hasGroup={false}
          error="Gagal memeriksa informasi kelompok peserta."
        />
      );
    }

    if (group) {
      hasGroup = true;

      const { data: submissions, error: submissionsError } = await supabase
        .from("submissions")
        .select("assignment_id, status")
        .eq("group_id", group.id)
        .eq("division_id", division.id);

      if (submissionsError || !submissions) {
        console.error("Task submissions error:", submissionsError);

        return (
          <PesertaTugasView
            tasks={[]}
            hasGroup={hasGroup}
            error="Gagal mengambil status pengumpulan tugas."
          />
        );
      }

      submissionStatusByAssignment = new Map(
        submissions.map((submission) => [
          Number(submission.assignment_id),
          submission.status as "submitted" | "late",
        ])
      );
    }
  }

  const taskItems: TaskItem[] = assignments.map((assignment) => ({
    id: Number(assignment.id),
    title: assignment.title,
    module: assignment.module,
    description: assignment.description ?? "",
    deadline: assignment.deadline,
    submissionStatus:
      submissionStatusByAssignment.get(Number(assignment.id)) ?? null,
  }));

  return (
    <PesertaTugasView
      tasks={taskItems}
      hasGroup={hasGroup}
    />
  );
}
