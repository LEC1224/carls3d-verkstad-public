import { Component } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";

// Keep this limit lightweight: importing the geometry helper would eagerly load Three.js.
const MAX_PREVIEW_FILE_SIZE = 20 * 1024 * 1024;
const Viewer = dynamic(() => import("./ThreeDViewer"), {
  ssr: false,
  loading: () => <p role="status" className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">Laddar 3D-visningen…</p>,
});

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p role="status" className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">Förhandsvisningen kunde inte laddas. Du kan fortfarande beräkna pris och beställa.</p>
      : this.props.children;
  }
}

export default function ModelPreview({ file, color }: { file: File; color?: string }) {
  if (file.size > MAX_PREVIEW_FILE_SIZE) {
    return <p role="status" className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">3D-förhandsvisning är tillgänglig för filer upp till 20 MB. Du kan fortfarande beräkna pris och beställa den här filen.</p>;
  }
  return <PreviewBoundary><Viewer file={file} color={color} /></PreviewBoundary>;
}
