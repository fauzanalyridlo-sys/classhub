import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type UpdateContributorsBody = {
  groupId?: number;
  assignmentId?: number;
  contributorIds?: string[];
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, message: "Silakan login terlebih dahulu." },
        { status: 401 }
      );
    }

    // Pastikan akun pengguna aktif dan tidak diwajibkan mengganti password.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("account_status, must_change_password")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Account status check error:", profileError);

      return NextResponse.json(
        { success: false, message: "Gagal memeriksa status akun." },
        { status: 500 }
      );
    }

    if (!profile || profile.account_status !== "active") {
      return NextResponse.json(
        {
          success: false,
          message: "Akun belum aktif atau telah dinonaktifkan.",
        },
        { status: 403 }
      );
    }

    if (profile.must_change_password) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Ganti password terlebih dahulu sebelum mengubah anggota kontributor.",
          code: "PASSWORD_CHANGE_REQUIRED",
        },
        { status: 403 }
      );
    }

    let parsedBody: unknown;

    try {
      parsedBody = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Format request tidak valid." },
        { status: 400 }
      );
    }

    if (
      !parsedBody ||
      typeof parsedBody !== "object" ||
      Array.isArray(parsedBody)
    ) {
      return NextResponse.json(
        { success: false, message: "Format request tidak valid." },
        { status: 400 }
      );
    }

    const { groupId, assignmentId, contributorIds } =
      parsedBody as UpdateContributorsBody;

    if (
      !Number.isSafeInteger(groupId) ||
      !groupId ||
      groupId <= 0 ||
      !Number.isSafeInteger(assignmentId) ||
      !assignmentId ||
      assignmentId <= 0 ||
      !Array.isArray(contributorIds)
    ) {
      return NextResponse.json(
        { success: false, message: "Data perubahan kontributor tidak lengkap." },
        { status: 400 }
      );
    }

    if (
      contributorIds.length < 1 ||
      contributorIds.length > 7 ||
      contributorIds.some(
        (id) => typeof id !== "string" || !UUID_REGEX.test(id)
      ) ||
      new Set(contributorIds).size !== contributorIds.length
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Pilih 1 sampai 7 anggota yang berkontribusi.",
        },
        { status: 400 }
      );
    }

    // Validasi kepemimpinan kelompok, anggota, dan submission
    // dilakukan kembali secara transaksional oleh fungsi database.
    const { data, error } = await supabase.rpc(
      "update_submission_contributors",
      {
        p_group_id: groupId,
        p_assignment_id: assignmentId,
        p_contributor_ids: contributorIds,
      }
    );

    if (error) {
      console.error("Update contributors RPC error:", error.message);

      const message = error.message;

      if (message.includes("Authentication required")) {
        return NextResponse.json(
          { success: false, message: "Sesi login tidak valid." },
          { status: 401 }
        );
      }

      if (message.includes("Account is not active")) {
        return NextResponse.json(
          {
            success: false,
            message: "Akun belum aktif atau telah dinonaktifkan.",
          },
          { status: 403 }
        );
      }

      if (message.includes("Only the active group leader")) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Hanya ketua kelompok aktif yang dapat mengubah anggota kontributor.",
          },
          { status: 403 }
        );
      }

      if (message.includes("Revision period has expired")) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Waktu revisi sudah berakhir. Hubungi PIC jika memerlukan izin revisi.",
          },
          { status: 403 }
        );
      }

      if (message.includes("Submission not found")) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Pengumpulan tugas belum ditemukan. Silakan kumpulkan tugas terlebih dahulu.",
          },
          { status: 404 }
        );
      }

      if (message.includes("Group leader must be included")) {
        return NextResponse.json(
          {
            success: false,
            message: "Ketua kelompok wajib menjadi salah satu kontributor.",
          },
          { status: 400 }
        );
      }

      if (message.includes("not active group members")) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Satu atau beberapa anggota yang dipilih bukan anggota aktif kelompok.",
          },
          { status: 400 }
        );
      }

      if (message.includes("Select between 1 and 7 contributors")) {
        return NextResponse.json(
          {
            success: false,
            message: "Pilih minimal 1 dan maksimal 7 anggota kontributor.",
          },
          { status: 400 }
        );
      }

      if (message.includes("Group not found or archived")) {
        return NextResponse.json(
          {
            success: false,
            message: "Kelompok tidak ditemukan atau sudah diarsipkan.",
          },
          { status: 404 }
        );
      }

      if (message.includes("Assignment not found for this division")) {
        return NextResponse.json(
          { success: false, message: "Tugas tidak ditemukan untuk divisi ini." },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          message: "Perubahan kontributor gagal disimpan.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Anggota kontributor berhasil diperbarui.",
        data,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Update contributors API error:", error);

    return NextResponse.json(
      { success: false, message: "Terjadi kesalahan pada server." },
      { status: 500 }
    );
  }
}
