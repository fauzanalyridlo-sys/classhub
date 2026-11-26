import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type ChangePasswordRequest = {
  currentPassword?: unknown;
  password?: unknown;
  confirmPassword?: unknown;
};

function jsonError(error: string, status: number, code?: string) {
  return NextResponse.json(
    { error, ...(code ? { code } : {}) },
    { status }
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("Silakan login terlebih dahulu.", 401);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, account_status, must_change_password")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Change password profile lookup failed:", profileError);
      return jsonError("Gagal memverifikasi profil akun.", 500);
    }

    if (!profile || profile.account_status !== "active") {
      return jsonError("Akun tidak aktif atau tidak ditemukan.", 403);
    }

    if (profile.role !== "PESERTA" && profile.role !== "PIC") {
      return jsonError(
        "Role akun tidak diizinkan mengganti password melalui halaman ini.",
        403
      );
    }

    // PIC tetap hanya dapat menggunakan alur password wajib.
    // PESERTA dapat mengganti password kapan saja.
    if (profile.role === "PIC" && !profile.must_change_password) {
      return jsonError(
        "Akun tidak sedang diwajibkan mengganti password.",
        400
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("Format permintaan tidak valid.", 400);
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return jsonError("Format permintaan tidak valid.", 400);
    }

    const requestBody = body as ChangePasswordRequest;

    const password =
      typeof requestBody.password === "string"
        ? requestBody.password
        : "";

    if (password.length < 8 || password.length > 128) {
      return jsonError(
        "Password baru harus terdiri dari 8 sampai 128 karakter.",
        400
      );
    }

    if (profile.role === "PESERTA") {
      const currentPassword =
        typeof requestBody.currentPassword === "string"
          ? requestBody.currentPassword
          : "";

      const confirmPassword =
        typeof requestBody.confirmPassword === "string"
          ? requestBody.confirmPassword
          : "";

      if (!currentPassword) {
        return jsonError("Password lama wajib diisi.", 400);
      }

      if (!confirmPassword) {
        return jsonError("Konfirmasi password baru wajib diisi.", 400);
      }

      if (password !== confirmPassword) {
        return jsonError("Konfirmasi password baru tidak cocok.", 400);
      }

      if (currentPassword === password) {
        return jsonError(
          "Password baru harus berbeda dari password lama.",
          400
        );
      }

      if (!user.email) {
        return jsonError(
          "Email akun tidak ditemukan. Silakan hubungi administrator.",
          400
        );
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const publishableKey =
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

      if (!supabaseUrl || !publishableKey) {
        console.error(
          "Supabase public environment variables are missing."
        );

        return jsonError(
          "Konfigurasi autentikasi server belum tersedia.",
          500
        );
      }

      const verificationClient = createSupabaseClient(
        supabaseUrl,
        publishableKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
          },
        }
      );

      const {
        data: verificationData,
        error: verificationError,
      } = await verificationClient.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      const currentPasswordIsValid =
        !verificationError &&
        verificationData.user?.id === user.id;

      if (!currentPasswordIsValid) {
        return jsonError(
          "Password lama tidak sesuai. Masukkan password yang saat ini aktif pada akun.",
          400
        );
      }
    } else if (profile.role === "PIC") {
      // Alur PIC dipertahankan: hanya memerlukan password baru.
    }

    const { error: passwordError } = await supabase.auth.updateUser({
      password,
    });

    if (passwordError) {
      console.error("Supabase password update failed:", passwordError);

      return jsonError(
        "Gagal mengganti password. Silakan periksa kembali data dan coba lagi.",
        400
      );
    }

    // Hanya menyelesaikan status password wajib jika sebelumnya masih aktif.
    if (profile.must_change_password) {
      const admin = createAdminClient();

      const { data: updatedProfile, error: updateError } = await admin
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", user.id)
        .eq("account_status", "active")
        .eq("must_change_password", true)
        .select("id")
        .maybeSingle();

      if (updateError || !updatedProfile) {
        console.error(
          "Change password profile flag update failed:",
          updateError
        );

        const {
          data: finalProfile,
          error: finalProfileError,
        } = await admin
          .from("profiles")
          .select("must_change_password")
          .eq("id", user.id)
          .maybeSingle();

        if (
          finalProfileError ||
          !finalProfile ||
          finalProfile.must_change_password
        ) {
          return jsonError(
            "Password mungkin sudah berhasil diperbarui, tetapi status akun belum selesai diperbarui. Coba kembali menggunakan password yang saat ini aktif sebagai password lama, lalu tentukan password baru yang berbeda.",
            500,
            "PASSWORD_UPDATED_PROFILE_PENDING"
          );
        }
      }
    }

    return NextResponse.json(
      { message: "Password berhasil diubah." },
      { status: 200 }
    );
  } catch (error) {
    console.error("Change password error:", error);

    return jsonError("Terjadi kesalahan pada server.", 500);
  }
}
