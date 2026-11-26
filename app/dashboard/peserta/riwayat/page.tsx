import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import "@/app/style/peserta/typography.css";
import "@/app/style/peserta/dashboard.css";
import "@/app/style/peserta/sidebar.css";
import "@/app/style/peserta/header.css";
import "@/app/style/peserta/riwayat.css";

import PesertaRiwayatView, {
  type HistorySubmission,
} from "@/app/view/peserta/riwayat";

export const instant = false;

export default async function PesertaRiwayatPage() {
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

  // Pastikan peserta memiliki penugasan divisi aktif.


  if (participantDivisionError) {
    console.error(
      "History participant division error:",
      participantDivisionError
    );

    return (
      <PesertaRiwayatView
        submissions={[]}
        error="Gagal mengambil informasi divisi peserta."
      />
    );
  }

  if (!participantDivision) {
    return <PesertaRiwayatView submissions={[]} />;
  }

  // Pastikan divisi masih aktif.
  const { data: division, error: divisionError } = await supabase
    .from("divisions")
    .select("id, is_active")
    .eq("id", participantDivision.division_id)
    .maybeSingle();

  if (divisionError) {
    console.error("History division error:", divisionError);

    return (
      <PesertaRiwayatView
        submissions={[]}
        error="Gagal memeriksa status divisi peserta."
      />
    );
  }

  if (!division || !division.is_active) {
    return <PesertaRiwayatView submissions={[]} />;
  }

  // Cari keanggotaan kelompok dari penugasan divisi aktif.
  const { data: membership, error: membershipError } = await supabase
    .from("group_members")
    .select("group_id, division_id, participant_division_id")
    .eq("user_id", user.id)
    .eq("participant_division_id", participantDivision.id)
    .eq("division_id", division.id)
    .is("left_at", null)
    .maybeSingle();

  if (membershipError) {
    console.error("History membership error:", membershipError);

    return (
      <PesertaRiwayatView
        submissions={[]}
        error="Gagal mengambil informasi keanggotaan kelompok."
      />
    );
  }

  if (!membership) {
    return <PesertaRiwayatView submissions={[]} />;
  }

  // Pastikan kelompok berasal dari divisi yang sama dan belum diarsipkan.
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id")
    .eq("id", membership.group_id)
    .eq("division_id", division.id)
    .is("archived_at", null)
    .maybeSingle();

  if (groupError) {
    console.error("History group error:", groupError);

    return (
      <PesertaRiwayatView
        submissions={[]}
        error="Gagal memeriksa informasi kelompok."
      />
    );
  }

  if (!group) {
    return <PesertaRiwayatView submissions={[]} />;
  }

  // Ambil riwayat submission hanya dari kelompok dan divisi tervalidasi.
  const { data: submissions, error: submissionsError } = await supabase
    .from("submissions")
    .select(
      "id, assignment_id, status, file_path, original_file_name, file_size, submitted_at, updated_at"
    )
    .eq("group_id", group.id)
    .eq("division_id", division.id)
    .order("submitted_at", { ascending: false });

  if (submissionsError || !submissions) {
    console.error("History submissions error:", submissionsError);

    return (
      <PesertaRiwayatView
        submissions={[]}
        error="Gagal mengambil data riwayat pengumpulan."
      />
    );
  }

  if (submissions.length === 0) {
    return <PesertaRiwayatView submissions={[]} />;
  }

  const submissionIds = submissions.map((item) => item.id);
  const assignmentIds = [
    ...new Set(submissions.map((item) => item.assignment_id)),
  ];

  const [assignmentsResult, membersResult, revisionsResult] =
    await Promise.all([
      supabase
        .from("assignments")
        .select("id, title, module, deadline")
        .eq("division_id", division.id)
        .in("id", assignmentIds),

      supabase
        .from("submission_members")
        .select("submission_id, user_id, full_name_snapshot")
        .in("submission_id", submissionIds)
        .order("created_at", { ascending: true }),

      supabase
        .from("submission_revisions")
        .select(
          "id, submission_id, revision_number, file_path, original_file_name, file_size, uploaded_at"
        )
        .in("submission_id", submissionIds)
        .order("revision_number", { ascending: true }),
    ]);

  if (assignmentsResult.error || !assignmentsResult.data) {
    console.error("History assignments error:", assignmentsResult.error);

    return (
      <PesertaRiwayatView
        submissions={[]}
        error="Gagal mengambil informasi tugas."
      />
    );
  }

  if (membersResult.error || !membersResult.data) {
    console.error("History members error:", membersResult.error);

    return (
      <PesertaRiwayatView
        submissions={[]}
        error="Gagal mengambil informasi kontributor."
      />
    );
  }

  if (revisionsResult.error || !revisionsResult.data) {
    console.error("History revisions error:", revisionsResult.error);

    return (
      <PesertaRiwayatView
        submissions={[]}
        error="Gagal mengambil riwayat versi pengumpulan."
      />
    );
  }

  const historyItems: HistorySubmission[] = submissions.map((submission) => {
    const assignment = assignmentsResult.data.find(
      (item) => item.id === submission.assignment_id
    );

    const contributors = membersResult.data
      .filter((member) => member.submission_id === submission.id)
      .map((member) => ({
        userId: member.user_id,
        fullName: member.full_name_snapshot,
      }));

    const revisions = revisionsResult.data
      .filter((revision) => revision.submission_id === submission.id)
      .map((revision) => ({
        id: revision.id,
        revisionNumber: revision.revision_number,
        filePath: revision.file_path,
        originalFileName: revision.original_file_name,
        fileSize: Number(revision.file_size),
        uploadedAt: revision.uploaded_at,
      }));

    return {
      id: submission.id,
      assignmentTitle: assignment?.title ?? "Tugas tidak ditemukan",
      moduleName: assignment?.module ?? "Modul tidak tersedia",
      deadline: assignment?.deadline ?? null,
      status: submission.status as "submitted" | "late",
      currentFile: {
        filePath: submission.file_path,
        originalFileName: submission.original_file_name,
        fileSize: Number(submission.file_size),
        uploadedAt: submission.updated_at,
      },
      submittedAt: submission.submitted_at,
      updatedAt: submission.updated_at,
      contributors,
      revisions,
    };
  });

  return <PesertaRiwayatView submissions={historyItems} />;
}
