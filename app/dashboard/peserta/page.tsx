import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import "@/app/style/peserta/typography.css";
import "@/app/style/peserta/dashboard.css";
import "@/app/style/peserta/sidebar.css";
import "@/app/style/peserta/header.css";

import PesertaDashboardView, {
  type DashboardTask,
} from "@/app/view/peserta/dashboard";

export const instant = false;

export default async function PesertaDashboardPage() {
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const [profileResult, participantDivisionResult] = await Promise.all([
    supabase
    .from("profiles")
    .select("full_name, role, account_status, must_change_password")
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
  if (profile.account_status !== "active") redirect("/");
  if (profile.must_change_password) redirect("/dashboard/peserta/password");

  if (profile.role !== "PESERTA") {
    redirect(profile.role === "PIC" ? "/dashboard/pic" : "/");
  }

  const welcomeName = profile.full_name ?? "Peserta";



  if (participantDivisionError || !participantDivision) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 sm:p-10">
        <h1 className="text-2xl font-bold text-slate-800">
          Dashboard Peserta
        </h1>
        <p className="mt-4 text-slate-600">
          Kamu belum terdaftar di divisi aktif. Hubungi administrator.
        </p>
      </main>
    );
  }

  const { data: division, error: divisionError } = await supabase
    .from("divisions")
    .select("id, name, is_active")
    .eq("id", participantDivision.division_id)
    .maybeSingle();

  if (divisionError || !division || !division.is_active) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 sm:p-10">
        <h1 className="text-2xl font-bold text-slate-800">
          Dashboard Peserta
        </h1>
        <p className="mt-4 text-slate-600">
          Divisimu sedang tidak aktif atau tidak tersedia.
        </p>
      </main>
    );
  }

  // Ambil keanggotaan dan daftar tugas secara bersamaan.
  const [membershipResult, assignmentsResult] = await Promise.all([
    supabase
      .from("group_members")
      .select("group_id, division_id, participant_division_id, is_leader")
      .eq("user_id", user.id)
      .eq("division_id", division.id)
      .eq("participant_division_id", participantDivision.id)
      .is("left_at", null)
      .maybeSingle(),

    supabase
      .from("assignments")
      .select("id, title, module, deadline")
      .eq("division_id", division.id)
      .gte("deadline", new Date().toISOString())
      .order("deadline", { ascending: true }),
  ]);

  if (membershipResult.error) {
    console.error("Dashboard membership error:", membershipResult.error);

    return (
      <PesertaDashboardView
        welcomeName={welcomeName}
        group={null}
        statistics={{
          activeTasks: 0,
          submittedTasks: 0,
          pendingTasks: 0,
          memberCount: 0,
        }}
        tasks={[]}
        error="Gagal mengambil informasi kelompok."
      />
    );
  }

  if (assignmentsResult.error || !assignmentsResult.data) {
    console.error("Dashboard assignments error:", assignmentsResult.error);

    return (
      <PesertaDashboardView
        welcomeName={welcomeName}
        group={null}
        statistics={{
          activeTasks: 0,
          submittedTasks: 0,
          pendingTasks: 0,
          memberCount: 0,
        }}
        tasks={[]}
        error="Gagal mengambil daftar tugas."
      />
    );
  }

  const membership = membershipResult.data;
  const assignments = assignmentsResult.data;

  let group: {
    name: string;
    divisionName: string;
    isLeader: boolean;
  } | null = null;

  let memberCount = 0;

  if (membership) {
    const [groupResult, membersResult] = await Promise.all([
      supabase
        .from("groups")
        .select("id, name")
        .eq("id", membership.group_id)
        .eq("division_id", division.id)
        .is("archived_at", null)
        .maybeSingle(),

      supabase
        .from("group_members")
        .select("id")
        .eq("group_id", membership.group_id)
        .eq("division_id", division.id)
        .is("left_at", null),
    ]);

    if (
      groupResult.error ||
      membersResult.error ||
      !groupResult.data ||
      !membersResult.data
    ) {
      console.error("Dashboard group information error:", {
        groupError: groupResult.error,
        membersError: membersResult.error,
      });

      return (
        <PesertaDashboardView
          welcomeName={welcomeName}
          group={null}
          statistics={{
            activeTasks: 0,
            submittedTasks: 0,
            pendingTasks: 0,
            memberCount: 0,
          }}
          tasks={[]}
          error="Gagal mengambil informasi kelompok."
        />
      );
    }

    group = {
      name: groupResult.data.name,
      divisionName: division.name,
      isLeader: membership.is_leader,
    };

    memberCount = membersResult.data.length;
  }

  let submittedAssignmentIds = new Set<number>();

  if (membership) {
    const { data: submissions, error: submissionsError } = await supabase
      .from("submissions")
      .select("assignment_id")
      .eq("group_id", membership.group_id)
      .eq("division_id", division.id);

    if (submissionsError || !submissions) {
      console.error("Dashboard submissions error:", submissionsError);

      return (
        <PesertaDashboardView
          welcomeName={welcomeName}
          group={group}
          statistics={{
            activeTasks: assignments.length,
            submittedTasks: 0,
            pendingTasks: assignments.length,
            memberCount,
          }}
          tasks={[]}
          error="Gagal mengambil status pengumpulan tugas."
        />
      );
    }

    submittedAssignmentIds = new Set(
      submissions.map((submission) => submission.assignment_id)
    );
  }

  const tasks: DashboardTask[] = assignments.map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    module: assignment.module,
    deadline: assignment.deadline,
    status: submittedAssignmentIds.has(assignment.id)
      ? "submitted"
      : "pending",
  }));

  const submittedTasks = tasks.filter(
    (task) => task.status === "submitted"
  ).length;

  const pendingTasks = tasks.length - submittedTasks;

  return (
    <PesertaDashboardView
      welcomeName={welcomeName}
      group={group}
      statistics={{
        activeTasks: tasks.length,
        submittedTasks,
        pendingTasks,
        memberCount,
      }}
      tasks={tasks.slice(0, 5)}
    />
  );
}
