import { Board } from "@/components/Board/Board";
import { ProjectSidebar } from "@/components/Sidebar/ProjectSidebar";
import { Header } from "@/components/Layout/Header";
import { ToastContainer } from "@/components/ui/Toast";

export default function BoardPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-base)]">
      <Header />
      <div className="flex flex-1 overflow-hidden pt-14">
        <ProjectSidebar />
        <main className="flex flex-1 flex-col overflow-auto p-6 md:p-8">
          <Board />
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
