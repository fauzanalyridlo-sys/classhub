"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface EditSubmissionMember {
  userId: string;
  fullName: string;
  isLeader: boolean;
}

interface EditSubmissionModalProps {
  groupId: number;
  assignmentId: number;
  assignmentTitle: string;
  members: EditSubmissionMember[];
  currentContributorIds: string[];
  onClose: () => void;
  onSaved: () => void;
}

interface UploadUrlResponse {
  success: boolean;
  message: string;
  data?: {
    path: string;
    token: string;
    originalFileName: string;
    fileSize: number;
    fileType: string;
    deadline: string;
  };
}

interface SubmitResponse {
  success: boolean;
  message: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export default function EditSubmissionModal({
  groupId,
  assignmentId,
  assignmentTitle,
  members,
  currentContributorIds,
  onClose,
  onSaved,
}: EditSubmissionModalProps) {
  const leader = members.find((member) => member.isLeader);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [selectedContributorIds, setSelectedContributorIds] = useState<
    string[]
  >(() => {
    const validIds = currentContributorIds.filter((id) =>
      members.some((member) => member.userId === id)
    );

    if (leader && !validIds.includes(leader.userId)) {
      validIds.push(leader.userId);
    }

    return validIds;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  function handleFileChange(file: File | null) {
    setErrorMessage("");

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase();

    if (!extension || !ALLOWED_TYPES[extension]) {
      setErrorMessage(
        "Format file tidak didukung. Gunakan PDF, DOC, DOCX, XLS, atau XLSX."
      );
      setSelectedFile(null);
      return;
    }

    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      setErrorMessage("Ukuran file harus lebih dari 0 dan maksimal 50 MB.");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  }

  function handleContributorChange(userId: string) {
    setErrorMessage("");

    if (leader?.userId === userId) return;

    setSelectedContributorIds((currentIds) => {
      if (currentIds.includes(userId)) {
        return currentIds.filter((id) => id !== userId);
      }

      if (currentIds.length >= 7) {
        setErrorMessage("Maksimal 7 anggota dapat dipilih sebagai kontributor.");
        return currentIds;
      }

      return [...currentIds, userId];
    });
  }

  async function handleContributorOnlyUpdate() {
    const response = await fetch(
      "/api/submissions/update-contributors",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          groupId,
          assignmentId,
          contributorIds: selectedContributorIds,
        }),
      }
    );

    const result = (await response.json()) as SubmitResponse;

    if (!response.ok || !result.success) {
      throw new Error(
        result.message || "Gagal memperbarui anggota kontributor."
      );
    }

    return result.message;
  }

