import { redirect } from "next/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  redirect(`/school${date ? `?date=${encodeURIComponent(date)}` : ""}`);
}
