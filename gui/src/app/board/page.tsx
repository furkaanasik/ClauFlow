import { Board } from "@/components/Board/Board";
import { AppRail } from "@/components/Shell/AppRail";
import { TopBar } from "@/components/Shell/TopBar";
import { ToastContainer } from "@/components/ui/Toast";

export default function BoardPage() {
  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      <AppRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-3 pt-5">
          <Board />
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
