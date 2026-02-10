"use client";
import { useState } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { Image as ImageIcon, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Screenshot {
  url: string;
  stepId: string;
  timestamp: string;
}

interface ScreenshotGalleryProps {
  screenshots: Screenshot[];
}

export function ScreenshotGallery({ screenshots }: ScreenshotGalleryProps) {
  const [selectedImage, setSelectedImage] = useState<Screenshot | null>(null);
  const [toast, setToast] = useState<{message: string; type: "success" | "error"} | null>(null);

  const handleDownload = async (screenshot: Screenshot) => {
    try {
      const response = await fetch(screenshot.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `screenshot-${screenshot.stepId}-${screenshot.timestamp}.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Failed to download screenshot:", error);
      setToast({message: "Failed to download screenshot", type: "error"});
    }
  };

  if (screenshots.length === 0) {
    return (
      <Card>
        <div className="p-8 text-center">
          <ImageIcon className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500">No screenshots captured</p>
        </div>
      </Card>
    );
  }

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <Card>
        <div className="p-4 border-b">
          <h3 className="font-medium">Screenshots ({screenshots.length})</h3>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {screenshots.map((screenshot, index) => (
              <div
                key={index}
                className="group relative aspect-video bg-gray-100 rounded-lg overflow-hidden cursor-pointer"
                onClick={() => setSelectedImage(screenshot)}
              >
                <Image
                  src={screenshot.url}
                  alt={`Screenshot ${index + 1}`}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform"
                />
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-opacity flex items-center justify-center">
                  <ImageIcon className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="absolute bottom-2 left-2 right-2">
                  <div className="text-xs px-2 py-1 bg-black bg-opacity-70 text-white rounded truncate">
                    {screenshot.stepId}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {selectedImage && (
        <Modal
          open={!!selectedImage}
          onClose={() => setSelectedImage(null)}
          title={`Screenshot - ${selectedImage.stepId}`}
          size="xl"
        >
          <div className="relative">
            <div className="relative w-full aspect-video">
              <Image
                src={selectedImage.url}
                alt="Full screenshot"
                fill
                className="object-contain rounded-lg"
              />
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <Button
                variant="secondary"
                onClick={() => handleDownload(selectedImage)}
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button variant="outline" onClick={() => setSelectedImage(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
