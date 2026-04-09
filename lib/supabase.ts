const SUPABASE_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SUPABASE_ANON = "sb_publishable_N2tMgg386VuuZcuy-Tpi8A_FLRK_-eE";

export async function uploadImage(file: File, folder: string = "hotels"): Promise<string> {
  const ext = file.name.split(".").pop();
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/hotel-images/${fileName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON}`,
      "Content-Type": file.type,
      "x-upsert": "true",
    },
    body: file,
  });

  if (!res.ok) throw new Error("Upload failed");

  return `${SUPABASE_URL}/storage/v1/object/public/hotel-images/${fileName}`;
}