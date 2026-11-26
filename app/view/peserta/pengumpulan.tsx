"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import EditSubmissionModal from "@/app/assets/components/peserta/pengumpulan/edit-submission-modal";
import PengumpulanTugas from "@/app/view/peserta/pengumpulan-tugas";
import "@/app/style/peserta/popup-edit-pengumpulan.css";

import PesertaSidebar from "@/app/assets/components/layout/peserta/sidebar";
import PesertaHeader from "@/app/assets/components/layout/peserta/header";
import SubmissionEmptyState from "@/app/assets/components/peserta/pengumpulan/submission-empty-state";

interface SubmissionContributor {
  userId: string;
  fullName: string;
}

export interface GroupMemberOption {
  userId: string;
  fullName: string;
  isLeader: boolean;
}

export interface AssignmentOption {
  id: number;
  title: string;
  module: string | null;
  description: string | null;
  deadline: string;
}

interface SubmissionRevision {
  id: number;
  revisionNumber: number;
  originalFileName: string;
  fileSize: number;
  uploadedAt: string;
}

export interface SubmissionItem {
  id: number;
  assignmentId: number;
  groupId: number;
  assignmentTitle: string;
  moduleName: string;
  deadline: string | null;
  revisionAllowedUntil: string | null;
  status: "submitted" | "late";
  originalFileName: string;
  fileSize: number;
  submittedAt: string;
  updatedAt: string;
  contributors: SubmissionContributor[];
  revisions: SubmissionRevision[];
}

