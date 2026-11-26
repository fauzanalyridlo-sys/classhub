import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import "@/app/style/peserta/typography.css";
import "@/app/style/peserta/dashboard.css";
import "@/app/style/peserta/sidebar.css";
import "@/app/style/peserta/header.css";
import "@/app/style/peserta/pengumpulan.css";

import PesertaPengumpulanView, {
  type SubmissionItem,
  type GroupMemberOption,
  type AssignmentOption,
} from "@/app/view/peserta/pengumpulan";

export const instant = false;

export default async function PesertaPengumpulanPage() {
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
      .maybeSingle(),
  ]);

  const { data: profile, error: profileError } = profileResult;
  const {
    data: participantDivision,
    error: participantDivisionError,
  } = participantDivisionResult;

  if (profileError || !profile) redirect("/");

  if (profile.role !== "PESERTA") {
    redirect(profile.role === "PIC" ? "/dashboard/pic" : "/");
  }

  if (participantDivisionError) {
    console.error(
      "Submission participant division error:",
      participantDivisionError
    );

    return (
      <PesertaPengumpulanView
        submissions={[]}
        groupMembers={[]}
        currentUserIsLeader={false}
        error="Gagal mengambil informasi divisi peserta."
      />
    );
  }

  if (!participantDivision) {
    return (
      <PesertaPengumpulanView
        submissions={[]}
        groupMembers={[]}
        currentUserIsLeader={false}
      />
    );
  }

  // Pastikan divisi peserta masih aktif.
  const { data: division, error: divisionError } = await supabase
    .from("divisions")
    .select("id, is_active")
    .eq("id", participantDivision.division_id)
    .maybeSingle();

  if (divisionError) {
    console.error("Submission division error:", divisionError);

    return (
      <PesertaPengumpulanView
        submissions={[]}
        groupMembers={[]}
        currentUserIsLeader={false}
        error="Gagal memeriksa status divisi peserta."
      />
    );
  }

  if (!division || !division.is_active) {
    return (
      <PesertaPengumpulanView
        submissions={[]}
        groupMembers={[]}
        currentUserIsLeader={false}
      />
    );
  }

  // Cari keanggotaan kelompok peserta.
  const { data: membership, error: membershipError } = await supabase
    .from("group_members")
    .select("group_id, division_id, participant_division_id, is_leader")
    .eq("user_id", user.id)
    .eq("participant_division_id", participantDivision.id)
    .eq("division_id", division.id)
    .is("left_at", null)
    .maybeSingle();

  if (membershipError) {
    console.error("Submission membership error:", membershipError);

    return (
      <PesertaPengumpulanView
        submissions={[]}
        groupMembers={[]}
        currentUserIsLeader={false}
        error="Gagal mengambil informasi keanggotaan kelompok."
      />
    );
  }

  if (!membership) {
    return (
      <PesertaPengumpulanView
        submissions={[]}
        groupMembers={[]}
        currentUserIsLeader={false}
      />
    );
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
    console.error("Submission group error:", groupError);

    return (
      <PesertaPengumpulanView
        submissions={[]}
        groupMembers={[]}
        currentUserIsLeader={membership.is_leader}
        error="Gagal memeriksa informasi kelompok."
      />
    );
  }

  if (!group) {
    return (
      <PesertaPengumpulanView
        submissions={[]}
        groupMembers={[]}
        currentUserIsLeader={membership.is_leader}
      />
    );
  }

  // Ambil anggota, pengumpulan, dan seluruh tugas divisi secara bersamaan.
  const [
    groupMembersResult,
    submissionsResult,
    assignmentsResult,
  ] = await Promise.all([
    supabase
      .from("group_members")
      .select("user_id, is_leader, joined_at")
      .eq("group_id", group.id)
      .eq("division_id", division.id)
      .is("left_at", null)
      .order("is_leader", { ascending: false })
      .order("joined_at", { ascending: true }),

    supabase
      .from("submissions")
      .select(
        "id, assignment_id, status, original_file_name, file_size, submitted_at, updated_at, revision_allowed_until"
      )
      .eq("group_id", group.id)
      .eq("division_id", division.id)
      .order("submitted_at", { ascending: false }),

    supabase
      .from("assignments")
      .select("id, title, module, description, deadline")
      .eq("division_id", division.id)
      .order("deadline", { ascending: true }),
  ]);

  if (groupMembersResult.error || !groupMembersResult.data) {
    console.error(
      "Submission group members error:",
      groupMembersResult.error
    );

    return (
      <PesertaPengumpulanView
        submissions={[]}
        groupMembers={[]}
        currentUserIsLeader={membership.is_leader}
        error="Gagal mengambil daftar anggota kelompok."
      />
    );
  }

  if (assignmentsResult.error || !assignmentsResult.data) {
    console.error(
      "Submission assignments error:",
      assignmentsResult.error
    );

    return (
      <PesertaPengumpulanView
        submissions={[]}
        groupMembers={[]}
        currentUserIsLeader={membership.is_leader}
        error="Gagal mengambil daftar tugas divisi."
      />
    );
  }

  if (submissionsResult.error || !submissionsResult.data) {
    console.error("Submission data error:", submissionsResult.error);

    return (
      <PesertaPengumpulanView
        submissions={[]}
        groupMembers={[]}
        currentUserIsLeader={membership.is_leader}
        error="Gagal mengambil daftar pengumpulan tugas."
      />
    );
  }

  const assignments: AssignmentOption[] = assignmentsResult.data;

  const groupMembers = groupMembersResult.data;
  const memberUserIds = groupMembers.map((member) => member.user_id);

  const { data: memberProfiles, error: memberProfilesError } =
    await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", memberUserIds);

  if (memberProfilesError || !memberProfiles) {
    console.error(
      "Submission member profiles error:",
      memberProfilesError
    );

    return (
      <PesertaPengumpulanView
        submissions={[]}
        groupMembers={[]}
        currentUserIsLeader={membership.is_leader}
        assignments={assignments}
        groupId={group.id}
      />
    );
  }

  const groupMemberOptions: GroupMemberOption[] = groupMembers.map(
    (member) => {
      const memberProfile = memberProfiles.find(
        (item) => item.id === member.user_id
      );

      return {
        userId: member.user_id,
        fullName: memberProfile?.full_name ?? "Nama tidak tersedia",
        isLeader: member.is_leader,
      };
    }
  );

  const submissions = submissionsResult.data;

  // Detail kontributor dan revisi hanya diperlukan jika sudah ada pengumpulan.
  let submissionItems: SubmissionItem[] = [];

  if (submissions.length > 0) {
    const submissionIds = submissions.map(
      (submission) => submission.id
    );

    const [membersResult, revisionsResult] = await Promise.all([
      supabase
        .from("submission_members")
        .select("submission_id, user_id, full_name_snapshot, created_at")
        .in("submission_id", submissionIds)
        .order("created_at", { ascending: true }),

      supabase
        .from("submission_revisions")
        .select(
          "id, submission_id, revision_number, original_file_name, file_size, uploaded_at"
        )
        .in("submission_id", submissionIds)
        .order("revision_number", { ascending: true }),
    ]);

    if (membersResult.error || !membersResult.data) {
      console.error(
        "Submission members error:",
        membersResult.error
      );

      return (
        <PesertaPengumpulanView
          submissions={[]}
          groupMembers={groupMemberOptions}
          currentUserIsLeader={membership.is_leader}
          assignments={assignments}
          groupId={group.id}
          error="Gagal mengambil informasi kontributor."
        />
      );
    }

    if (revisionsResult.error || !revisionsResult.data) {
      console.error(
        "Submission revisions error:",
        revisionsResult.error
      );

      return (
        <PesertaPengumpulanView
          submissions={[]}
          groupMembers={groupMemberOptions}
          currentUserIsLeader={membership.is_leader}
          assignments={assignments}
          groupId={group.id}
          error="Gagal mengambil riwayat revisi pengumpulan."
        />
      );
    }

    submissionItems = submissions.map((submission) => {
      const assignment = assignments.find(
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
          originalFileName: revision.original_file_name,
          fileSize: Number(revision.file_size),
          uploadedAt: revision.uploaded_at,
        }));

      return {
        id: submission.id,
        assignmentId: submission.assignment_id,
        groupId: group.id,
        assignmentTitle: assignment?.title ?? "Tugas tidak ditemukan",
        moduleName: assignment?.module ?? "Modul tidak tersedia",
        deadline: assignment?.deadline ?? null,
        revisionAllowedUntil: submission.revision_allowed_until,
        status: submission.status as "submitted" | "late",
        originalFileName: submission.original_file_name,
        fileSize: Number(submission.file_size),
        submittedAt: submission.submitted_at,
        updatedAt: submission.updated_at,
        contributors,
        revisions,
      };
    });
  }

  return (
    <PesertaPengumpulanView
      submissions={submissionItems}
      groupMembers={groupMemberOptions}
      currentUserIsLeader={membership.is_leader}
      assignments={assignments}
      groupId={group.id}
    />
  );
}
