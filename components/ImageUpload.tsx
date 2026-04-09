"use client";
import { useState } from "react";
import { uploadImage } from "@/lib/supabase";

export function ImageUpload({ onUpload, folder = "hotels" }: { onUpload: (url: string) => void; folder?: string }) {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file, folder);
      onUpload(url);
    } catch {
      alert("Upload failed, try again");
    } finally {
      setUploading(false);
    }
  };

  return (
    <label className="flex items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-2xl cursor-pointer hover:border-brand-500 transition bg-gray-50">
      <input type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
      {uploading ? (
        <span className="text-sm text-gray-500">Uploading...</span>
      ) : (
        <div className="text-center">
          <span className="text-2xl">📷</span>
          <p className="text-sm text-gray-500 mt-1">Tap to upload photo</p>
        </div>
      )}
    </label>
  );
}