interface PesertaPengumpulanViewProps {
  submissions: SubmissionItem[];
  groupMembers: GroupMemberOption[];
  currentUserIsLeader: boolean;
  assignments?: AssignmentOption[];
  groupId?: number | null;
  error?: string;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(date));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function PesertaPengumpulanView({
  submissions,
  groupMembers,
  currentUserIsLeader,
  assignments = [],
  groupId = null,
  error,
}: PesertaPengumpulanViewProps) {
  const router = useRouter();

  const [selectedSubmission, setSelectedSubmission] =
    useState<SubmissionItem | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState<number | null>(null);

  const selectedSubmissionId = selectedSubmission?.id;

  // Perbarui waktu untuk pemeriksaan batas revisi.
  useEffect(() => {
    if (selectedSubmissionId === undefined) return;

    const updateCurrentTime = () => {
      setCurrentTime(Date.now());
    };

    const interval = window.setInterval(updateCurrentTime, 30_000);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        updateCurrentTime();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, [selectedSubmissionId]);

  // Tutup modal menggunakan tombol Escape.
  useEffect(() => {
    if (!selectedSubmission) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isEditModalOpen) {
        setSelectedSubmission(null);
      }
    }

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [selectedSubmission, isEditModalOpen]);

  const deadlineTime = selectedSubmission?.deadline
    ? new Date(selectedSubmission.deadline).getTime()
    : null;

  const revisionAllowedUntilTime =
    selectedSubmission?.revisionAllowedUntil
      ? new Date(selectedSubmission.revisionAllowedUntil).getTime()
      : null;

  const canEditSelectedSubmission =
    currentTime !== null &&
    ((deadlineTime !== null &&
      Number.isFinite(deadlineTime) &&
      currentTime <= deadlineTime) ||
      (revisionAllowedUntilTime !== null &&
        Number.isFinite(revisionAllowedUntilTime) &&
        currentTime <= revisionAllowedUntilTime));

  // Tugas yang sudah dikumpulkan tidak ditampilkan lagi pada form upload.
  const submittedAssignmentIds = new Set(
    submissions.map((submission) => submission.assignmentId)
  );

  const pendingAssignments = assignments.filter(
    (assignment) => !submittedAssignmentIds.has(assignment.id)
  );

  const uploadGroupMembers = groupMembers.map((member) => ({
    user_id: member.userId,
    full_name: member.fullName,
  }));

  return (
    <div className="ch-peserta-dashboard">
      <PesertaSidebar activeItem="Pengumpulan" />

      <main className="ch-peserta-main">
        <div className="ch-peserta-content">
          <PesertaHeader
            title="Pengumpulan Tugas"
            description="Lihat pengumpulan kelompok dan informasi berkas tugas yang sudah dikirim."
          />

          {!error && (
            <PengumpulanTugas
              groupId={groupId}
              isLeader={currentUserIsLeader}
              groupMembers={uploadGroupMembers}
              assignments={pendingAssignments}
              submissions={[]}
            />
          )}

          <section
            className="ch-peserta-submission-panel"
            aria-label="Daftar pengumpulan tugas kelompok"
          >
            <div className="ch-peserta-submission-panel-header">
              <div>
                <h3>Pengumpulan Kelompok</h3>
                <p>Daftar berkas tugas yang telah dikirim</p>
              </div>

              <span className="ch-peserta-submission-count">
                {submissions.length} pengumpulan
              </span>
            </div>

            {error ? (
              <div className="ch-peserta-submission-error" role="alert">
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
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                <p>{error}</p>
              </div>
            ) : submissions.length === 0 ? (
              <SubmissionEmptyState />
            ) : (
              <div className="ch-peserta-submission-table-wrapper">
                <table className="ch-peserta-submission-table">
                  <thead>
                    <tr>
                      <th scope="col">Nama tugas</th>
                      <th scope="col">File</th>
                      <th scope="col">Kontributor</th>
                      <th scope="col">Status</th>
                      <th scope="col">Aksi</th>
                    </tr>
                  </thead>

                  <tbody>
                    {submissions.map((submission) => (
                      <tr key={submission.id}>
                        <td data-label="Nama tugas">
                          <span className="ch-peserta-submission-task-name">
                            {submission.assignmentTitle}
                          </span>
                          <span className="ch-peserta-submission-module">
                            {submission.moduleName}
                          </span>
                        </td>

                        <td data-label="File">
                          <span className="ch-peserta-submission-table-file">
                            {submission.originalFileName}
                          </span>
                          <span className="ch-peserta-submission-table-size">
                            {formatFileSize(submission.fileSize)}
                          </span>
                        </td>

                        <td data-label="Kontributor">
                          {submission.contributors.length} orang
                        </td>

                        <td data-label="Status">
                          <span
                            className={`ch-peserta-submission-status ${
                              submission.status === "late"
                                ? "is-late"
                                : "is-submitted"
                            }`}
                          >
                            {submission.status === "late"
                              ? "Terlambat"
                              : "Sudah dikumpulkan"}
                          </span>
                        </td>

                        <td data-label="Aksi">
                          <button
                            type="button"
                            className="ch-peserta-submission-detail-button"
                            onClick={() => {
                              setCurrentTime(Date.now());
                              setSelectedSubmission(submission);
                            }}
                          >
                            Detail
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="ch-peserta-submission-information">
            <div className="ch-peserta-submission-information-icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 11v5M12 8h.01" />
              </svg>
            </div>

            <p>
              Pengumpulan dan perubahan berkas hanya dapat dilakukan oleh
              ketua kelompok aktif sesuai ketentuan deadline. Riwayat
              pengumpulan sebelumnya tetap perlu dipertahankan.
            </p>
          </aside>
        </div>
      </main>

      {selectedSubmission && (
        <div
          className="ch-peserta-submission-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedSubmission(null);
            }
          }}
        >
          <section
            className="ch-peserta-submission-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ch-peserta-submission-modal-title"
          >
            <header className="ch-peserta-submission-modal-header">
              <div>
                <span>Detail Pengumpulan</span>
                <h2 id="ch-peserta-submission-modal-title">
                  {selectedSubmission.assignmentTitle}
                </h2>
              </div>

              <button
                type="button"
                className="ch-peserta-submission-modal-close"
                onClick={() => setSelectedSubmission(null)}
                aria-label="Tutup detail pengumpulan"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="m18 6-12 12M6 6l12 12" />
                </svg>
              </button>
            </header>

            <div className="ch-peserta-submission-modal-body">
              <div className="ch-peserta-submission-detail-grid">
                <div>
                  <span>Modul</span>
                  <strong>{selectedSubmission.moduleName}</strong>
                </div>

                <div>
                  <span>Status</span>
                  <strong>
                    {selectedSubmission.status === "late"
                      ? "Terlambat"
                      : "Sudah dikumpulkan"}
                  </strong>
                </div>

                <div>
                  <span>Nama file</span>
                  <strong className="ch-peserta-submission-detail-filename">
                    {selectedSubmission.originalFileName}
                  </strong>
                </div>

                <div>
                  <span>Ukuran file</span>
                  <strong>
                    {formatFileSize(selectedSubmission.fileSize)}
                  </strong>
                </div>

                <div>
                  <span>Waktu pengumpulan</span>
                  <strong>
                    {formatDate(selectedSubmission.submittedAt)}
                  </strong>
                </div>

                <div>
                  <span>Terakhir diperbarui</span>
                  <strong>
                    {formatDate(selectedSubmission.updatedAt)}
                  </strong>
                </div>
              </div>

              <div className="ch-peserta-submission-revisions">
                <h3>Riwayat Revisi</h3>

                {selectedSubmission.revisions.length > 0 ? (
                  <ul>
                    {selectedSubmission.revisions.map((revision) => (
                      <li key={revision.id}>
                        <div className="ch-peserta-submission-revision-icon">
                          <svg
                            width="21"
                            height="21"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                            <path d="M8 13h8M8 17h8" />
                          </svg>
                        </div>

                        <div>
                          <strong>
                            Revisi {revision.revisionNumber} ·{" "}
                            {revision.originalFileName}
                          </strong>
                          <span>
                            {formatDate(revision.uploadedAt)} ·{" "}
                            {formatFileSize(revision.fileSize)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ch-peserta-submission-no-revisions">
                    Pengumpulan pertama. Belum ada riwayat revisi.
                  </p>
                )}
              </div>

              <div className="ch-peserta-submission-contributors">
                <div className="ch-peserta-submission-contributors-heading">
                  <h3>Kontributor</h3>
                  <span>
                    {selectedSubmission.contributors.length} orang
                  </span>
                </div>

                {selectedSubmission.contributors.length > 0 ? (
                  <ul>
                    {selectedSubmission.contributors.map((contributor) => (
                      <li key={contributor.userId}>
                        <span className="ch-peserta-submission-contributor-avatar">
                          {contributor.fullName.charAt(0).toUpperCase()}
                        </span>
                        <span>{contributor.fullName}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ch-peserta-submission-no-contributors">
                    Belum ada informasi kontributor.
                  </p>
                )}
              </div>
            </div>

            <footer className="ch-peserta-submission-modal-footer">
              {currentUserIsLeader && canEditSelectedSubmission && (
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(true)}
                >
                  Edit Pengumpulan
                </button>
              )}

              <button
                type="button"
                onClick={() => setSelectedSubmission(null)}
              >
                Tutup
              </button>
            </footer>
          </section>
        </div>
      )}

      {isEditModalOpen && selectedSubmission && (
        <EditSubmissionModal
          groupId={selectedSubmission.groupId}
          assignmentId={selectedSubmission.assignmentId}
          assignmentTitle={selectedSubmission.assignmentTitle}
          members={groupMembers}
          currentContributorIds={selectedSubmission.contributors.map(
            (contributor) => contributor.userId
          )}
          onClose={() => setIsEditModalOpen(false)}
          onSaved={() => {
            setIsEditModalOpen(false);
            setSelectedSubmission(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
