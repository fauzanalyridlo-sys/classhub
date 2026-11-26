"use client";

import { useState, type FormEvent } from "react";

type MessageState = {
  type: "success" | "error";
  text: string;
} | null;

export default function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);

  async function handlePasswordChange(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setMessage(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage({
        type: "error",
        text: "Semua kolom password wajib diisi.",
      });
      return;
    }

    if (newPassword.length < 8 || newPassword.length > 128) {
      setMessage({
        type: "error",
        text: "Password baru harus terdiri dari 8 sampai 128 karakter.",
      });
      return;
    }

    if (currentPassword === newPassword) {
      setMessage({
        type: "error",
        text: "Password baru harus berbeda dari password lama.",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({
        type: "error",
        text: "Konfirmasi password baru tidak cocok.",
      });
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          currentPassword,
          password: newPassword,
          confirmPassword,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        if (result?.code === "PASSWORD_UPDATED_PROFILE_PENDING") {
          setMessage({
            type: "error",
            text:
              "Password mungkin sudah berhasil diperbarui, tetapi status akun belum selesai diperbarui. Jika password sudah berubah, masukkan password yang saat ini aktif pada kolom Password Lama, lalu tentukan password baru yang berbeda.",
          });
        } else {
          setMessage({
            type: "error",
            text:
              typeof result?.error === "string"
                ? result.error
                : "Password gagal diperbarui. Silakan coba kembali.",
          });
        }

        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      setMessage({
        type: "success",
        text: "Password berhasil diperbarui.",
      });
    } catch (error) {
      console.error("Password change request failed:", error);

      setMessage({
        type: "error",
        text:
          "Terjadi kesalahan saat menghubungi server. Silakan coba kembali.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ch-peserta-password-card">
      <div className="ch-peserta-password-card-header">
        <div className="ch-peserta-password-icon">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <div>
          <h3>Ubah Password</h3>
          <p>Perbarui password untuk menjaga keamanan akun.</p>
        </div>
      </div>

      <form
        className="ch-peserta-password-form"
        onSubmit={handlePasswordChange}
      >
        <div className="ch-peserta-password-field">
          <label htmlFor="current-password">
            Password Lama
          </label>
          <input
            id="current-password"
            name="currentPassword"
            type="password"
            placeholder="Masukkan password yang saat ini digunakan"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) =>
              setCurrentPassword(event.target.value)
            }
            disabled={loading}
            required
          />
        </div>

        <div className="ch-peserta-password-field">
          <label htmlFor="new-password">Password Baru</label>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            placeholder="Masukkan password baru (minimal 8 karakter)"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) =>
              setNewPassword(event.target.value)
            }
            disabled={loading}
            minLength={8}
            maxLength={128}
            required
          />
        </div>

        <div className="ch-peserta-password-field">
          <label htmlFor="confirm-password">
            Konfirmasi Password Baru
          </label>
          <input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            placeholder="Ulangi password baru"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) =>
              setConfirmPassword(event.target.value)
            }
            disabled={loading}
            minLength={8}
            maxLength={128}
            required
          />
        </div>

        <div
          className={`ch-peserta-password-notice ${
            message ? `is-${message.type}` : ""
          }`}
          role={message?.type === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {message?.type === "success" ? (
              <>
                <path d="M20 6 9 17l-5-5" />
                <circle cx="12" cy="12" r="10" />
              </>
            ) : (
              <>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 11v5M12 8h.01" />
              </>
            )}
          </svg>

          <p>
            {message?.text ??
              "Masukkan password lama, kemudian tentukan password baru untuk akunmu."}
          </p>
        </div>

        <button type="submit" disabled={loading}>
          {loading ? "Memproses Perubahan..." : "Simpan Perubahan"}
        </button>
      </form>
    </div>
  );
}
