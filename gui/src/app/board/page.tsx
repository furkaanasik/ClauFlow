import { Board } from "@/components/Board/Board";
import { ProjectSidebar } from "@/components/Sidebar/ProjectSidebar";
import { Header } from "@/components/Layout/Header";
import { ToastContainer } from "@/components/ui/Toast";

export default function BoardPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950">
      <Header />
      <div className="flex flex-1 overflow-hidden pt-12">
        <ProjectSidebar />
        <main className="flex flex-1 flex-col overflow-auto p-5">
          <Board />
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
