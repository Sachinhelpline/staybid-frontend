import StubPage from "@/components/admin/stub-page";
export default function Page() {
  return (
    <StubPage
      title="Settings & Config"
      icon="⚙️"
      description="Platform config (commission % defaults, OTP settings, verification tier durations, AI pricing parameters, email/SMS provider keys), team management with permissions matrix, and full admin action / system logs with CSV export."
    />
  );
}
