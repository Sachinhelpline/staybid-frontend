import StubPage from "@/components/admin/stub-page";
export default function Page() {
  return (
    <StubPage
      title="Fraud & Security"
      icon="🛡️"
      description="Real-time fraud flags (duplicate accounts, suspicious payments, video mismatches), risk matrix (tier × frequency heatmap), blocked users list, and merge / lock / approve actions per flag."
    />
  );
}