  async function handleFileAndContributorUpdate() {
    if (!selectedFile) {
      throw new Error("File pengganti belum dipilih.");
    }

    const extension = selectedFile.name.split(".").pop()?.toLowerCase();

    if (!extension) {
      throw new Error("Ekstensi file tidak valid.");
    }

    const fileType = ALLOWED_TYPES[extension];

    const uploadUrlResponse = await fetch(
      "/api/submissions/upload-url",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          groupId,
          assignmentId,
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          fileType,
        }),
      }
    );

    const uploadUrlResult =
      (await uploadUrlResponse.json()) as UploadUrlResponse;

    if (
      !uploadUrlResponse.ok ||
      !uploadUrlResult.success ||
      !uploadUrlResult.data
    ) {
      throw new Error(
        uploadUrlResult.message || "Gagal menyiapkan proses upload."
      );
    }

    const uploadData = uploadUrlResult.data;
    const supabase = createClient();

    const { error: storageError } = await supabase.storage
      .from("submissions")
      .uploadToSignedUrl(
        uploadData.path,
        uploadData.token,
        selectedFile,
        {
          contentType: fileType,
          upsert: false,
        }
      );

    if (storageError) {
      throw new Error(
        storageError.message || "Gagal mengunggah file ke penyimpanan."
      );
    }

    const submitResponse = await fetch("/api/submissions/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        groupId,
        assignmentId,
        path: uploadData.path,
        fileName: uploadData.path.split("/").pop(),
        originalFileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType,
        contributorIds: selectedContributorIds,
      }),
    });

    const submitResult =
      (await submitResponse.json()) as SubmitResponse;

    if (!submitResponse.ok || !submitResult.success) {
      throw new Error(
        submitResult.message || "Gagal menyimpan perubahan pengumpulan."
      );
    }

    return submitResult.message;
  }

  async function handleSubmit() {
    setErrorMessage("");

    if (
      selectedContributorIds.length < 1 ||
      selectedContributorIds.length > 7
    ) {
      setErrorMessage("Pilih 1 sampai 7 anggota sebagai kontributor.");
      return;
    }

    if (leader && !selectedContributorIds.includes(leader.userId)) {
      setErrorMessage("Ketua kelompok wajib menjadi kontributor.");
      return;
    }

    setIsSubmitting(true);

    try {
      if (selectedFile) {
        await handleFileAndContributorUpdate();
      } else {
        await handleContributorOnlyUpdate();
      }

      onSaved();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Terjadi kesalahan saat menyimpan perubahan."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="ch-peserta-edit-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <section
        className="ch-peserta-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ch-peserta-edit-modal-title"
      >
        <header className="ch-peserta-edit-modal-header">
          <div>
            <span>Edit Pengumpulan</span>
            <h2 id="ch-peserta-edit-modal-title">{assignmentTitle}</h2>
            <p>
              Perbarui daftar kontributor atau unggah file pengganti jika
              diperlukan.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Tutup modal edit"
          >
            &times;
          </button>
        </header>

        <div className="ch-peserta-edit-modal-body">
          <section className="ch-peserta-edit-section">
            <h3>File Pengganti (Opsional)</h3>

            <label
              className="ch-peserta-edit-upload"
              htmlFor="ch-peserta-edit-file"
            >
              <span className="ch-peserta-edit-upload-icon">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 16V4m-4 4 4-4 4 4" />
                  <path d="M20 16.5v2A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-2" />
                </svg>
              </span>

              <strong>
                {selectedFile
                  ? selectedFile.name
                  : "Klik untuk memilih file pengganti"}
              </strong>

              <span>
                {selectedFile
                  ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`
                  : "Kosongkan jika hanya ingin mengubah kontributor"}
              </span>

              <input
                id="ch-peserta-edit-file"
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx"
                disabled={isSubmitting}
                onChange={(event) =>
                  handleFileChange(event.target.files?.[0] ?? null)
                }
              />
            </label>
          </section>

          <section className="ch-peserta-edit-section">
            <div className="ch-peserta-edit-contributor-heading">
              <div>
                <h3>Kontributor Tugas</h3>
                <p>Pilih anggota yang berkontribusi dalam tugas ini.</p>
              </div>

              <span>{selectedContributorIds.length}/7</span>
            </div>

            <div className="ch-peserta-edit-member-list">
              {members.map((member) => {
                const isSelected = selectedContributorIds.includes(
                  member.userId
                );

                return (
                  <label
                    key={member.userId}
                    className={`ch-peserta-edit-member ${
                      isSelected ? "is-selected" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isSubmitting || member.isLeader}
                      onChange={() =>
                        handleContributorChange(member.userId)
                      }
                    />

                    <span className="ch-peserta-edit-member-avatar">
                      {member.fullName.charAt(0).toUpperCase()}
                    </span>

                    <span className="ch-peserta-edit-member-name">
                      <strong>{member.fullName}</strong>
                      {member.isLeader && <small>Ketua Kelompok</small>}
                    </span>

                    {member.isLeader && (
                      <span className="ch-peserta-edit-leader-badge">
                        Ketua
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            <p className="ch-peserta-edit-helper">
              Ketua kelompok wajib dipilih. Pilih minimal 1 dan maksimal 7
              kontributor.
            </p>
          </section>

          {errorMessage && (
            <div className="ch-peserta-edit-message is-error" role="alert">
              {errorMessage}
            </div>
          )}
        </div>

        <footer className="ch-peserta-edit-modal-footer">
          <button
            type="button"
            className="ch-peserta-edit-cancel"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Batal
          </button>

          <button
            type="button"
            className="ch-peserta-edit-submit"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
          </button>
        </footer>
      </section>
    </div>
  );
}
