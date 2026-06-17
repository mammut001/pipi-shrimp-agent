import { ArchitectureContent } from "@/components";

export const metadata = {
  title: "Architecture - Pipi Shrimp Agent",
  description:
    "How Pipi Shrimp Agent is put together. A high-level tour of the Tauri shell, React frontend, Claude SDK integration, local toolchain, browser agent, and security model.",
};

export default function ArchitecturePage() {
  return <ArchitectureContent />;
}
