import PesertaSidebar from "@/app/assets/components/layout/peserta/sidebar";
import PesertaHeader from "@/app/assets/components/layout/peserta/header";
import PasswordForm from "@/app/assets/components/peserta/password/password-form";

export default function PesertaPasswordView() {
  return (
    <div className="ch-peserta-dashboard">
      <PesertaSidebar activeItem="Password" />

      <main className="ch-peserta-main">
        <div className="ch-peserta-content">
          <PesertaHeader
            title="Ganti Password"
            description="Kelola keamanan password akun ClassHub kamu."
          />

          <PasswordForm />
        </div>
      </main>
    </div>
  );
}
