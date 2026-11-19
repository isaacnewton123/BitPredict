"use client";

import { useRef, useState } from "react";
import { LuImage, LuLink2, LuTrash2, LuUpload } from "react-icons/lu";
import { MarketCover } from "@/components/shared/MarketCover";
import { uploadMarketImage } from "@/lib/bitpredict-data";

interface CoverImageUploaderProps {
  category: string;
  previewSrc: string | null;
  hasCustomImage: boolean;
  onImageUrlChanged: (url: string | null) => Promise<void>;
  onNotify: (title: string, subtitle: string) => void;
}

export function CoverImageUploader({
  category,
  previewSrc,
  hasCustomImage,
  onImageUrlChanged,
  onNotify,
}: CoverImageUploaderProps) {
  const [uploadingImage, setUploadingImage] = useState(false);
  const [draggingImage, setDraggingImage] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFileSelected(file: File | null | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      onNotify("Image Too Large", "Please choose an image smaller than 5 MB.");
      return;
    }
    setUploadingImage(true);
    try {
      const uploaded = await uploadMarketImage(file);
      await onImageUrlChanged(uploaded.url);
      onNotify("Cover Image Ready", `${file.name} uploaded and attached to market spec.`);
    } catch (err) {
      onNotify(
        "Image Upload Failed",
        err instanceof Error ? err.message : "Could not upload image",
      );
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleApplyManualUrl() {
    const cleaned = imageUrlInput.trim();
    if (!cleaned) return;
    if (!/^https:\/\/[^\s]+$/i.test(cleaned) && !/^\/api\/v1\/uploads\//.test(cleaned)) {
      onNotify("Invalid Image URL", "Enter a valid https:// image URL.");
      return;
    }
    setUploadingImage(true);
    try {
      await onImageUrlChanged(cleaned);
      setShowUrlInput(false);
      onNotify("Cover Image Linked", "External HTTPS image attached to market spec.");
    } catch (err) {
      onNotify(
        "Invalid Cover URL",
        err instanceof Error ? err.message : "Failed to attach image URL",
      );
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleRemove() {
    setImageUrlInput("");
    try {
      await onImageUrlChanged(null);
    } catch (err) {
      onNotify(
        "Update Failed",
        err instanceof Error ? err.message : "Could not remove cover image",
      );
    }
  }

  return (
    <div className="mt-5 pt-5 border-t border-[#dedee5]">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#101114]">
          <LuImage className="w-4 h-4 text-[#7132f5]" />
          <span>Market Cover Image (Optional)</span>
        </span>
        <button
          type="button"
          onClick={() => setShowUrlInput((prev) => !prev)}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-[#7132f5] hover:underline cursor-pointer"
        >
          <LuLink2 className="w-3.5 h-3.5" />
          <span>{showUrlInput ? "Hide URL input" : "or paste https:// URL"}</span>
        </button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDraggingImage(true);
        }}
        onDragLeave={() => setDraggingImage(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDraggingImage(false);
          handleFileSelected(e.dataTransfer.files?.[0]);
        }}
        className={`p-3.5 rounded-[12px] border border-dashed transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          draggingImage
            ? "border-[#7132f5] bg-[rgba(133,91,251,0.08)]"
            : "border-[#dedee5] bg-[rgba(148,151,169,0.05)]"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => {
            handleFileSelected(e.target.files?.[0]);
            e.currentTarget.value = "";
          }}
          className="hidden"
        />

        <div className="flex items-center gap-3.5 min-w-0">
          <MarketCover
            imageUrl={previewSrc}
            category={category}
            alt="Market cover preview"
            size="preview"
          />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#101114] truncate">
              {hasCustomImage
                ? "Custom cover image attached"
                : `Default category icon (${category})`}
            </p>
            <p className="text-[12px] text-[#686b82]">
              Drag &amp; drop PNG, JPG, WEBP, or GIF (max 5 MB) — committed inside SHA-256 spec.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={uploadingImage}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-semibold text-[#101114] bg-white border border-[#dedee5] hover:border-[#7132f5] hover:text-[#7132f5] disabled:opacity-60 rounded-[10px] transition-colors cursor-pointer"
          >
            <LuUpload className="w-3.5 h-3.5" />
            <span>
              {uploadingImage
                ? "Uploading..."
                : hasCustomImage
                  ? "Change Image"
                  : "Upload Image"}
            </span>
          </button>

          {hasCustomImage && (
            <button
              type="button"
              onClick={handleRemove}
              aria-label="Remove cover image"
              className="inline-flex items-center gap-1 px-2.5 py-2 text-[12px] font-semibold text-[#686b82] hover:text-[#dc2626] bg-white border border-[#dedee5] rounded-[10px] transition-colors cursor-pointer"
            >
              <LuTrash2 className="w-3.5 h-3.5" />
              <span>Remove</span>
            </button>
          )}
        </div>
      </div>

      {showUrlInput && (
        <div className="mt-2.5 flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            value={imageUrlInput}
            onChange={(e) => setImageUrlInput(e.target.value)}
            placeholder="https://example.com/market-cover.jpg"
            className="flex-1 h-[40px] px-3 text-[13px] text-[#101114] bg-white border border-[#dedee5] rounded-[10px] focus:outline-none focus:border-[#7132f5]"
          />
          <button
            type="button"
            disabled={uploadingImage}
            onClick={handleApplyManualUrl}
            className="px-3.5 py-2 text-[13px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:opacity-60 rounded-[10px] cursor-pointer"
          >
            Apply URL
          </button>
        </div>
      )}
    </div>
  );
}
